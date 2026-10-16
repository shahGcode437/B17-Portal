"""Services and persistence behind the auth API: sessions, tokens, admin roles, the rate limiter,
audit events, retention, and the concurrency-sensitive guarantees (single-use tokens, the session
cap, admin grants).

The concurrency and CLI tests need real, committed rows seen by separate connections, so they
bypass the savepoint-isolated session and clean up with ``TRUNCATE`` in a ``finally``.
"""

import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, event, func, select, text
from sqlalchemy.orm import Session

from app.cli import admin as admin_cli
from app.cli import auth_maintenance as maintenance_cli
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.rate_limit import FORGOT_PASSWORD, LOGIN_FAILURES, REGISTER, RatePolicy
from app.core.security.tokens import hash_token, is_well_formed_token, new_token
from app.models import AuthEvent, AuthRateLimit, AuthSession, AuthToken, UserRole
from app.models.enums import AuthEventType, AuthTokenPurpose, RoleName, SessionRevokeReason
from app.services.admin_roles import AdminRoleError, AdminRoleService
from app.services.auth import AuthService
from app.services.auth_audit import AuthAuditService
from app.services.auth_maintenance import AuthMaintenanceService
from app.services.auth_sessions import SessionService
from app.services.rate_limit import PostgresRateLimiter
from tests.db.auth_helpers import (
    PASSWORD,
    START,
    AuthEnv,
    FakeClock,
    active_sessions_of,
    events_of,
    fast_passwords,
    make_account,
    make_test_settings,
    sessions_of,
)
from tests.db.helpers import raw_insert, violates


def audit_and_sessions(
    session: Session, clock: FakeClock
) -> tuple[AuthAuditService, SessionService]:
    audit = AuthAuditService(session, clock)
    return audit, SessionService(session, make_test_settings(), clock, audit)


# -- sessions: storage and constraints ------------------------------------------------------------------


def test_a_session_stores_only_the_hash_of_a_256_bit_token(db_session: Session) -> None:
    user = make_account(db_session)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)

    raw, row = sessions.create(user.id, "Mozilla/5.0 " + "x" * 400)
    db_session.commit()

    assert is_well_formed_token(raw) and len(raw) == 43  # 32 random bytes, URL-safe
    assert bytes(row.token_hash) == hash_token(raw) and len(row.token_hash) == 32
    assert row.user_agent is not None and len(row.user_agent) == 200  # truncated
    dump = db_session.scalar(text("SELECT string_agg(t::text, ' ') FROM auth_sessions t"))
    assert raw not in (dump or "")


def test_session_tokens_are_unique_and_unguessable_in_shape(db_session: Session) -> None:
    user = make_account(db_session)
    _, sessions = audit_and_sessions(db_session, FakeClock())

    tokens = {sessions.create(user.id, None)[0] for _ in range(30)}
    db_session.commit()

    assert len(tokens) == 30


def test_the_database_rejects_inconsistent_session_rows(db_session: Session) -> None:
    user = make_account(db_session)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)
    _, row = sessions.create(user.id, None)
    db_session.commit()
    base = {
        "user_id": user.id,
        "created_at": START,
        "last_seen_at": START,
        "expires_at": START + timedelta(days=1),
        "absolute_expires_at": START + timedelta(days=2),
    }

    with violates(db_session, "uq_auth_sessions_token_hash"):
        db_session.add(AuthSession(token_hash=bytes(row.token_hash), **base))
    with violates(db_session, "ck_auth_sessions_token_hash_length"):
        db_session.add(AuthSession(token_hash=b"too short", **base))
    with violates(db_session, "ck_auth_sessions_idle_within_absolute"):
        db_session.add(
            AuthSession(
                token_hash=hash_token(new_token()),
                **{**base, "expires_at": START + timedelta(days=3)},
            )
        )
    with violates(db_session, "ck_auth_sessions_revoked_consistent"):
        db_session.add(AuthSession(token_hash=hash_token(new_token()), revoked_at=START, **base))
    with violates(db_session, "ck_auth_sessions_revoke_reason_valid"):
        raw_insert(
            db_session,
            "auth_sessions",
            id=uuid.uuid4(),
            token_hash=hash_token(new_token()),
            revoked_at=START,
            revoke_reason="because",
            **base,
        )


