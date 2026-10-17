"""Google OAuth persistence and concurrency (docs/backend/AUTH_RBAC.md §10, §13.5, §17).

* ``oauth_flows`` / ``auth_identities`` constraints, enforced by PostgreSQL itself,
* the flow repository's single-use consumption,
* retention (the maintenance sweep and its CLI output),
* the races that only real, committed rows and separate connections can show: two callbacks for one
  flow, one new Google subject arriving twice, one identity linked by two users, an account claim
  racing an e-mail verification.

The concurrency tests bypass the savepoint-isolated session and clean up with ``TRUNCATE``.
"""

import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security.tokens import hash_token, new_token
from app.models import (
    AuthEvent,
    AuthIdentity,
    AuthSession,
    OAuthFlow,
    ProfessionalProfile,
    User,
    UserRole,
)
from app.models.enums import (
    AuthEventType,
    AuthProvider,
    AuthTokenPurpose,
    OAuthPurpose,
)
from app.repositories.auth import IdentityRepository, OAuthFlowRepository, TokenRepository
from app.services.auth import VERIFICATION_TTL, AuthService
from app.services.auth_audit import AuthAuditService
from app.services.auth_maintenance import OAUTH_FLOW_SWEEP, AuthMaintenanceService
from app.services.auth_sessions import Principal, SessionService
from app.services.auth_tokens import issue_token
from app.services.oauth.fake import FakeOAuthProvider, fake_code
from app.services.oauth.flow import CallbackOutcome, OAuthService, StartedFlow
from app.services.rate_limit import PostgresRateLimiter
from tests.db.auth_helpers import (
    START,
    FakeClock,
    events_of,
    fast_passwords,
    make_account,
    make_test_settings,
)
from tests.db.helpers import make_user, raw_insert, violates

GOOGLE = AuthProvider.GOOGLE


def new_flow(**overrides: object) -> OAuthFlow:
    values: dict[str, object] = {
        "provider": GOOGLE,
        "purpose": OAuthPurpose.LOGIN,
        "state_hash": hash_token(new_token()),
        "flow_cookie_hash": hash_token(new_token()),
        "nonce": "n" * 43,
        "code_verifier": "v" * 64,
        "return_to": "/",
        "created_at": START,
        "expires_at": START + timedelta(minutes=10),
    }
    values.update(overrides)
    return OAuthFlow(**values)


# -- the table's own constraints --------------------------------------------------------------------------


def test_a_valid_flow_is_stored(db_session: Session) -> None:
    flow = new_flow()
    db_session.add(flow)
    db_session.flush()

    stored = db_session.get(OAuthFlow, flow.id)
    assert stored is not None and stored.consumed_at is None and stored.user_id is None


def test_the_flow_table_holds_hashes_and_never_provider_tokens(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        columns = set(
            connection.scalars(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'oauth_flows'"
                )
            )
        )

    assert columns == {
        "id",
        "provider",
        "purpose",
        "state_hash",
        "flow_cookie_hash",
        "nonce",
        "code_verifier",
        "user_id",
        "return_to",
        "created_at",
        "expires_at",
        "consumed_at",
    }
    assert not {c for c in columns if "token" in c or "secret" in c or c == "code"}


@pytest.mark.parametrize("column", ["state_hash", "flow_cookie_hash"])
def test_hashes_must_be_exactly_32_bytes(db_session: Session, column: str) -> None:
    for bad in (b"", b"x" * 31, b"x" * 33):
        with violates(db_session, f"ck_oauth_flows_{column}_length"):
            db_session.add(new_flow(**{column: bad}))


def test_state_hashes_are_unique(db_session: Session) -> None:
    shared = hash_token(new_token())
    db_session.add(new_flow(state_hash=shared))
    db_session.flush()

    with violates(db_session, "uq_oauth_flows_state_hash"):
        db_session.add(new_flow(state_hash=shared))


