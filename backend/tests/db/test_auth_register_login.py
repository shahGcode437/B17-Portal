"""Registration, login and the session they create (real PostgreSQL, real app)."""

import hashlib
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.security.passwords import PasswordService
from app.core.security.tokens import csrf_token_for, hash_token
from app.models import AuthSession, AuthToken, User
from app.models.enums import AuthEventType
from app.services.auth_sessions import SessionService
from tests.db.auth_helpers import (
    ORIGIN,
    PASSWORD,
    AuthEnv,
    active_sessions_of,
    count,
    events_of,
    last_token,
    make_account,
    sessions_of,
    token_row,
)

EMAIL = "ayesha@example.org"


def user_by_email(session: Session, email: str = EMAIL) -> User:
    return session.scalars(select(User).where(User.email == email)).one()


def set_cookie(response) -> str:  # type: ignore[no-untyped-def]
    return str(response.headers["set-cookie"])


# -- register ----------------------------------------------------------------------------------


def test_register_creates_a_resident_signs_in_and_sets_a_safe_cookie(auth_env: AuthEnv) -> None:
    api = auth_env.client()

    response = api.register()

    assert response.status_code == 201
    data = response.json()["data"]
    assert set(data) == {
        "id",
        "displayName",
        "email",
        "emailVerified",
        "roles",
        "authMethods",
        "session",
        "csrfToken",
    }
    assert data["email"] == EMAIL and data["displayName"] == "Ayesha Khan"
    assert data["emailVerified"] is False
    assert data["roles"] == []  # Resident is implicit: no role row, no "resident" value
    assert "professional" not in data
    assert data["authMethods"] == {"password": True, "providers": []}
    assert response.headers["cache-control"] == "no-store"
    cookie = set_cookie(response).lower()
    assert cookie.startswith("b17_session=")
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie
    assert "secure" not in cookie and "domain" not in cookie  # development: host-only, no Secure
    # the session secret is only in the cookie; the body carries only the derived CSRF token
    assert api.session_cookie is not None
    assert api.session_cookie not in response.text
    assert data["csrfToken"] == csrf_token_for(api.session_cookie)


def test_register_persists_only_hashes_and_a_normalized_email(auth_env: AuthEnv) -> None:
    api = auth_env.client()

    api.register(email="  Ayesha@Example.ORG ")

    user = user_by_email(auth_env.session)
    assert user.password_hash is not None and user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    (session_row,) = sessions_of(auth_env.session, user.id)
    token = api.session_cookie
    assert token is not None
    assert bytes(session_row.token_hash) == hashlib.sha256(token.encode()).digest()
    # the raw session token (and the raw verification token) are nowhere in the database
    raw_verification = last_token(auth_env, "email_verification")
    for table in ("auth_sessions", "auth_tokens", "auth_events", "users"):
        dump = auth_env.session.scalar(text(f"SELECT string_agg(t::text, ' ') FROM {table} t"))
        assert token not in (dump or "") and raw_verification not in (dump or "")
    row = token_row(auth_env.session, raw_verification)
    assert row is not None and row.email == EMAIL and row.consumed_at is None
    assert (row.expires_at - row.created_at).total_seconds() == 24 * 3600


def test_the_raw_verification_token_never_appears_in_the_register_response(
    auth_env: AuthEnv,
) -> None:
    """The raw token goes only to the EmailSender; PostgreSQL keeps only its hash."""
    api = auth_env.client()

    response = api.register()

    raw = last_token(auth_env, "email_verification")  # inspectable only via the in-memory sender
    assert response.status_code == 201
    assert raw not in response.text and raw not in str(dict(response.headers))
    assert hash_token(raw).hex() not in response.text
    # the only token-like field in the body is the session-derived CSRF token
    body = response.json()["data"]
    assert [key for key in body if "token" in key.lower()] == ["csrfToken"]
    assert body["csrfToken"] != raw
    row = token_row(auth_env.session, raw)
    assert row is not None and bytes(row.token_hash) == hash_token(raw)
    columns = {c.name for c in AuthToken.__table__.columns}
    assert not any(name in columns for name in ("token", "raw_token", "secret"))
    stored = auth_env.session.scalar(text("SELECT string_agg(t::text, ' ') FROM auth_tokens t"))
    assert raw not in (stored or "")