def test_deleting_a_user_removes_its_sessions_and_tokens_but_keeps_the_audit_trail(
    db_session: Session,
) -> None:
    user = make_account(db_session)
    audit, sessions = audit_and_sessions(db_session, FakeClock())
    sessions.create(user.id, None)
    db_session.add(
        AuthToken(
            user_id=user.id,
            purpose=AuthTokenPurpose.PASSWORD_RESET,
            token_hash=hash_token(new_token()),
            email=user.email,
            expires_at=START + timedelta(hours=1),
            created_at=START,
        )
    )
    audit.record(AuthEventType.LOGIN_SUCCESS, user_id=user.id)
    db_session.commit()

    db_session.delete(user)
    db_session.commit()

    assert db_session.scalar(select(func.count()).select_from(AuthSession)) == 0
    assert db_session.scalar(select(func.count()).select_from(AuthToken)) == 0
    (event_row,) = events_of(db_session)
    assert event_row.user_id is None  # SET NULL: the record outlives the account


def test_rotation_replaces_the_secret_but_keeps_the_row_and_absolute_lifetime(
    db_session: Session,
) -> None:
    user = make_account(db_session)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)
    old_raw, row = sessions.create(user.id, None)
    db_session.commit()
    absolute = row.absolute_expires_at
    clock.advance(days=3)

    new_raw, _ = sessions.rotate(row.id)
    db_session.commit()

    assert new_raw != old_raw
    assert sessions.authenticate(old_raw).problem == "unknown"  # the old secret is gone
    result = sessions.authenticate(new_raw)
    assert result.principal is not None and result.principal.session_id == row.id
    db_session.refresh(row)
    assert row.absolute_expires_at == absolute


def test_the_cap_is_enforced_by_the_service_with_audit_events(db_session: Session) -> None:
    user = make_account(db_session)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)

    for _ in range(12):
        sessions.create(user.id, None)
        clock.advance(seconds=1)
    db_session.commit()

    assert len(active_sessions_of(db_session, user.id)) == 10
    revoked = [s for s in sessions_of(db_session, user.id) if s.revoked_at is not None]
    assert len(revoked) == 2 and {s.revoke_reason for s in revoked} == {
        SessionRevokeReason.SESSION_CAP
    }
    assert [r.created_at for r in revoked] == sorted(r.created_at for r in revoked)
    assert [r.id for r in revoked] == [s.id for s in sessions_of(db_session, user.id)[:2]]
    assert (
        len([e for e in events_of(db_session) if e.event_type is AuthEventType.SESSION_REVOKED])
        == 2
    )


@contextmanager
def count_updates(connection: Connection) -> Iterator[list[str]]:
    seen: list[str] = []

    def record(_c: Any, _cursor: Any, statement: str, *_rest: Any) -> None:
        if statement.lstrip().upper().startswith("UPDATE AUTH_SESSIONS"):
            seen.append(statement)

    event.listen(connection, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(connection, "before_cursor_execute", record)


def test_authenticated_requests_do_not_write_on_every_call(db_session: Session) -> None:
    user = make_account(db_session)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)
    raw, _ = sessions.create(user.id, None)
    db_session.commit()

    with count_updates(db_session.connection()) as updates:
        for _ in range(5):
            clock.advance(minutes=1)
            assert sessions.authenticate(raw).principal is not None
        assert len(updates) == 1  # the 5-minute throttle: one write for five requests
        clock.advance(minutes=6)
        assert sessions.authenticate(raw).refreshed_max_age is not None
        assert len(updates) == 2


# -- tokens ---------------------------------------------------------------------------------------------------


