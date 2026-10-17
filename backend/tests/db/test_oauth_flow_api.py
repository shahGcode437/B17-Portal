"""Google sign-in over HTTP: start, callback, the account-resolution cases, Connect and Disconnect.

The real app runs end to end on PostgreSQL; only the provider is the in-process fake (which still
enforces PKCE and the nonce). Phase 11A security matrix S14.
"""

import logging
from datetime import timedelta

import pytest
from httpx import Response
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security.tokens import hash_token
from app.models import AuthIdentity, AuthToken, OAuthFlow, User
from app.models.enums import (
    AuthEventType,
    AuthProvider,
    OAuthPurpose,
    PlanCode,
    SessionRevokeReason,
)
from app.services.oauth.fake import fake_code
from app.services.oauth.flow import OAuthService
from app.services.oauth.provider import code_challenge_s256
from tests.db.auth_helpers import (
    ORIGIN,
    OTHER_PASSWORD,
    PASSWORD,
    AuthApi,
    AuthEnv,
    active_sessions_of,
    count,
    events_of,
    last_token,
    make_account,
    sessions_of,
)
from tests.db.oauth_helpers import (
    CALLBACK,
    DISCONNECT,
    START,
    Started,
    callback,
    fake_provider,
    location,
    start,
    started_ok,
)

SUB = "google-sub-1001"
GMAIL = "gina@example.org"


def google_code(sub: str = SUB, email: str = GMAIL, **kw: object) -> str:
    return fake_code(sub, email, **kw)  # type: ignore[arg-type]


def error_url(code: str) -> str:
    return f"{ORIGIN}/login?error={code}"


def sign_in(
    env: AuthEnv,
    code: str | None = None,
    *,
    api: AuthApi | None = None,
    return_to: str | None = None,
) -> tuple[AuthApi, Response, Started]:
    api = api or env.client()
    started = started_ok(api, return_to=return_to)
    response = callback(api, code or google_code(), state=started.state)
    return api, response, started


def user_with_email(session: Session, email: str) -> User:
    return session.scalars(select(User).where(User.email == email)).one()


def identities(session: Session) -> list[AuthIdentity]:
    return list(session.scalars(select(AuthIdentity)))


# -- start ---------------------------------------------------------------------------------------------


def test_login_start_returns_the_provider_url_and_binds_the_browser(auth_env: AuthEnv) -> None:
    api = auth_env.client()

    started = started_ok(api)

    query = started.query
    assert query["response_type"] == "code" and query["scope"] == "openid email profile"
    assert query["code_challenge_method"] == "S256"
    # the redirect URI is the one exact registered value, built from configuration only
    assert query["redirect_uri"] == "http://127.0.0.1:8000/api/v1/auth/oauth/google/callback"
    assert len(started.state) == 43 and len(started.nonce) == 43 and len(started.challenge) == 43
    assert started.response.headers["cache-control"] == "no-store"
    cookie = started.response.headers["set-cookie"]
    attributes = {part.strip().lower() for part in cookie.split(";")[1:]}
    assert cookie.startswith("b17_oauth=")
    assert {"httponly", "samesite=lax", "path=/", "max-age=600"} <= attributes
    assert not any(a.startswith(("domain", "secure")) for a in attributes)  # development flags
    assert started.flow_cookie and started.flow_cookie != started.state
    # nothing is signed in yet
    assert count(auth_env.session, "auth_sessions") == 0
    assert api.session_cookie is None


def test_the_flow_row_stores_hashes_never_the_secrets(auth_env: AuthEnv) -> None:
    started = started_ok(auth_env.client(), return_to="/saved")

    (flow,) = auth_env.session.scalars(select(OAuthFlow)).all()

    assert bytes(flow.state_hash) == hash_token(started.state)
    assert bytes(flow.flow_cookie_hash) == hash_token(started.flow_cookie or "")
    assert flow.provider is AuthProvider.GOOGLE and flow.purpose is OAuthPurpose.LOGIN
    assert flow.user_id is None and flow.return_to == "/saved" and flow.consumed_at is None
    assert (flow.expires_at - flow.created_at) == timedelta(minutes=10)
    assert (
        code_challenge_s256(flow.code_verifier) == started.challenge
    )  # PKCE: S256 of the verifier
    assert flow.nonce == started.nonce
    dump = auth_env.session.scalar(text("SELECT string_agg(t::text, ' ') FROM oauth_flows t"))
    assert started.state not in (dump or "") and (started.flow_cookie or "") not in (dump or "")
    # the verifier is never sent to the browser, the provider URL or the response body
    assert flow.code_verifier not in started.url and flow.code_verifier not in started.response.text


@pytest.mark.parametrize("origin", [None, "https://evil.example", "null", "http://localhost:5173"])
def test_login_start_needs_an_exact_allowed_origin(auth_env: AuthEnv, origin: str | None) -> None:
    response = start(auth_env.client(), origin=origin).response

    assert response.status_code == 403 and response.json()["error"]["code"] == "csrf_failed"
    assert count(auth_env.session, "oauth_flows") == 0


def test_login_start_needs_no_csrf_token_before_a_session_exists(auth_env: AuthEnv) -> None:
    assert start(auth_env.client(), csrf=None).response.status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"purpose": "login", "redirectUri": "https://evil.example/cb"},
        {"purpose": "login", "provider": "facebook"},
        {"purpose": "login", "state": "attacker-chosen"},
        {"purpose": "login", "userId": "x"},
        {"purpose": "register"},
        {"purpose": 1},
    ],
)
def test_start_accepts_only_the_documented_fields(auth_env: AuthEnv, body: dict) -> None:  # type: ignore[type-arg]
    response = auth_env.client().post(START, body)

    assert response.status_code == 422 and count(auth_env.session, "oauth_flows") == 0