def test_forgot_and_resend_responses_never_carry_their_tokens_either(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    api.register()
    auth_env.clock.advance(minutes=2)

    resend = api.post("/auth/resend-verification")
    forgot = api.post("/auth/forgot-password", {"email": EMAIL})

    verification = last_token(auth_env, "email_verification")
    reset = last_token(auth_env, "password_reset")
    for response in (resend, forgot):
        text_all = response.text + str(dict(response.headers))
        assert verification not in text_all and reset not in text_all


def test_register_queues_a_verification_email_with_a_fragment_link(auth_env: AuthEnv) -> None:
    auth_env.client().register()

    message = auth_env.outbox.last("email_verification")
    assert message is not None and message.to == EMAIL
    assert message.link is not None and message.link.startswith(f"{ORIGIN}/verify-email#token=")


def test_register_audits_without_secrets(auth_env: AuthEnv) -> None:
    auth_env.client().register()

    user = user_by_email(auth_env.session)
    kinds = [event.event_type for event in events_of(auth_env.session, user.id)]
    assert kinds == [AuthEventType.REGISTER, AuthEventType.EMAIL_VERIFICATION_SENT]
    blob = str([(e.details, e.request_id) for e in events_of(auth_env.session)])
    assert PASSWORD not in blob and EMAIL not in blob


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("AYESHA@EXAMPLE.ORG", "ayesha@example.org"),
        ("  ayesha@example.org  ", "ayesha@example.org"),
    ],
)
def test_register_normalizes_email_and_rejects_case_only_duplicates(
    auth_env: AuthEnv, typed: str, stored: str
) -> None:
    api = auth_env.client()
    assert api.register(email=typed).status_code == 201
    assert user_by_email(auth_env.session, stored).email == stored

    again = auth_env.client().register(email="Ayesha@example.org")

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "email_already_registered"
    assert count(auth_env.session, "users") == 1


def test_register_does_not_fold_plus_tags_or_dots(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    assert api.register(email="ayesha@example.org").status_code == 201
    assert auth_env.client().register(email="ayesha+news@example.org").status_code == 201
    assert auth_env.client().register(email="a.yesha@example.org").status_code == 201
    assert count(auth_env.session, "users") == 3


@pytest.mark.parametrize(
    ("password", "code"),
    [
        ("tiny-pw1", "password_too_short"),
        ("123456789", "password_too_short"),
        ("x" * 129, "password_too_long"),
        ("1234567890", "password_too_common"),
        ("QWERTYUIOP", "password_too_common"),
        ("longlocalpart", "password_matches_email"),
        ("Ayesha Khan Lodhi", "password_matches_name"),
    ],
)
def test_register_enforces_the_password_policy(auth_env: AuthEnv, password: str, code: str) -> None:
    response = auth_env.client().register(
        email="longlocalpart@example.org", password=password, display_name="Ayesha Khan Lodhi"
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert code in [d["code"] for d in error["details"]]
    assert all(d["field"] == "password" for d in error["details"])
    assert password not in response.text  # never echoed
    assert count(auth_env.session, "users") == 0


def test_a_long_passphrase_without_symbols_or_digits_is_accepted(auth_env: AuthEnv) -> None:
    assert auth_env.client().register(password="just words and spaces").status_code == 201


@pytest.mark.parametrize(
    "extra",
    [
        {"role": "admin"},
        {"admin": True},
        {"professional": True},
        {"ownerId": str(uuid.uuid4())},
        {"emailVerified": True},
        {"status": "active"},
        {"planCode": "premium"},
    ],
)
def test_register_rejects_sensitive_extra_fields(auth_env: AuthEnv, extra: dict) -> None:  # type: ignore[type-arg]
    body = {"email": EMAIL, "password": PASSWORD, "displayName": "Ayesha Khan", **extra}

    response = auth_env.client().post("/auth/register", body)

    assert response.status_code == 422
    assert count(auth_env.session, "users") == 0


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email", "password": PASSWORD, "displayName": "Ayesha"},
        {"email": EMAIL, "password": PASSWORD, "displayName": "A"},
        {"email": EMAIL, "password": PASSWORD},
        {"email": EMAIL, "password": 12345678901234, "displayName": "Ayesha"},
        {"email": EMAIL, "password": PASSWORD, "displayName": "Bad\x00Name"},
    ],
)
def test_register_validation_errors_never_echo_input(auth_env: AuthEnv, body: dict) -> None:  # type: ignore[type-arg]
    response = auth_env.client().post("/auth/register", body)

    assert response.status_code == 422
    for value in body.values():
        assert str(value) not in response.text or str(value) in {"Ayesha", EMAIL}