def test_the_database_rejects_bad_token_rows(db_session: Session) -> None:
    user = make_account(db_session)
    digest = hash_token(new_token())
    base = {
        "user_id": user.id,
        "email": user.email,
        "expires_at": START + timedelta(hours=1),
        "created_at": START,
    }
    db_session.add(
        AuthToken(token_hash=digest, purpose=AuthTokenPurpose.EMAIL_VERIFICATION, **base)
    )
    db_session.flush()

    with violates(db_session, "uq_auth_tokens_token_hash"):
        db_session.add(
            AuthToken(token_hash=digest, purpose=AuthTokenPurpose.PASSWORD_RESET, **base)
        )
    with violates(db_session, "ck_auth_tokens_token_hash_length"):
        db_session.add(
            AuthToken(token_hash=b"short", purpose=AuthTokenPurpose.PASSWORD_RESET, **base)
        )
    with violates(db_session, "ck_auth_tokens_purpose_valid"):
        raw_insert(
            db_session,
            "auth_tokens",
            id=uuid.uuid4(),
            token_hash=hash_token(new_token()),
            purpose="login_link",
            **base,
        )


# -- audit ----------------------------------------------------------------------------------------------------------


def test_audit_details_are_an_allow_list_of_short_strings(db_session: Session) -> None:
    user = make_account(db_session)
    audit = AuthAuditService(db_session, FakeClock())
    session_id = uuid.uuid4()

    audit.record(
        AuthEventType.LOGIN_SUCCESS,
        user_id=user.id,
        details={
            "provider": "google",
            "reason": "x" * 200,
            "session_id": session_id,
            "password": "hunter2",
            "token": "secret-token",
            "ip": "203.0.113.9",
            "user_agent": "Mozilla",
            "email": "someone@example.org",
        },
    )
    audit.record(AuthEventType.LOGOUT, user_id=user.id)
    db_session.commit()

    first, second = events_of(db_session)
    assert first.details == {
        "provider": "google",
        "reason": "x" * 64,
        "session_id": str(session_id),
    }
    assert second.details is None
    assert db_session.scalar(text("SELECT count(*) FROM auth_events WHERE details IS NULL")) == 1
    blob = str([(e.details, e.request_id) for e in events_of(db_session)])
    for secret in ("hunter2", "secret-token", "203.0.113.9", "Mozilla", "someone@example.org"):
        assert secret not in blob


def test_the_database_constrains_event_rows(db_session: Session) -> None:
    with violates(db_session, "ck_auth_events_event_type_valid"):
        raw_insert(db_session, "auth_events", id=uuid.uuid4(), event_type="coup")
    with violates(db_session, "ck_auth_events_details_object"):
        raw_insert(
            db_session,
            "auth_events",
            id=uuid.uuid4(),
            event_type="login_success",
            details="[1, 2]",
        )


def test_every_auth_flow_leaves_no_secret_in_the_audit_trail(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    api.register()
    api.post("/auth/forgot-password", {"email": "ayesha@example.org"})
    api.login(password="wrong wrong wrong")
    api.logout()
    api.login()
    api.post("/auth/logout-all")

    rows = auth_env.session.execute(text("SELECT t::text FROM auth_events t")).scalars().all()

    assert rows
    blob = " ".join(rows)
    assert PASSWORD not in blob and "wrong wrong wrong" not in blob
    assert "ayesha@example.org" not in blob and "$argon2" not in blob


# -- admin roles ----------------------------------------------------------------------------------------------------


def make_admin_service(session: Session, clock: FakeClock) -> AdminRoleService:
    return AdminRoleService(session, clock)


def test_granting_admin_adds_a_role_revokes_sessions_and_audits(db_session: Session) -> None:
    user = make_account(db_session)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)
    sessions.create(user.id, None)
    sessions.create(user.id, None)
    db_session.commit()

    change = make_admin_service(db_session, clock).grant_admin(user.email)

    assert change.changed and change.sessions_revoked == 2
    assert db_session.get(UserRole, (user.id, RoleName.ADMIN)) is not None
    assert active_sessions_of(db_session, user.id) == []
    assert {s.revoke_reason for s in sessions_of(db_session, user.id)} == {"role_change"}
    assert [e.event_type for e in events_of(db_session, user.id)] == [AuthEventType.ROLE_GRANTED]