def test_start_requires_json_and_a_valid_body(auth_env: AuthEnv) -> None:
    api = auth_env.client()

    assert api.post(START, headers={"Content-Type": "text/plain"}, content=b"{}").status_code == 415
    assert api.post(START, {}).status_code == 200  # purpose defaults to login


def test_google_signin_is_unavailable_when_not_configured(
    auth_env: AuthEnv, db_session: Session
) -> None:
    from tests.db.auth_helpers import build_env

    env = build_env(db_session, google_oauth_provider="disabled")
    try:
        response = env.client().post(START, {"purpose": "login"})
        assert (
            response.status_code == 503
            and response.json()["error"]["code"] == "service_unavailable"
        )
        api = env.client()
        assert api.get(CALLBACK, params={"code": "x", "state": "y"}, origin=None).headers[
            "location"
        ] == (error_url("oauth_failed"))
    finally:
        env.close()


@pytest.mark.parametrize(
    ("given", "stored"),
    [
        ("/saved", "/saved"),
        ("/professional/listings", "/professional/listings"),
        ("/", "/"),
        (None, "/"),  # absent
        ("", "/"),  # blank
        ("   ", "/"),
    ],
)
def test_an_absent_or_blank_return_to_is_the_root_and_a_safe_one_is_kept(
    auth_env: AuthEnv, given: str | None, stored: str
) -> None:
    started_ok(auth_env.client(), return_to=given)

    (flow,) = auth_env.session.scalars(select(OAuthFlow)).all()

    assert flow.return_to == stored


def test_an_explicit_null_return_to_is_the_root(auth_env: AuthEnv) -> None:
    response = auth_env.client().post(START, {"purpose": "login", "returnTo": None})

    assert response.status_code == 200
    (flow,) = auth_env.session.scalars(select(OAuthFlow)).all()
    assert flow.return_to == "/"


MALICIOUS_RETURN_TO = [
    "https://evil.example",  # absolute external URL
    "http://evil.example/path",
    "//evil.example",  # scheme-relative
    "///evil.example",
    "/\\evil.example",  # backslash / host confusion
    "\\evil.example",
    "/%2F%2Fevil.example",  # encoded external-host tricks
    "/%2f/evil.example",
    "/%5Cevil.example",
    "/%255Cevil.example",
    "/%2e%2e/secret",
    "/a/../b",
    "javascript:alert(1)",
    "data:text/html,x",
    "/ok\nSet-Cookie: x=1",  # control characters
    "/ok\r\nX: y",
    "/ok\x00",
    "/ok\tx",
    "/api",  # disallowed destinations
    "/api/v1/auth/me",
    "/API/v1",
    "/admin/login",
    "/admin/login/",
    "/ADMIN/LOGIN",
    "/path?next=https://evil.example",
    "/path#frag",
    "saved",  # not rooted
    " /saved",  # padding is not cleaned up either
    "/" + "a" * 200,  # over the length limit
]


@pytest.mark.parametrize("malicious", MALICIOUS_RETURN_TO)
def test_an_explicitly_malicious_return_to_is_rejected_and_never_starts_a_flow(
    auth_env: AuthEnv, malicious: str
) -> None:
    api = auth_env.client()

    response = start(api, return_to=malicious).response

    body = response.json()
    assert response.status_code == 422 and body["error"]["code"] == "validation_error"
    assert [d["field"] for d in body["error"]["details"]] == ["returnTo"]
    assert "authorizationUrl" not in response.text and "data" not in body
    assert malicious.strip() == "" or malicious not in response.text  # the value is never echoed
    assert api.http.cookies.get(auth_env.settings.oauth_cookie_name) is None  # no flow cookie
    assert "set-cookie" not in response.headers
    assert auth_env.session.scalars(select(OAuthFlow)).all() == []  # no oauth_flows row at all