def test_a_link_flow_has_a_user_and_a_login_flow_has_none(db_session: Session) -> None:
    user = make_user(db_session)

    with violates(db_session, "ck_oauth_flows_link_has_user"):
        db_session.add(new_flow(purpose=OAuthPurpose.LINK, user_id=None))
    with violates(db_session, "ck_oauth_flows_link_has_user"):
        db_session.add(new_flow(purpose=OAuthPurpose.LOGIN, user_id=user.id))
    db_session.add(new_flow(purpose=OAuthPurpose.LINK, user_id=user.id))
    db_session.flush()


@pytest.mark.parametrize("bad", ["saved", "http://evil.example", ""])
def test_return_to_must_be_a_rooted_path(db_session: Session, bad: str) -> None:
    with violates(db_session, "ck_oauth_flows_return_to_relative"):
        db_session.add(new_flow(return_to=bad))


def test_a_flow_must_expire_after_it_was_created(db_session: Session) -> None:
    with violates(db_session, "ck_oauth_flows_expires_after_created"):
        db_session.add(new_flow(expires_at=START))


def test_provider_and_purpose_are_closed_sets_in_the_database(db_session: Session) -> None:
    base = {
        "state_hash": hash_token(new_token()),
        "flow_cookie_hash": hash_token(new_token()),
        "nonce": "n",
        "code_verifier": "v",
        "return_to": "/",
        "created_at": START,
        "expires_at": START + timedelta(minutes=10),
    }
    with violates(db_session, "ck_oauth_flows_provider_valid"):
        raw_insert(
            db_session, "oauth_flows", id=uuid.uuid4(), provider="myspace", purpose="login", **base
        )
    with violates(db_session, "ck_oauth_flows_purpose_valid"):
        raw_insert(
            db_session,
            "oauth_flows",
            id=uuid.uuid4(),
            provider="google",
            purpose="signup",
            **{**base, "state_hash": hash_token(new_token())},
        )


def test_deleting_the_initiating_user_deletes_their_link_flows(db_session: Session) -> None:
    user = make_user(db_session)
    flow = new_flow(purpose=OAuthPurpose.LINK, user_id=user.id)
    db_session.add(flow)
    db_session.flush()
    flow_id = flow.id

    db_session.delete(user)
    db_session.flush()
    db_session.expire_all()

    assert db_session.get(OAuthFlow, flow_id) is None


# -- identities ---------------------------------------------------------------------------------------------


def test_one_google_identity_belongs_to_one_user(db_session: Session) -> None:
    first, second = (
        make_user(db_session, email="a@example.org"),
        make_user(db_session, email="b@example.org"),
    )
    db_session.add(AuthIdentity(user_id=first.id, provider=GOOGLE, provider_subject="sub-1"))
    db_session.flush()

    with violates(db_session, "uq_auth_identities_provider_subject"):
        db_session.add(AuthIdentity(user_id=second.id, provider=GOOGLE, provider_subject="sub-1"))


def test_a_user_has_at_most_one_identity_per_provider(db_session: Session) -> None:
    user = make_user(db_session)
    db_session.add(AuthIdentity(user_id=user.id, provider=GOOGLE, provider_subject="sub-1"))
    db_session.flush()

    with violates(db_session, "uq_auth_identities_user_id_provider"):
        db_session.add(AuthIdentity(user_id=user.id, provider=GOOGLE, provider_subject="sub-2"))
    db_session.add(
        AuthIdentity(user_id=user.id, provider=AuthProvider.FACEBOOK, provider_subject="sub-1")
    )
    db_session.flush()  # another provider is a different slot


def test_deleting_a_user_deletes_their_identities(db_session: Session) -> None:
    user = make_user(db_session)
    db_session.add(AuthIdentity(user_id=user.id, provider=GOOGLE, provider_subject="sub-1"))
    db_session.flush()

    db_session.delete(user)
    db_session.flush()

    assert IdentityRepository(db_session).get_by_subject(GOOGLE, "sub-1") is None


# -- the flow repository: single use --------------------------------------------------------------------------


def consume(
    session: Session,
    flow: OAuthFlow,
    *,
    state_hash: bytes | None = None,
    cookie_hash: bytes | None = None,
    provider: AuthProvider = GOOGLE,
    now_offset: timedelta = timedelta(0),
) -> OAuthFlow | None:
    return OAuthFlowRepository(session).consume(
        state_hash=state_hash or flow.state_hash,
        flow_cookie_hash=cookie_hash or flow.flow_cookie_hash,
        provider=provider,
        now=START + now_offset,
    )