def test_granting_twice_changes_nothing_and_never_duplicates_a_role(db_session: Session) -> None:
    user = make_account(db_session)
    service = make_admin_service(db_session, FakeClock())
    service.grant_admin(user.email)

    again = service.grant_admin(user.email)

    assert again.changed is False and again.sessions_revoked == 0
    assert db_session.scalar(select(func.count()).select_from(UserRole)) == 1
    assert len(events_of(db_session, user.id)) == 1


@pytest.mark.parametrize(
    ("account", "message"),
    [
        ({"verified": False}, "not verified"),
        ({"status": "suspended"}, "not active"),
        ({"status": "deleted"}, "not active"),
    ],
)
def test_only_active_verified_accounts_can_become_admin(
    db_session: Session, account: dict[str, Any], message: str
) -> None:
    user = make_account(db_session, **account)

    with pytest.raises(AdminRoleError, match=message):
        make_admin_service(db_session, FakeClock()).grant_admin(user.email)

    assert db_session.scalar(select(func.count()).select_from(UserRole)) == 0
    assert events_of(db_session) == []


def test_granting_admin_to_an_unknown_account_is_refused(db_session: Session) -> None:
    with pytest.raises(AdminRoleError, match="no account"):
        make_admin_service(db_session, FakeClock()).grant_admin("ghost@example.org")


def test_revoking_admin_removes_the_role_and_ends_sessions(db_session: Session) -> None:
    user = make_account(db_session, admin=True)
    clock = FakeClock()
    _, sessions = audit_and_sessions(db_session, clock)
    sessions.create(user.id, None)
    db_session.commit()

    change = make_admin_service(db_session, clock).revoke_admin(user.email)

    assert change.changed and change.sessions_revoked == 1
    assert db_session.scalar(select(func.count()).select_from(UserRole)) == 0
    assert [e.event_type for e in events_of(db_session, user.id)] == [AuthEventType.ROLE_REVOKED]
    assert make_admin_service(db_session, clock).revoke_admin(user.email).changed is False