def test_register_requires_json(auth_env: AuthEnv) -> None:
    response = auth_env.client().post(
        "/auth/register",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        content=b"email=a%40b.org&password=x",
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "bad_request"


def test_register_is_atomic_when_a_later_step_fails(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(self: SessionService, *args: object, **kwargs: object) -> None:
        raise RuntimeError("simulated failure after the user row was inserted")

    monkeypatch.setattr(SessionService, "create", boom)

    response = auth_env.client().register()

    assert response.status_code == 500
    for table in ("users", "auth_tokens", "auth_sessions", "auth_events"):
        assert count(auth_env.session, table) == 0, table


def test_an_email_outage_never_undoes_a_committed_account(auth_env: AuthEnv) -> None:
    class Broken:
        def send(self, message: object) -> None:
            raise ConnectionError("smtp is down")

    auth_env.app.state.email_sender = Broken()

    response = auth_env.client().register()

    assert response.status_code == 201
    assert user_by_email(auth_env.session).email == EMAIL


def test_register_is_rate_limited_per_email(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    assert api.register().status_code == 201
    statuses = [auth_env.client().register().status_code for _ in range(4)]
    assert statuses == [409, 409, 409, 409]  # attempts 2-5 still within the limit of 5

    blocked = auth_env.client().register()

    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) > 0
    auth_env.clock.advance(hours=1, seconds=1)
    assert auth_env.client().register().status_code == 409  # a new window


# -- login -------------------------------------------------------------------------------------------


def test_login_issues_a_fresh_session_and_never_reuses_an_old_token(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    # a pre-login cookie planted by an attacker (fixation) must never become authenticated
    planted = "A" * 43
    response = api.login(headers={"Cookie": f"{api.cookie_name}={planted}"})

    assert response.status_code == 200
    assert api.session_cookie != planted
    victim_view = auth_env.client()
    stale = victim_view.me(headers={"Cookie": f"{victim_view.cookie_name}={planted}"})
    assert stale.status_code == 401
    user = user_by_email(auth_env.session)
    assert len(active_sessions_of(auth_env.session, user.id)) == 1
    assert user.last_login_at is not None


def test_login_response_is_a_safe_me_shape(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, admin=True)
    api = auth_env.client()

    response = api.login()

    data = response.json()["data"]
    assert data["roles"] == ["admin"] and data["emailVerified"] is True
    assert response.headers["cache-control"] == "no-store"
    text_body = response.text.lower()
    for forbidden in ("argon2", "password_hash", "passwordhash", "tokenhash", "providersubject"):
        assert forbidden not in text_body
    assert api.session_cookie is not None and api.session_cookie not in response.text


def test_login_failures_share_one_public_shape(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    make_account(auth_env.session, "social@example.org", password=None)
    passwords: PasswordService = auth_env.app.state.password_service
    attempts = [
        ("ayesha@example.org", "wrong password entirely"),  # wrong password
        ("nobody@example.org", PASSWORD),  # unknown account
        ("social@example.org", PASSWORD),  # social-only account
        ("not even an email", PASSWORD),  # malformed identifier
    ]

    shapes = []
    for email, password in attempts:
        response = auth_env.client().login(email=email, password=password)
        error = response.json()["error"]
        shapes.append((response.status_code, error["code"], error["message"], error.get("details")))
        assert "set-cookie" not in response.headers

    assert len(set(shapes)) == 1
    assert shapes[0][:2] == (401, "invalid_credentials")
    assert passwords.dummy_verifications == 3  # unknown, social-only, malformed ran the dummy path


def test_login_is_case_and_whitespace_insensitive(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)

    assert auth_env.client().login(email="  AYESHA@Example.org ").status_code == 200


def test_unverified_users_can_log_in(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, verified=False)

    response = auth_env.client().login()

    assert response.status_code == 200 and response.json()["data"]["emailVerified"] is False


def test_suspended_accounts_cannot_log_in_but_the_wrong_password_reveals_nothing(
    auth_env: AuthEnv,
) -> None:
    make_account(auth_env.session, status="suspended")

    correct = auth_env.client().login()
    wrong = auth_env.client().login(password="not the right password")

    assert (correct.status_code, correct.json()["error"]["code"]) == (403, "account_disabled")
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (401, "invalid_credentials")
    assert "set-cookie" not in correct.headers


def test_deleted_accounts_look_like_unknown_accounts(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, status="deleted")

    response = auth_env.client().login()

    assert response.json()["error"]["code"] == "invalid_credentials"


def test_login_upgrades_a_hash_with_outdated_parameters(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)  # hashed with time_cost=1
    before = user.password_hash
    auth_env.app.state.password_service = PasswordService(
        time_cost=2, memory_cost_kib=64, parallelism=1, max_concurrent=2
    )

    assert auth_env.client().login().status_code == 200

    auth_env.session.refresh(user)
    assert user.password_hash != before
    assert auth_env.app.state.password_service.verify_password(user.password_hash, PASSWORD)
    assert not auth_env.app.state.password_service.needs_rehash(user.password_hash)


def test_login_is_rate_limited_per_email_and_counts_only_failures(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    for _ in range(10):
        assert auth_env.client().login(password="wrong wrong wrong").status_code == 401

    blocked = auth_env.client().login()  # even the correct password waits for the window

    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
    auth_env.clock.advance(minutes=15, seconds=1)
    assert auth_env.client().login().status_code == 200


def test_successful_logins_do_not_consume_the_failure_budget(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)

    for _ in range(12):
        assert auth_env.client().login().status_code == 200


def test_login_audits_success_and_known_failures_only(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    auth_env.client().login(password="wrong wrong wrong")
    auth_env.client().login(email="ghost@example.org")
    auth_env.client().login()

    kinds = [e.event_type for e in events_of(auth_env.session)]
    assert kinds == [AuthEventType.LOGIN_FAILURE, AuthEventType.LOGIN_SUCCESS]
    assert all(e.user_id == user.id for e in events_of(auth_env.session))  # none for "ghost"


# -- the 10-session cap ----------------------------------------------------------------------------------


def test_many_devices_can_be_signed_in_at_once(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    devices = [auth_env.client() for _ in range(4)]
    for device in devices:
        assert device.login().status_code == 200

    assert len(active_sessions_of(auth_env.session, user.id)) == 4
    assert all(device.me().status_code == 200 for device in devices)


def test_the_eleventh_login_succeeds_and_revokes_the_oldest_session(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    devices = []
    for _ in range(10):
        device = auth_env.client()
        assert device.login().status_code == 200
        devices.append(device)
        auth_env.clock.advance(seconds=1)

    newest = auth_env.client()
    assert newest.login().status_code == 200  # never rejected because the cap was reached

    active = active_sessions_of(auth_env.session, user.id)
    assert len(active) == 10
    revoked = [s for s in sessions_of(auth_env.session, user.id) if s.revoked_at is not None]
    assert len(revoked) == 1 and revoked[0].revoke_reason == "session_cap"
    assert devices[0].me().json()["error"]["code"] == "session_expired"  # the oldest lost
    assert all(d.me().status_code == 200 for d in devices[1:])
    assert newest.me().status_code == 200
    capped = [
        e
        for e in events_of(auth_env.session, user.id)
        if e.event_type is AuthEventType.SESSION_REVOKED
    ]
    assert len(capped) == 1
    assert capped[0].details == {"reason": "session_cap", "session_id": str(revoked[0].id)}


def test_cap_ties_break_deterministically_on_session_id(auth_env: AuthEnv) -> None:
    """Sessions created at the same instant: the lowest id is the 'oldest'."""
    user = make_account(auth_env.session)
    for _ in range(10):  # the fake clock does not move: identical created_at for all
        assert auth_env.client().login().status_code == 200
    ids = sorted(s.id for s in active_sessions_of(auth_env.session, user.id))

    assert auth_env.client().login().status_code == 200

    revoked = [s.id for s in sessions_of(auth_env.session, user.id) if s.revoked_at is not None]
    assert revoked == [ids[0]]


def test_the_cap_holds_across_many_logins(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)

    for _ in range(25):
        assert auth_env.client().login().status_code == 200
        auth_env.clock.advance(seconds=1)

    assert len(active_sessions_of(auth_env.session, user.id)) == 10
    assert count(auth_env.session, "auth_sessions") <= 25


def test_expired_sessions_do_not_count_towards_the_cap(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    for _ in range(10):
        auth_env.client().login()
    auth_env.clock.advance(days=15)  # all ten are now idle-expired

    assert auth_env.client().login().status_code == 200

    assert len(active_sessions_of(auth_env.session, user.id)) == 1
    revoked = [s for s in sessions_of(auth_env.session, user.id) if s.revoked_at is not None]
    assert revoked == []  # nothing needed revoking: expired sessions never count toward the cap
    # ...and login opportunistically deleted the user's expired rows (no retention guarantee)
    assert len(sessions_of(auth_env.session, user.id)) == 1


def test_session_ids_are_never_secrets(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    api.login()

    session_id = str(auth_env.session.scalars(select(AuthSession.id)).one())

    assert session_id != api.session_cookie
    assert session_id not in api.http.cookies.values()