def test_a_flow_is_consumed_exactly_once(db_session: Session) -> None:
    flow = new_flow()
    OAuthFlowRepository(db_session).add(flow)

    first = consume(db_session, flow)
    second = consume(db_session, flow)

    assert first is not None and first.id == flow.id and first.consumed_at == START
    assert second is None


def test_consumption_requires_the_matching_browser_binding(db_session: Session) -> None:
    flow = new_flow()
    OAuthFlowRepository(db_session).add(flow)

    assert consume(db_session, flow, cookie_hash=hash_token(new_token())) is None
    assert consume(db_session, flow, state_hash=hash_token(new_token())) is None
    assert consume(db_session, flow, provider=AuthProvider.FACEBOOK) is None
    # none of those failed attempts spent the genuine flow
    assert consume(db_session, flow) is not None


def test_an_expired_flow_cannot_be_consumed(db_session: Session) -> None:
    flow = new_flow()
    OAuthFlowRepository(db_session).add(flow)

    assert consume(db_session, flow, now_offset=timedelta(minutes=10)) is None  # at the boundary
    assert consume(db_session, flow, now_offset=timedelta(minutes=9, seconds=59)) is not None


# -- retention ----------------------------------------------------------------------------------------------------


def test_the_maintenance_sweep_removes_only_long_expired_flows(db_session: Session) -> None:
    clock = FakeClock(START + timedelta(days=30))
    old = new_flow(created_at=START, expires_at=START + timedelta(minutes=10))
    consumed_old = new_flow(
        created_at=START, expires_at=START + timedelta(minutes=10), consumed_at=START
    )
    recent_expired = new_flow(
        created_at=clock() - timedelta(hours=2), expires_at=clock() - timedelta(hours=1)
    )
    live = new_flow(created_at=clock(), expires_at=clock() + timedelta(minutes=10))
    db_session.add_all([old, consumed_old, recent_expired, live])
    db_session.commit()
    keep = {recent_expired.id, live.id}
    assert timedelta(hours=1) < OAUTH_FLOW_SWEEP

    counts = AuthMaintenanceService(db_session, clock).purge()

    assert counts.oauth_flows == 2
    assert set(db_session.scalars(select(OAuthFlow.id))) == keep


# -- the service on its own (no HTTP) ---------------------------------------------------------------------------


def oauth_service(
    session: Session, provider: FakeOAuthProvider, clock: FakeClock | None = None
) -> OAuthService:
    return OAuthService(session, make_test_settings(), clock or FakeClock(), {GOOGLE: provider})


def state_of(started: StartedFlow) -> str:
    return parse_qs(urlparse(started.authorization_url).query)["state"][0]


def sign_in(
    service: OAuthService, started: StartedFlow, *, sub: str, email: str, verified: bool = True
) -> CallbackOutcome:
    return service.callback(
        GOOGLE,
        code=fake_code(sub, email, verified=verified),
        state=state_of(started),
        provider_error=None,
        flow_cookie=started.flow_cookie,
        session_token=None,
        user_agent=None,
    )


def test_start_stores_only_hashes_of_the_state_and_the_cookie(db_session: Session) -> None:
    service = oauth_service(db_session, FakeOAuthProvider())

    started = service.start(GOOGLE, OAuthPurpose.LOGIN, "/saved", None)

    (flow,) = db_session.scalars(select(OAuthFlow)).all()
    assert flow.state_hash == hash_token(state_of(started))
    assert flow.flow_cookie_hash == hash_token(started.flow_cookie)
    assert state_of(started).encode() not in flow.state_hash
    assert (flow.return_to, flow.purpose, flow.user_id) == ("/saved", OAuthPurpose.LOGIN, None)
    assert flow.expires_at - flow.created_at == timedelta(minutes=10)