def test_a_new_admin_must_sign_in_again_and_then_has_the_role(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    api = auth_env.client()
    api.login()
    assert api.me().json()["data"]["roles"] == []

    make_admin_service(auth_env.session, auth_env.clock).grant_admin(user.email)

    assert api.me().json()["error"]["code"] == "session_expired"  # privilege change ends sessions
    assert api.login().json()["data"]["roles"] == ["admin"]


# -- rate limiter ---------------------------------------------------------------------------------------------------


def limiter(session: Session, clock: FakeClock) -> PostgresRateLimiter:
    return PostgresRateLimiter(session, clock)


def test_the_limiter_allows_up_to_the_limit_then_blocks(db_session: Session) -> None:
    rate = limiter(db_session, FakeClock())
    policy = RatePolicy("t", limit=3, window_seconds=60)

    decisions = [rate.hit("someone", policy) for _ in range(5)]

    assert [d.allowed for d in decisions] == [True, True, True, False, False]
    assert 1 <= decisions[-1].retry_after_seconds <= 61


def test_blocked_peeks_without_counting(db_session: Session) -> None:
    rate = limiter(db_session, FakeClock())
    policy = RatePolicy("t", limit=2, window_seconds=60)

    for _ in range(10):
        assert rate.blocked("x", policy).allowed
    rate.hit("x", policy)
    assert rate.blocked("x", policy).allowed
    rate.hit("x", policy)
    assert not rate.blocked("x", policy).allowed
    assert db_session.scalar(select(AuthRateLimit.count)) == 2  # peeking never counted


def test_a_new_window_starts_clean(db_session: Session) -> None:
    clock = FakeClock()
    rate = limiter(db_session, clock)
    policy = RatePolicy("t", limit=1, window_seconds=60)
    rate.hit("x", policy)
    assert not rate.hit("x", policy).allowed

    clock.advance(seconds=61)

    assert rate.hit("x", policy).allowed


def test_identifiers_and_policies_are_independent(db_session: Session) -> None:
    rate = limiter(db_session, FakeClock())
    one = RatePolicy("one", limit=1, window_seconds=60)
    two = RatePolicy("two", limit=1, window_seconds=60)
    rate.hit("alice", one)

    assert not rate.hit("alice", one).allowed
    assert rate.hit("bob", one).allowed
    assert rate.hit("alice", two).allowed


def test_two_limiter_instances_share_state_through_postgres(db_session: Session) -> None:
    """No in-process state: a second 'worker' sees the first one's counts."""
    clock = FakeClock()
    policy = RatePolicy("t", limit=2, window_seconds=60)
    limiter(db_session, clock).hit("x", policy)
    limiter(db_session, clock).hit("x", policy)

    assert not limiter(db_session, clock).hit("x", policy).allowed


def test_the_limiter_stores_hashes_not_identities(db_session: Session) -> None:
    limiter(db_session, FakeClock()).hit("ayesha@example.org", REGISTER)
    limiter(db_session, FakeClock()).hit("ayesha@example.org", LOGIN_FAILURES)

    rows = db_session.scalars(select(AuthRateLimit)).all()

    assert {r.policy for r in rows} == {"register", "login_failures"}
    assert all(len(r.key_hash) == 32 for r in rows)
    assert "ayesha" not in " ".join(
        db_session.execute(text("SELECT t::text FROM auth_rate_limits t")).scalars()
    )


def test_the_frozen_policy_numbers() -> None:
    assert (LOGIN_FAILURES.limit, LOGIN_FAILURES.window_seconds) == (10, 900)
    assert (REGISTER.limit, REGISTER.window_seconds) == (5, 3600)
    assert (FORGOT_PASSWORD.limit, FORGOT_PASSWORD.window_seconds) == (3, 3600)


# -- retention ----------------------------------------------------------------------------------------------------


def test_purge_removes_only_what_is_past_retention(db_session: Session) -> None:
    user = make_account(db_session)
    now = START + timedelta(days=500)
    clock = FakeClock(now)

    def session_row(**kw: Any) -> AuthSession:
        base = {
            "user_id": user.id,
            "token_hash": hash_token(new_token()),
            "created_at": now - timedelta(days=60),
            "last_seen_at": now - timedelta(days=60),
            "expires_at": now + timedelta(days=1),
            "absolute_expires_at": now + timedelta(days=2),
        }
        base.update(kw)
        return AuthSession(**base)

    keep_active = session_row()
    keep_recent_expired = session_row(
        expires_at=now - timedelta(days=6), absolute_expires_at=now - timedelta(days=6)
    )
    drop_expired = session_row(
        expires_at=now - timedelta(days=8), absolute_expires_at=now - timedelta(days=8)
    )
    drop_revoked = session_row(
        revoked_at=now - timedelta(days=8), revoke_reason=SessionRevokeReason.LOGOUT
    )
    keep_revoked = session_row(
        revoked_at=now - timedelta(days=2), revoke_reason=SessionRevokeReason.LOGOUT
    )

    def token(**kw: Any) -> AuthToken:
        return AuthToken(
            user_id=user.id,
            purpose=AuthTokenPurpose.PASSWORD_RESET,
            token_hash=hash_token(new_token()),
            email=user.email,
            created_at=now - timedelta(days=30),
            **{"expires_at": now + timedelta(hours=1), **kw},
        )

    keep_token = token()
    drop_old_expired = token(expires_at=now - timedelta(days=8))
    drop_old_consumed = token(consumed_at=now - timedelta(days=8))
    keep_new_consumed = token(consumed_at=now - timedelta(days=1))

    def event_row(age_days: int) -> AuthEvent:
        return AuthEvent(
            occurred_at=now - timedelta(days=age_days),
            user_id=user.id,
            event_type=AuthEventType.LOGIN_SUCCESS,
        )

    old_event, recent_event = event_row(401), event_row(399)
    fresh_event = event_row(0)

    def window(days: int) -> AuthRateLimit:
        return AuthRateLimit(
            key_hash=hash_token(str(days)),
            policy="t",
            window_start=now - timedelta(days=days),
            count=1,
        )

    stale_window, live_window = window(3), window(1)
    db_session.add_all(
        [keep_active, keep_recent_expired, drop_expired, drop_revoked, keep_revoked]
        + [keep_token, drop_old_expired, drop_old_consumed, keep_new_consumed]
        + [old_event, recent_event, fresh_event, stale_window, live_window]
    )
    db_session.commit()
    kept_sessions = {keep_active.id, keep_recent_expired.id, keep_revoked.id}
    kept_tokens = {keep_token.id, keep_new_consumed.id}

    counts = AuthMaintenanceService(db_session, clock).purge()

    assert (counts.sessions, counts.tokens, counts.rate_limits, counts.events) == (2, 2, 1, 1)
    assert set(db_session.scalars(select(AuthSession.id))) == kept_sessions
    assert set(db_session.scalars(select(AuthToken.id))) == kept_tokens
    assert db_session.scalar(select(func.count()).select_from(AuthEvent)) == 2  # recent ones stay
    assert db_session.scalar(select(func.count()).select_from(AuthRateLimit)) == 1
    again = AuthMaintenanceService(db_session, clock).purge()
    assert (again.sessions, again.tokens, again.rate_limits, again.events) == (0, 0, 0, 0)


def test_correctness_never_depends_on_the_purge(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    api = auth_env.client()
    api.login()
    auth_env.clock.advance(days=40)  # long expired, never purged

    assert api.me().json()["error"]["code"] == "session_expired"
    assert sessions_of(auth_env.session, user.id)  # the dead row is still there, and harmless


# -- concurrency (committed rows, separate connections) -----------------------------------------------------------


AUTH_TABLES = "users, auth_sessions, auth_tokens, auth_events, auth_rate_limits"


@contextmanager
def committed_world(engine: Engine) -> Iterator[None]:
    try:
        yield
    finally:
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE {AUTH_TABLES} CASCADE"))


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


def service_for(engine: Engine) -> tuple[Session, AuthService]:
    session = Session(engine, expire_on_commit=False)
    clock = FakeClock()
    service = AuthService(
        session, make_test_settings(), fast_passwords(), clock, PostgresRateLimiter(session, clock)
    )
    return session, service


def test_concurrent_redemptions_of_one_token_have_exactly_one_winner(db_engine: Engine) -> None:
    with committed_world(db_engine):
        with Session(db_engine) as setup:
            user = make_account(setup, verified=False)
            raw = new_token()
            setup.add(
                AuthToken(
                    user_id=user.id,
                    purpose=AuthTokenPurpose.EMAIL_VERIFICATION,
                    token_hash=hash_token(raw),
                    email=user.email,
                    expires_at=START + timedelta(hours=1),
                    created_at=START,
                )
            )
            setup.commit()

        def redeem(_: int) -> object:
            session, service = service_for(db_engine)
            try:
                service.verify_email(raw)
                return None
            finally:
                session.close()

        results = run_threads(6, redeem)

        winners = [r for r in results if r is None]
        losers = [r for r in results if isinstance(r, AppError)]
        assert len(winners) == 1 and len(losers) == 5, results
        assert {error.code for error in losers} == {"token_invalid"}


def test_concurrent_logins_never_exceed_the_session_cap(db_engine: Engine) -> None:
    with committed_world(db_engine):
        with Session(db_engine) as setup:
            user = make_account(setup)
            clock = FakeClock()
            _, sessions = audit_and_sessions(setup, clock)
            for _ in range(9):
                sessions.create(user.id, None)
                clock.advance(seconds=1)
            setup.commit()
            user_id = user.id

        def login(_: int) -> object:
            session, service = service_for(db_engine)
            try:
                return service.login(email="ayesha@example.org", password=PASSWORD, user_agent=None)
            finally:
                session.close()

        results = run_threads(4, login)

        assert all(not isinstance(r, Exception) for r in results), results  # no login rejected
        with Session(db_engine) as check:
            assert len(active_sessions_of(check, user_id)) == 10
            revoked = [s for s in sessions_of(check, user_id) if s.revoked_at is not None]
            assert len(revoked) == 3  # 9 + 4 = 13 -> three oldest revoked, atomically
            assert {s.revoke_reason for s in revoked} == {SessionRevokeReason.SESSION_CAP}


def test_concurrent_admin_grants_create_one_role(db_engine: Engine) -> None:
    with committed_world(db_engine):
        with Session(db_engine) as setup:
            user = make_account(setup)
            email, user_id = user.email, user.id

        def grant(_: int) -> object:
            with Session(db_engine, expire_on_commit=False) as session:
                return AdminRoleService(session, FakeClock()).grant_admin(email).changed

        results = run_threads(4, grant)

        assert sorted(results, key=str) == [False, False, False, True], results
        with Session(db_engine) as check:
            assert check.scalar(select(func.count()).select_from(UserRole)) == 1
            events = events_of(check, user_id)
            assert [e.event_type for e in events] == [AuthEventType.ROLE_GRANTED]


# -- the operator CLIs, end to end against the test database -------------------------------------------------------


@pytest.fixture
def cli_database(db_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    monkeypatch.setenv("DATABASE_URL", db_engine.url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    with committed_world(db_engine):
        try:
            yield db_engine
        finally:
            get_settings.cache_clear()


def test_the_admin_cli_grants_and_revokes_for_a_verified_account(
    cli_database: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    with Session(cli_database) as setup:
        make_account(setup, "cli@example.org")

    assert admin_cli.main(["grant", "  CLI@Example.org "]) == 0
    assert "Admin role granted" in capsys.readouterr().out
    with Session(cli_database) as check:
        assert check.scalar(select(func.count()).select_from(UserRole)) == 1
    assert admin_cli.main(["grant", "cli@example.org"]) == 0
    assert "No change" in capsys.readouterr().out

    assert admin_cli.main(["revoke", "cli@example.org"]) == 0
    with Session(cli_database) as check:
        assert check.scalar(select(func.count()).select_from(UserRole)) == 0


def test_the_admin_cli_refuses_unverified_unknown_and_suspended_accounts(
    cli_database: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    with Session(cli_database) as setup:
        make_account(setup, "unverified@example.org", verified=False)
        make_account(setup, "suspended@example.org", status="suspended")

    for email in ("unverified@example.org", "suspended@example.org", "ghost@example.org"):
        assert admin_cli.main(["grant", email]) == 1
    assert "Refused" in capsys.readouterr().err
    with Session(cli_database) as check:
        assert check.scalar(select(func.count()).select_from(UserRole)) == 0


def test_the_clis_need_a_database(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()

    assert admin_cli.main(["grant", "x@example.org"]) == 1
    assert maintenance_cli.main(["purge"]) == 1
    assert "DATABASE_URL is not set" in capsys.readouterr().err
    get_settings.cache_clear()


def test_the_maintenance_cli_purges(
    cli_database: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    with Session(cli_database) as setup:
        user = make_account(setup)
        setup.add(
            AuthEvent(
                occurred_at=START - timedelta(days=1000),
                user_id=user.id,
                event_type=AuthEventType.LOGIN_SUCCESS,
            )
        )
        setup.commit()

    assert maintenance_cli.main(["purge"]) == 0

    assert "1 audit event(s)" in capsys.readouterr().out
    with Session(cli_database) as check:
        assert check.scalar(select(func.count()).select_from(AuthEvent)) == 0