def test_a_malicious_return_to_is_rejected_for_connect_google_too(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    make_account(auth_env.session)
    api.login()

    response = start(api, purpose="link", return_to="https://evil.example").response

    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    assert "authorizationUrl" not in response.text
    assert auth_env.session.scalars(select(OAuthFlow)).all() == []


def test_a_rejected_start_leaves_the_provider_untouched(auth_env: AuthEnv) -> None:
    api = auth_env.client()

    start(api, return_to="//evil.example")

    assert fake_provider(auth_env)._challenges == {}


def test_the_service_refuses_a_malicious_return_to_even_without_the_schema(
    auth_env: AuthEnv,
) -> None:
    """Defence in depth: a caller that skips request validation still creates nothing."""
    provider = fake_provider(auth_env)
    service = OAuthService(
        auth_env.session, auth_env.settings, auth_env.clock, {AuthProvider.GOOGLE: provider}
    )

    with pytest.raises(AppError) as error:
        service.start(AuthProvider.GOOGLE, OAuthPurpose.LOGIN, "//evil.example", None)

    assert error.value.status_code == 422 and error.value.code.value == "validation_error"
    assert auth_env.session.scalars(select(OAuthFlow)).all() == []
    assert provider._challenges == {}


def test_connect_start_needs_a_session_origin_and_the_csrf_token(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    anonymous = start(auth_env.client(), purpose="link").response
    api = auth_env.client()
    api.login()

    assert anonymous.status_code == 401 and anonymous.json()["error"]["code"] == "unauthenticated"
    assert start(api, purpose="link", csrf=None).response.status_code == 403
    assert start(api, purpose="link", csrf="wrong").response.status_code == 403
    assert start(api, purpose="link", origin=None).response.status_code == 403
    ok = start(api, purpose="link")
    assert ok.response.status_code == 200
    (flow,) = auth_env.session.scalars(select(OAuthFlow)).all()
    assert (
        flow.purpose is OAuthPurpose.LINK
        and flow.user_id == user_with_email(auth_env.session, "ayesha@example.org").id
    )


# -- callback: Case A (a brand-new Google user) -----------------------------------------------------------------


def test_a_new_verified_google_user_becomes_a_normal_resident_with_a_b17_session(
    auth_env: AuthEnv,
) -> None:
    api, response, started = sign_in(auth_env, google_code(name="Gina Khan"), return_to="/saved")

    assert location(response) == f"{ORIGIN}/saved"  # the stored, validated returnTo on the frontend
    headers = response.headers.get_list("set-cookie")
    session_cookie = next(h for h in headers if h.startswith("b17_session="))
    flow_cookie = next(h for h in headers if h.startswith("b17_oauth="))
    assert "httponly" in session_cookie.lower() and "samesite=lax" in session_cookie.lower()
    assert "max-age=0" in flow_cookie.lower()  # the single-use flow cookie is spent
    assert response.headers["cache-control"] == "no-store"
    user = user_with_email(auth_env.session, GMAIL)
    assert user.display_name == "Gina Khan" and user.password_hash is None
    assert user.email_verified_at is not None and user.status == "active"
    (identity,) = identities(auth_env.session)
    assert (identity.user_id, identity.provider, identity.provider_subject) == (
        user.id,
        AuthProvider.GOOGLE,
        SUB,
    )
    # an ordinary B-17 session from the existing SessionService
    (row,) = sessions_of(auth_env.session, user.id)
    assert bytes(row.token_hash) == hash_token(api.session_cookie or "")
    me = api.me().json()["data"]
    assert me["email"] == GMAIL and me["emailVerified"] is True
    assert me["roles"] == [] and "professional" not in me  # Resident only
    assert me["authMethods"] == {"password": False, "providers": ["google"]}
    kinds = [e.event_type for e in events_of(auth_env.session, user.id)]
    assert kinds == [AuthEventType.REGISTER, AuthEventType.IDENTITY_LINKED]
    assert auth_env.outbox.outbox == []  # a verified Google email needs no verification mail
    # the flow is used up, and Google's tokens/code are nowhere
    (flow,) = auth_env.session.scalars(select(OAuthFlow)).all()
    assert flow.consumed_at is not None
    for table in ("users", "auth_identities", "auth_sessions", "auth_events", "oauth_flows"):
        dump = (
            auth_env.session.scalar(text(f"SELECT string_agg(t::text, ' ') FROM {table} t")) or ""
        )
        assert google_code() not in dump and started.state not in dump


def test_a_google_email_that_is_not_verified_creates_an_unverified_account_and_a_mail(
    auth_env: AuthEnv,
) -> None:
    api, response, _ = sign_in(auth_env, google_code(verified=False))

    assert location(response) == f"{ORIGIN}/"
    user = user_with_email(auth_env.session, GMAIL)
    assert user.email_verified_at is None  # never inferred from the mere presence of an email
    message = auth_env.outbox.last("email_verification")
    assert message is not None and message.to == GMAIL and "#token=" in (message.link or "")
    assert api.me().json()["data"]["emailVerified"] is False


def test_a_new_google_user_with_a_bare_name_gets_a_safe_display_name(auth_env: AuthEnv) -> None:
    sign_in(auth_env, google_code(name="x"))

    assert user_with_email(auth_env.session, GMAIL).display_name == "gina"  # the email's local part


# -- callback: Case B (an existing linked identity) ----------------------------------------------------------


def linked_user(env: AuthEnv, **account: object) -> User:
    user = make_account(env.session, GMAIL, password=None, **account)  # type: ignore[arg-type]
    env.session.add(
        AuthIdentity(
            user_id=user.id,
            provider=AuthProvider.GOOGLE,
            provider_subject=SUB,
            provider_email=GMAIL,
        )
    )
    env.session.commit()
    return user


def test_a_linked_identity_signs_into_its_exact_user_with_its_existing_capabilities(
    auth_env: AuthEnv,
) -> None:
    user = linked_user(auth_env, admin=True, professional=PlanCode.PREMIUM)

    api, response, _ = sign_in(auth_env)

    assert location(response) == f"{ORIGIN}/"
    me = api.me().json()["data"]
    assert me["id"] == str(user.id) and me["roles"] == ["admin"]
    assert me["professional"] == {"planCode": "premium"}
    assert count(auth_env.session, "users") == 1 and len(identities(auth_env.session)) == 1
    auth_env.session.refresh(user)
    assert user.last_login_at is not None
    assert [e.event_type for e in events_of(auth_env.session, user.id)] == [
        AuthEventType.LOGIN_SUCCESS
    ]


def test_the_provider_subject_not_the_email_is_the_identity(auth_env: AuthEnv) -> None:
    """Same `sub`, different email: still the same user. A different `sub` with the old email: not."""
    user = linked_user(auth_env)
    other = make_account(auth_env.session, "someone-else@example.org", password=PASSWORD)

    api, response, _ = sign_in(auth_env, google_code(SUB, "someone-else@example.org"))

    assert location(response) == f"{ORIGIN}/"
    assert api.me().json()["data"]["id"] == str(
        user.id
    )  # not `other`, whose address Google now reports
    (identity,) = identities(auth_env.session)
    assert identity.user_id == user.id and identity.provider_email == "someone-else@example.org"
    auth_env.session.refresh(other)
    assert other.password_hash is not None  # the other account is untouched
    # and a *different* sub reporting the first user's old email is a collision, not a login
    _, again, _ = sign_in(auth_env, google_code("another-sub", GMAIL))
    assert location(again) in {error_url("identity_conflict"), error_url("email_not_verified")}


def test_a_suspended_linked_user_cannot_sign_in_through_google(auth_env: AuthEnv) -> None:
    linked_user(auth_env, status="suspended")

    api, response, _ = sign_in(auth_env)

    assert location(response) == error_url("account_disabled")
    assert "b17_session=" not in " ".join(response.headers.get_list("set-cookie"))
    assert count(auth_env.session, "auth_sessions") == 0 and api.me().status_code == 401


def test_google_login_obeys_the_ten_session_cap(auth_env: AuthEnv) -> None:
    user = linked_user(auth_env)
    for _ in range(11):  # the eleventh sign-in must still succeed
        sign_in(auth_env)
        auth_env.clock.advance(seconds=1)

    assert len(active_sessions_of(auth_env.session, user.id)) == 10
    revoked = [s for s in sessions_of(auth_env.session, user.id) if s.revoked_at is not None]
    assert len(revoked) == 1 and revoked[0].revoke_reason == SessionRevokeReason.SESSION_CAP.value


def test_google_login_never_reuses_a_preexisting_session_cookie(auth_env: AuthEnv) -> None:
    linked_user(auth_env)
    api = auth_env.client()
    planted = "A" * 43
    started = started_ok(api)

    response = callback(
        api,
        google_code(),
        state=started.state,
        headers={
            "Cookie": f"{api.cookie_name}={planted}; {auth_env.settings.oauth_cookie_name}={started.flow_cookie}"
        },
    )

    new_cookie = next(
        h for h in response.headers.get_list("set-cookie") if h.startswith("b17_session=")
    )
    assert planted not in new_cookie


# -- callback: collisions (C1, C3, C4) -----------------------------------------------------------------------------


def untouched(env: AuthEnv, user: User, password_hash: str | None) -> None:
    env.session.refresh(user)
    assert user.password_hash == password_hash and identities(env.session) == []
    assert count(env.session, "auth_sessions") == 0 or all(
        s.revoked_at is None for s in sessions_of(env.session, user.id)
    )


def test_a_verified_account_is_never_linked_or_logged_into_by_email(auth_env: AuthEnv) -> None:
    """C1 — the critical rule: no email-only shortcut into a verified account."""
    user = make_account(auth_env.session, GMAIL, password=PASSWORD, verified=True)
    before = user.password_hash

    api, response, _ = sign_in(auth_env)  # Google verifies the very same mailbox

    assert location(response) == error_url("identity_conflict")
    assert "b17_session=" not in " ".join(response.headers.get_list("set-cookie"))
    assert api.me().status_code == 401
    untouched(auth_env, user, before)
    assert count(auth_env.session, "users") == 1 and count(auth_env.session, "auth_sessions") == 0
    assert auth_env.client().login(email=GMAIL).status_code == 200  # the password still works


@pytest.mark.parametrize("verified_account", [True, False])
def test_an_unverified_google_email_never_links_claims_or_logs_in(
    auth_env: AuthEnv, verified_account: bool
) -> None:
    """C3 — Google did not assert the email, so nothing may act on it."""
    user = make_account(auth_env.session, GMAIL, password=PASSWORD, verified=verified_account)
    before = user.password_hash

    _, response, _ = sign_in(auth_env, google_code(verified=False))

    assert location(response) == error_url("email_not_verified")
    untouched(auth_env, user, before)
    assert auth_env.session.get(User, user.id).email_verified_at == user.email_verified_at  # type: ignore[union-attr]


def test_a_suspended_same_email_account_is_never_claimed(auth_env: AuthEnv) -> None:
    user = make_account(
        auth_env.session, GMAIL, password=PASSWORD, verified=False, status="suspended"
    )
    before = user.password_hash

    _, response, _ = sign_in(auth_env)

    assert location(response) == error_url("account_disabled")
    untouched(auth_env, user, before)


def test_a_deleted_account_is_never_claimed(auth_env: AuthEnv) -> None:
    user = make_account(
        auth_env.session, GMAIL, password=PASSWORD, verified=False, status="deleted"
    )
    before = user.password_hash

    _, response, _ = sign_in(auth_env)

    assert location(response) == error_url("account_disabled")
    untouched(auth_env, user, before)
    assert auth_env.session.get(User, user.id).email_verified_at is None  # type: ignore[union-attr]


def test_an_account_with_a_different_google_identity_is_a_conflict_not_a_claim(
    auth_env: AuthEnv,
) -> None:
    user = make_account(auth_env.session, GMAIL, password=PASSWORD, verified=False)
    auth_env.session.add(
        AuthIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_subject="old-sub")
    )
    auth_env.session.commit()

    _, response, _ = sign_in(auth_env, google_code("new-sub"))

    assert location(response) == error_url("identity_conflict")
    (identity,) = identities(auth_env.session)
    assert identity.provider_subject == "old-sub"
    assert auth_env.session.get(User, user.id).password_hash is not None  # type: ignore[union-attr]


# -- callback: C2, the approved unverified-account claim ------------------------------------------------------------


def squatted_account(env: AuthEnv) -> tuple[User, AuthApi, AuthApi]:
    """An attacker registered the victim's address and set a password; two devices are signed in."""
    squatter, second = env.client(), env.client()
    assert squatter.register(email=GMAIL, password=PASSWORD).status_code == 201
    assert second.login(email=GMAIL, password=PASSWORD).status_code == 200
    squatter.post("/auth/forgot-password", {"email": GMAIL})
    return user_with_email(env.session, GMAIL), squatter, second


def test_the_unverified_account_claim_recovers_the_mailbox_for_its_real_owner(
    auth_env: AuthEnv,
) -> None:
    user, squatter, second = squatted_account(auth_env)
    verification, reset = (
        last_token(auth_env, "email_verification"),
        last_token(auth_env, "password_reset"),
    )
    old_sessions = {s.id for s in active_sessions_of(auth_env.session, user.id)}
    assert len(old_sessions) == 2

    owner, response, _ = sign_in(auth_env, google_code(name="Gina Khan"))

    assert location(response) == f"{ORIGIN}/"
    auth_env.session.refresh(user)
    assert user.email_verified_at is not None  # Google proved the mailbox
    assert user.password_hash is None  # the squatter's password is gone
    (identity,) = identities(auth_env.session)
    assert identity.user_id == user.id and identity.provider_subject == SUB
    # every old session is dead, exactly one fresh Google session exists
    assert squatter.me().json()["error"]["code"] == "session_expired"
    assert second.me().json()["error"]["code"] == "session_expired"
    now_active = active_sessions_of(auth_env.session, user.id)
    assert len(now_active) == 1 and now_active[0].id not in old_sessions
    assert {
        s.revoke_reason for s in sessions_of(auth_env.session, user.id) if s.id in old_sessions
    } == {SessionRevokeReason.ACCOUNT_CLAIMED.value}
    assert owner.me().json()["data"]["authMethods"] == {"password": False, "providers": ["google"]}
    # the squatter's outstanding verification and reset tokens are dead, and the password does not work
    for raw in (verification, reset):
        row = auth_env.session.scalars(
            select(AuthToken).where(AuthToken.token_hash == hash_token(raw))
        ).one()
        assert row.consumed_at is not None
    assert (
        squatter.post(
            "/auth/reset-password", {"token": reset, "newPassword": OTHER_PASSWORD}
        ).status_code
        == 400
    )
    assert auth_env.client().login(email=GMAIL, password=PASSWORD).status_code == 401
    # audited
    kinds = [e.event_type for e in events_of(auth_env.session, user.id)]
    assert AuthEventType.ACCOUNT_CLAIMED in kinds and AuthEventType.IDENTITY_LINKED in kinds
    revoked_events = [
        e
        for e in events_of(auth_env.session, user.id)
        if e.event_type is AuthEventType.SESSION_REVOKED
    ]
    assert len(revoked_events) == 2
    assert all(e.details and e.details["reason"] == "account_claimed" for e in revoked_events)


def test_a_claim_creates_no_roles_or_professional_profile(auth_env: AuthEnv) -> None:
    user, _, _ = squatted_account(auth_env)

    owner, _, _ = sign_in(auth_env)

    me = owner.me().json()["data"]
    assert me["id"] == str(user.id) and me["roles"] == [] and "professional" not in me


def test_a_verification_that_wins_the_race_turns_the_claim_into_a_conflict(
    auth_env: AuthEnv,
) -> None:
    """The row is re-checked under its lock: an account verified in the meantime is not claimable."""
    user, squatter, _ = squatted_account(auth_env)
    token = last_token(auth_env, "email_verification")
    assert (
        squatter.post("/auth/verify-email", {"token": token}).status_code == 204
    )  # real owner verified

    _, response, _ = sign_in(auth_env)

    assert location(response) == error_url("identity_conflict")
    auth_env.session.refresh(user)
    assert user.password_hash is not None and identities(auth_env.session) == []
    assert auth_env.client().login(email=GMAIL, password=PASSWORD).status_code == 200


# -- callback: state, browser binding, PKCE, nonce, expiry, replay ---------------------------------------------------


def no_account_or_session_created(env: AuthEnv) -> None:
    assert count(env.session, "users") == 0 and count(env.session, "auth_sessions") == 0
    assert identities(env.session) == []


def test_a_replayed_callback_fails_and_creates_nothing_more(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    started = started_ok(api)
    first = callback(api, google_code(), state=started.state)
    assert location(first) == f"{ORIGIN}/"
    sessions_after_first = count(auth_env.session, "auth_sessions")

    replay = callback(api, google_code(), state=started.state)

    assert location(replay) == error_url("oauth_failed")
    assert count(auth_env.session, "auth_sessions") == sessions_after_first
    assert len(fake_provider(auth_env).exchanges) == 1  # the provider was not even asked again


@pytest.mark.parametrize("mutate", ["wrong", "missing", "other-flow", "empty", "junk"])
def test_a_wrong_missing_or_foreign_state_fails_before_any_account_exists(
    auth_env: AuthEnv, mutate: str
) -> None:
    api = auth_env.client()
    started = started_ok(api)
    other = started_ok(auth_env.client())  # a second, valid flow of another browser
    state = {
        "wrong": "B" * 43,
        "missing": None,
        "other-flow": other.state,
        "empty": "",
        "junk": "not a state!",
    }[mutate]

    response = callback(api, google_code(), state=state)

    assert location(response) == error_url("oauth_failed")
    no_account_or_session_created(auth_env)
    assert fake_provider(auth_env).exchanges == []
    # the genuine flow was not burnt by the bad attempt, and still completes
    assert location(callback(api, google_code(), state=started.state)) == f"{ORIGIN}/"


def test_the_flow_is_bound_to_the_browser_that_started_it(auth_env: AuthEnv) -> None:
    """Login CSRF: an attacker's callback fed to a victim's browser (no/other flow cookie) fails."""
    victim_without_cookie = auth_env.client()
    attacker_flow = started_ok(auth_env.client())
    victim_with_other_cookie = auth_env.client()
    started_ok(victim_with_other_cookie)  # the victim has *a* flow cookie, but not the attacker's

    for browser in (victim_without_cookie, victim_with_other_cookie):
        response = callback(browser, google_code(), state=attacker_flow.state)
        assert location(response) == error_url("oauth_failed")

    no_account_or_session_created(auth_env)
    assert fake_provider(auth_env).exchanges == []


def test_an_expired_flow_cannot_complete(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    started = started_ok(api)
    auth_env.clock.advance(minutes=10, seconds=1)

    response = callback(api, google_code(), state=started.state)

    assert location(response) == error_url("oauth_failed")
    no_account_or_session_created(auth_env)


def test_the_flow_is_still_valid_just_before_it_expires(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    started = started_ok(api)
    auth_env.clock.advance(minutes=9, seconds=59)

    assert location(callback(api, google_code(), state=started.state)) == f"{ORIGIN}/"


def test_the_pkce_verifier_sent_to_the_provider_matches_the_challenge_in_the_url(
    auth_env: AuthEnv,
) -> None:
    api = auth_env.client()
    started = started_ok(api)

    callback(api, google_code(), state=started.state)

    (code, verifier, redirect_uri, nonce) = fake_provider(auth_env).exchanges[0]
    assert code_challenge_s256(verifier) == started.challenge
    assert nonce == started.nonce
    assert redirect_uri == "http://127.0.0.1:8000/api/v1/auth/oauth/google/callback"


def test_a_pkce_mismatch_at_the_provider_fails_the_login(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    started = started_ok(api)
    auth_env.session.execute(update(OAuthFlow).values(code_verifier="x" * 64))  # not the real one
    auth_env.session.commit()

    response = callback(api, google_code(), state=started.state)

    assert location(response) == error_url("oauth_failed")
    no_account_or_session_created(auth_env)


def test_a_wrong_nonce_in_the_id_token_fails_the_login(auth_env: AuthEnv) -> None:
    _, response, _ = sign_in(auth_env, google_code(scenario="wrongnonce"))

    assert location(response) == error_url("oauth_failed")
    no_account_or_session_created(auth_env)


@pytest.mark.parametrize(
    ("code", "error"),
    [
        (google_code(scenario="invalid"), "oauth_failed"),
        (google_code(scenario="timeout"), "oauth_failed"),
        (google_code(scenario="denied"), "oauth_denied"),
        ("not-a-fake-code", "oauth_failed"),
        ("", "oauth_failed"),
        ("c" * 3000, "oauth_failed"),
    ],
)
def test_provider_failures_become_fixed_safe_codes(
    auth_env: AuthEnv, code: str, error: str
) -> None:
    api = auth_env.client()
    started = started_ok(api)
    response = callback(api, code, state=started.state)

    assert location(response) == error_url(error)
    no_account_or_session_created(auth_env)
    assert response.text == ""  # nothing from the provider is relayed in the body either


def test_the_user_declining_consent_is_reported_without_provider_text(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    started = started_ok(api)

    response = callback(
        api,
        None,
        state=started.state,
        extra={"error": "access_denied", "error_description": "<script>alert(1)</script>"},
    )

    assert location(response) == error_url("oauth_denied")
    assert "script" not in response.headers["location"]
    # the flow was consumed by the refusal
    assert location(callback(api, google_code(), state=started.state)) == error_url("oauth_failed")


def test_a_provider_error_param_other_than_denial_is_a_plain_failure(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    started = started_ok(api)

    response = callback(api, None, state=started.state, extra={"error": "server_error"})

    assert location(response) == error_url("oauth_failed")


def test_the_callback_ignores_any_destination_the_request_tries_to_supply(
    auth_env: AuthEnv,
) -> None:
    api = auth_env.client()
    started = started_ok(api, return_to="/saved")

    response = callback(
        api,
        google_code(),
        state=started.state,
        extra={
            "returnTo": "https://evil.example",
            "redirect_uri": "https://evil.example",
            "next": "//evil",
        },
    )

    assert location(response) == f"{ORIGIN}/saved"


def test_the_callback_needs_neither_an_origin_nor_the_csrf_token(auth_env: AuthEnv) -> None:
    """Google's redirect is a cross-site top-level GET: the B-17 CSRF layers must not block it."""
    api = auth_env.client()
    started = started_ok(api)

    response = api.get(
        CALLBACK,
        params={"code": google_code(), "state": started.state},
        origin=None,
        csrf=None,
        headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"},
    )

    assert location(response) == f"{ORIGIN}/"


def test_every_failure_redirect_is_exactly_the_fixed_error_destination(auth_env: AuthEnv) -> None:
    allowed = {
        error_url(c)
        for c in (
            "oauth_denied",
            "oauth_failed",
            "identity_conflict",
            "email_not_verified",
            "account_disabled",
        )
    }
    make_account(auth_env.session, GMAIL, password=PASSWORD)
    seen = set()
    for code in (
        google_code(scenario="invalid"),
        google_code(scenario="denied"),
        google_code(),  # C1
        google_code(verified=False),  # C3
        "nonsense",
    ):
        _, response, _ = sign_in(auth_env, code)
        seen.add(location(response))

    assert seen <= allowed and len(seen) >= 4
    assert all(url.startswith(f"{ORIGIN}/login?error=") and "&" not in url for url in seen)


# -- callback: the log never sees secrets ---------------------------------------------------------------------------


def test_nothing_secret_is_logged_by_the_oauth_flow(
    auth_env: AuthEnv, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    api = auth_env.client()
    started = started_ok(api)
    flow_cookie = started.flow_cookie or ""
    callback(api, google_code(scenario="invalid"), state=started.state)
    api2, response, started2 = sign_in(auth_env)
    verifier = fake_provider(auth_env).exchanges[-1][1]
    session_token = api2.session_cookie or ""

    # the test client's own httpx logger records the URLs *it* requests; the server never sees that
    everything = " ".join(
        f"{r.getMessage()} {r.__dict__}" for r in caplog.records if r.name != "httpx"
    )

    for secret in (
        started.state,
        started2.state,
        started.nonce,
        started2.nonce,
        flow_cookie,
        verifier,
        session_token,
        google_code(),
        started.challenge,
    ):
        assert secret and secret not in everything, secret


# -- Connect Google --------------------------------------------------------------------------------------------------


def connect(env: AuthEnv, api: AuthApi, code: str | None = None, **kw: object) -> "object":
    started = started_ok(api, purpose="link", **kw)
    return callback(api, code or google_code(), state=started.state)


def signed_in(
    env: AuthEnv, email: str = "ayesha@example.org", **account: object
) -> tuple[User, AuthApi]:
    user = make_account(env.session, email, **account)  # type: ignore[arg-type]
    api = env.client()
    assert api.login(email=email).status_code == 200
    return user, api


def test_connect_links_google_to_the_initiating_account_and_keeps_its_session_and_password(
    auth_env: AuthEnv,
) -> None:
    user, api = signed_in(auth_env)
    cookie_before = api.session_cookie
    before_hash = user.password_hash

    response = connect(auth_env, api, return_to="/professional")

    assert location(response) == f"{ORIGIN}/professional"  # type: ignore[arg-type]
    cookies = response.headers.get_list("set-cookie")  # type: ignore[attr-defined]
    assert not any(c.startswith("b17_session=") for c in cookies)  # no new session on connect
    assert api.session_cookie == cookie_before and api.me().status_code == 200
    (identity,) = identities(auth_env.session)
    assert identity.user_id == user.id and identity.provider_subject == SUB
    auth_env.session.refresh(user)
    assert user.password_hash == before_hash and user.email == "ayesha@example.org"
    assert api.me().json()["data"]["authMethods"] == {"password": True, "providers": ["google"]}
    assert AuthEventType.IDENTITY_LINKED in [
        e.event_type for e in events_of(auth_env.session, user.id)
    ]
    assert len(active_sessions_of(auth_env.session, user.id)) == 1


def test_connect_works_for_an_unverified_account_and_a_different_google_email(
    auth_env: AuthEnv,
) -> None:
    user, api = signed_in(auth_env, verified=False)

    response = connect(auth_env, api, google_code(email="work-address@example.org"))

    assert location(response) == f"{ORIGIN}/"  # type: ignore[arg-type]
    (identity,) = identities(auth_env.session)
    assert identity.provider_email == "work-address@example.org"
    auth_env.session.refresh(user)
    assert user.email == "ayesha@example.org" and user.email_verified_at is None  # untouched


def test_connect_never_takes_a_google_identity_from_another_user(auth_env: AuthEnv) -> None:
    owner = linked_user(auth_env)
    user, api = signed_in(auth_env, "bob@example.org", display_name="Bob Khan")

    response = connect(auth_env, api)

    assert location(response) == error_url("identity_conflict")  # type: ignore[arg-type]
    (identity,) = identities(auth_env.session)
    assert identity.user_id == owner.id  # still theirs
    assert api.me().json()["data"]["authMethods"]["providers"] == []
    assert user.id != owner.id


def test_connect_allows_one_google_identity_per_user(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    connect(auth_env, api)

    again_other_sub = connect(auth_env, api, google_code("second-sub"))

    assert location(again_other_sub) == error_url("identity_conflict")  # type: ignore[arg-type]
    assert [i.provider_subject for i in identities(auth_env.session)] == [SUB]
    idempotent = connect(auth_env, api)  # the same identity again is a no-op success
    assert location(idempotent) == f"{ORIGIN}/"  # type: ignore[arg-type]
    assert len(identities(auth_env.session)) == 1
    assert [e.event_type for e in events_of(auth_env.session, user.id)].count(
        AuthEventType.IDENTITY_LINKED
    ) == 1


def test_a_connect_flow_cannot_be_completed_by_a_different_signed_in_user(
    auth_env: AuthEnv,
) -> None:
    _, alice_api = signed_in(auth_env)
    started = started_ok(alice_api, purpose="link")
    _, bob_api = signed_in(auth_env, "bob@example.org", display_name="Bob Khan")
    # Bob's browser somehow presents Alice's flow cookie and state (e.g. a leaked link)
    cookies = (
        f"{bob_api.cookie_name}={bob_api.session_cookie}; "
        f"{auth_env.settings.oauth_cookie_name}={started.flow_cookie}"
    )

    stolen = callback(bob_api, google_code(), state=started.state, headers={"Cookie": cookies})

    assert location(stolen) == error_url("oauth_failed")
    assert identities(auth_env.session) == []  # nothing was linked to Bob (or to Alice)


def test_a_connect_flow_needs_the_initiators_session_at_the_callback(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)
    started = started_ok(api, purpose="link")
    api.logout()  # the session ends between start and callback

    response = callback(api, google_code(), state=started.state)

    assert location(response) == error_url("oauth_failed")
    assert identities(auth_env.session) == []


def test_a_suspended_user_cannot_complete_a_connect(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    started = started_ok(api, purpose="link")
    auth_env.session.execute(update(User).where(User.id == user.id).values(status="suspended"))
    auth_env.session.commit()

    response = callback(api, google_code(), state=started.state)

    assert location(response) == error_url("oauth_failed")
    assert identities(auth_env.session) == []


# -- Disconnect Google ------------------------------------------------------------------------------------------------


def test_disconnect_needs_a_session_and_the_csrf_token(auth_env: AuthEnv) -> None:
    anonymous = auth_env.client().request("DELETE", DISCONNECT)
    _, api = signed_in(auth_env)

    assert anonymous.status_code == 401
    assert api.request("DELETE", DISCONNECT, csrf=None).status_code == 403
    assert api.request("DELETE", DISCONNECT, csrf="wrong").status_code == 403
    assert api.request("DELETE", DISCONNECT, origin=None).status_code == 403


def test_disconnect_removes_only_the_callers_identity_when_another_method_remains(
    auth_env: AuthEnv,
) -> None:
    user, api = signed_in(auth_env)  # has a password
    connect(auth_env, api)
    other = linked_user_for(auth_env, "carol@example.org", "carol-sub")
    assert len(identities(auth_env.session)) == 2

    response = api.request("DELETE", DISCONNECT)

    assert response.status_code == 204 and response.headers["cache-control"] == "no-store"
    assert [i.user_id for i in identities(auth_env.session)] == [other.id]  # carol's is untouched
    assert api.me().json()["data"]["authMethods"] == {"password": True, "providers": []}
    assert api.me().status_code == 200  # the session is not affected
    assert AuthEventType.IDENTITY_UNLINKED in [
        e.event_type for e in events_of(auth_env.session, user.id)
    ]


def linked_user_for(env: AuthEnv, email: str, sub: str) -> User:
    user = make_account(env.session, email, password=PASSWORD, display_name="Carol Khan")
    env.session.add(
        AuthIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_subject=sub)
    )
    env.session.commit()
    return user


def test_disconnect_refuses_to_remove_the_last_way_to_sign_in(auth_env: AuthEnv) -> None:
    api, response, _ = sign_in(auth_env)  # a Google-only account: no password
    assert location(response) == f"{ORIGIN}/"
    api.me()  # the SPA reads its CSRF token from /auth/me after the redirect

    refused = api.request("DELETE", DISCONNECT)

    assert refused.status_code == 409 and refused.json()["error"]["code"] == "conflict"
    assert len(identities(auth_env.session)) == 1
    assert api.me().json()["data"]["authMethods"]["providers"] == ["google"]
    assert AuthEventType.IDENTITY_UNLINKED not in [
        e.event_type for e in events_of(auth_env.session)
    ]


def test_after_adding_a_password_a_google_only_user_can_disconnect(auth_env: AuthEnv) -> None:
    api, _, _ = sign_in(auth_env)
    api.post("/auth/forgot-password", {"email": GMAIL})  # proof of mailbox control sets a password
    token = last_token(auth_env, "password_reset")
    assert (
        auth_env.client()
        .post("/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD})
        .status_code
        == 204
    )
    api = auth_env.client()
    assert api.login(email=GMAIL, password=OTHER_PASSWORD).status_code == 200

    assert api.request("DELETE", DISCONNECT).status_code == 204
    assert api.me().json()["data"]["authMethods"] == {"password": True, "providers": []}


def test_disconnect_with_nothing_connected_is_not_found(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)

    response = api.request("DELETE", DISCONNECT)

    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_disconnect_takes_no_client_supplied_identifiers(auth_env: AuthEnv) -> None:
    other = linked_user_for(auth_env, "carol@example.org", "carol-sub")
    _, api = signed_in(auth_env)

    for query in ({"sub": "carol-sub"}, {"userId": str(other.id)}, {"id": str(other.id)}):
        assert api.request("DELETE", DISCONNECT, params=query).status_code == 404
    assert len(identities(auth_env.session)) == 1


# -- me / RBAC / regressions -----------------------------------------------------------------------------------------


def test_google_users_have_no_capability_beyond_resident(auth_env: AuthEnv) -> None:
    api, _, _ = sign_in(auth_env)

    me = api.me().json()["data"]

    assert me["roles"] == [] and "professional" not in me
    assert api.post("/auth/resend-verification").status_code == 204  # verified: a silent no-op
    assert not any(role in str(me) for role in ("admin", "professional"))


def test_email_password_auth_still_works_for_a_google_user_after_a_reset(auth_env: AuthEnv) -> None:
    sign_in(auth_env)
    anon = auth_env.client()
    anon.post("/auth/forgot-password", {"email": GMAIL})
    token = last_token(auth_env, "password_reset")

    assert (
        anon.post(
            "/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD}
        ).status_code
        == 204
    )

    assert auth_env.client().login(email=GMAIL, password=OTHER_PASSWORD).status_code == 200


def test_oauth_responses_are_never_cacheable_but_public_reads_are_untouched(
    auth_env: AuthEnv,
) -> None:
    api = auth_env.client()
    started = started_ok(api)

    redirect = callback(api, google_code(), state=started.state)

    assert started.response.headers["cache-control"] == "no-store"
    assert redirect.headers["cache-control"] == "no-store"
    assert "no-store" not in api.get("/health").headers.get("cache-control", "")