def test_a_replayed_callback_is_refused_even_with_a_valid_code(db_session: Session) -> None:
    service = oauth_service(db_session, FakeOAuthProvider())
    started = service.start(GOOGLE, OAuthPurpose.LOGIN, None, None)

    first = sign_in(service, started, sub="s-1", email="new@example.org")
    replay = sign_in(service, started, sub="s-1", email="new@example.org")

    assert first.session_token is not None and first.error is None and first.flow_spent
    assert replay.error == "oauth_failed" and replay.session_token is None and not replay.flow_spent


def test_a_new_google_user_is_a_plain_resident(db_session: Session) -> None:
    service = oauth_service(db_session, FakeOAuthProvider())
    started = service.start(GOOGLE, OAuthPurpose.LOGIN, None, None)

    outcome = sign_in(service, started, sub="s-1", email="New@Example.org")

    user = db_session.scalars(select(User).where(User.email == "new@example.org")).one()
    assert (
        outcome.error is None and user.password_hash is None and user.email_verified_at is not None
    )
    assert db_session.scalar(select(func.count()).select_from(UserRole)) == 0
    assert db_session.scalar(select(func.count()).select_from(ProfessionalProfile)) == 0
    identity = IdentityRepository(db_session).get_by_subject(GOOGLE, "s-1")
    assert identity is not None and identity.user_id == user.id
    kinds = [e.event_type for e in events_of(db_session, user.id)]
    assert kinds == [AuthEventType.REGISTER, AuthEventType.IDENTITY_LINKED]


# -- concurrency (committed rows, separate connections) ----------------------------------------------------------

OAUTH_TABLES = (
    "users, auth_sessions, auth_tokens, auth_events, auth_rate_limits, oauth_flows, auth_identities"
)


@contextmanager
def committed_world(engine: Engine) -> Iterator[None]:
    try:
        yield
    finally:
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE {OAUTH_TABLES} CASCADE"))


def run_threads(count: int, work: Callable[[int], object]) -> list[object]:
    barrier = threading.Barrier(count)
    results: list[object] = [None] * count

    def runner(index: int) -> None:
        barrier.wait()
        try:
            results[index] = work(index)
        except Exception as error:
            results[index] = error

    threads = [threading.Thread(target=runner, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    return results


def start_committed(
    engine: Engine,
    provider: FakeOAuthProvider,
    *,
    principal: Principal | None = None,
    purpose: OAuthPurpose = OAuthPurpose.LOGIN,
) -> StartedFlow:
    with Session(engine, expire_on_commit=False) as session:
        return oauth_service(session, provider).start(GOOGLE, purpose, None, principal)


def callback_in_new_session(
    engine: Engine,
    provider: FakeOAuthProvider,
    started: StartedFlow,
    *,
    sub: str,
    email: str,
    verified: bool = True,
    session_token: str | None = None,
) -> CallbackOutcome:
    with Session(engine, expire_on_commit=False) as session:
        return oauth_service(session, provider).callback(
            GOOGLE,
            code=fake_code(sub, email, verified=verified),
            state=state_of(started),
            provider_error=None,
            flow_cookie=started.flow_cookie,
            session_token=session_token,
            user_agent=None,
        )


def count_rows(engine: Engine, model: type) -> int:
    with Session(engine) as session:
        return int(session.scalar(select(func.count()).select_from(model)) or 0)


def test_two_concurrent_callbacks_for_one_flow_have_exactly_one_winner(db_engine: Engine) -> None:
    with committed_world(db_engine):
        provider = FakeOAuthProvider()
        started = start_committed(db_engine, provider)

        def go(_: int) -> object:
            return callback_in_new_session(
                db_engine, provider, started, sub="s-1", email="race@example.org"
            )

        results = run_threads(6, go)

        outcomes = [r for r in results if isinstance(r, CallbackOutcome)]
        assert len(outcomes) == 6, results
        assert [o.session_token is not None for o in outcomes].count(True) == 1
        assert {o.error for o in outcomes if o.session_token is None} == {"oauth_failed"}
        assert count_rows(db_engine, User) == 1 and count_rows(db_engine, AuthIdentity) == 1
        assert count_rows(db_engine, AuthSession) == 1


def test_one_new_google_subject_arriving_twice_creates_one_account(db_engine: Engine) -> None:
    with committed_world(db_engine):
        provider = FakeOAuthProvider()
        flows = [start_committed(db_engine, provider) for _ in range(4)]

        def go(index: int) -> object:
            return callback_in_new_session(
                db_engine, provider, flows[index], sub="s-same", email="same@example.org"
            )

        results = run_threads(4, go)

        assert all(isinstance(r, CallbackOutcome) for r in results), (
            results
        )  # no raw IntegrityError
        outcomes = [r for r in results if isinstance(r, CallbackOutcome)]
        assert all(o.error is None and o.session_token for o in outcomes), outcomes
        assert count_rows(db_engine, User) == 1 and count_rows(db_engine, AuthIdentity) == 1
        assert count_rows(db_engine, AuthSession) == 4  # each browser got its own session
        with Session(db_engine) as check:
            registers = check.scalar(
                select(func.count())
                .select_from(AuthEvent)
                .where(AuthEvent.event_type == AuthEventType.REGISTER)
            )
            assert registers == 1


def test_one_identity_linked_by_two_users_has_exactly_one_owner(db_engine: Engine) -> None:
    with committed_world(db_engine):
        provider = FakeOAuthProvider()
        tokens: list[tuple[str, StartedFlow]] = []
        with Session(db_engine, expire_on_commit=False) as setup:
            for email in ("one@example.org", "two@example.org"):
                user = make_account(setup, email)
                audit_clock = FakeClock()
                sessions = SessionService(
                    setup, make_test_settings(), audit_clock, AuthAuditService(setup, audit_clock)
                )
                raw, _ = sessions.create(user.id, None)
                setup.commit()
                principal = sessions.authenticate(raw).principal
                assert principal is not None
                tokens.append(
                    (
                        raw,
                        oauth_service(setup, provider).start(
                            GOOGLE, OAuthPurpose.LINK, None, principal
                        ),
                    )
                )

        def go(index: int) -> object:
            raw, started = tokens[index]
            return callback_in_new_session(
                db_engine,
                provider,
                started,
                sub="s-contested",
                email="shared@example.org",
                session_token=raw,
            )

        results = run_threads(2, go)

        outcomes = [r for r in results if isinstance(r, CallbackOutcome)]
        assert len(outcomes) == 2, results
        assert sorted(o.error or "ok" for o in outcomes) == ["identity_conflict", "ok"]
        assert count_rows(db_engine, AuthIdentity) == 1


def test_a_claim_racing_an_email_verification_never_leaves_a_half_claimed_account(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine):
        provider = FakeOAuthProvider()
        with Session(db_engine, expire_on_commit=False) as setup:
            user = make_account(setup, "claim@example.org", verified=False)
            user_id = user.id
            raw = issue_token(
                TokenRepository(setup),
                user,
                AuthTokenPurpose.EMAIL_VERIFICATION,
                VERIFICATION_TTL,
                START,
            )
            setup.commit()
        started = start_committed(db_engine, provider)

        def go(index: int) -> object:
            if index == 0:
                return callback_in_new_session(
                    db_engine, provider, started, sub="s-claim", email="claim@example.org"
                )
            with Session(db_engine, expire_on_commit=False) as session:
                clock = FakeClock()
                AuthService(
                    session,
                    make_test_settings(),
                    fast_passwords(),
                    clock,
                    PostgresRateLimiter(session, clock),
                ).verify_email(raw)
            return None

        results = run_threads(2, go)

        claim = results[0]
        assert isinstance(claim, CallbackOutcome), results
        assert results[1] is None or isinstance(results[1], AppError), results
        with Session(db_engine) as check:
            owner = check.get(User, user_id)
            assert owner is not None
            identities = check.scalars(
                select(AuthIdentity).where(AuthIdentity.user_id == user_id)
            ).all()
            if (
                identities
            ):  # claimed: the unverified party's password is gone and the mailbox is proven
                assert owner.password_hash is None and owner.email_verified_at is not None
            else:  # verified first: a normal verified account, untouched by Google
                assert owner.password_hash is not None and owner.email_verified_at is not None
                assert claim.error == "identity_conflict"
