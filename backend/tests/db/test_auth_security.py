"""Cookie attributes, CSRF/Origin, CORS credentials, cache headers and redaction.

Phase 11A security matrix S1-S4, S10 and S13 (the rows that belong to 11B).
"""

import logging

import pytest

from app.core.security.tokens import csrf_token_for
from tests.db.auth_helpers import (
    ORIGIN,
    OTHER_PASSWORD,
    PASSWORD,
    AuthEnv,
    build_env,
    last_token,
    make_account,
)

HOSTED_ORIGIN = "https://app.example.org"
HOSTED = {
    "environment": "production",
    "frontend_origins": [HOSTED_ORIGIN],
    "frontend_base_url": HOSTED_ORIGIN,
    "password_hash_time_cost": 2,
    "password_hash_memory_cost_kib": 19456,
    "password_hash_parallelism": 1,
}


def signed_in(env: AuthEnv, **account: object):  # type: ignore[no-untyped-def]
    make_account(env.session, **account)  # type: ignore[arg-type]
    api = env.client()
    assert api.login().status_code == 200
    return api


# -- cookie attributes (S1) -----------------------------------------------------------------------------


def test_development_cookie_attributes(auth_env: AuthEnv) -> None:
    response = auth_env.client().register()

    cookie = response.headers["set-cookie"]
    assert cookie.startswith("b17_session=")
    attributes = {part.strip().lower() for part in cookie.split(";")[1:]}
    assert {"httponly", "samesite=lax", "path=/"} <= attributes
    assert not any(a.startswith(("domain", "secure")) for a in attributes)
    assert any(a.startswith("max-age=") for a in attributes)


def test_production_cookie_attributes(db_session) -> None:  # type: ignore[no-untyped-def]
    env = build_env(db_session, **HOSTED)
    try:
        response = env.client().register(origin=HOSTED_ORIGIN)

        assert response.status_code == 201
        cookie = response.headers["set-cookie"]
        assert cookie.startswith("__Host-b17_session=")
        attributes = {part.strip().lower() for part in cookie.split(";")[1:]}
        assert {"httponly", "secure", "samesite=lax", "path=/"} <= attributes
        assert not any(a.startswith("domain") for a in attributes)  # host-only: required by __Host-
        assert "max-age=" in cookie.lower()
    finally:
        env.close()


def test_the_cleared_cookie_keeps_the_same_flags(db_session) -> None:  # type: ignore[no-untyped-def]
    env = build_env(db_session, **HOSTED)
    try:
        api = env.client(base_url="https://testserver")
        api.register(origin=HOSTED_ORIGIN)

        response = api.logout(origin=HOSTED_ORIGIN)

        cleared = response.headers["set-cookie"].lower()
        assert cleared.startswith("__host-b17_session=") and "max-age=0" in cleared
        assert "secure" in cleared and "httponly" in cleared and "domain" not in cleared
    finally:
        env.close()


def test_no_auth_token_ever_appears_in_a_response_body(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    responses = [api.register(), api.me()]
    token = api.session_cookie
    assert token
    api.logout()
    responses.append(api.login())
    token = api.session_cookie
    responses.append(
        api.post(
            "/auth/change-password", {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD}
        )
    )
    for response in responses:
        assert (token or "") not in response.text
        assert (api.session_cookie or "") not in response.text


# -- CSRF and Origin (S4) ---------------------------------------------------------------------------------


def test_an_authenticated_mutation_needs_origin_and_the_csrf_token(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, verified=False)

    assert api.post("/auth/resend-verification").status_code == 204  # valid Origin + valid token


@pytest.mark.parametrize(
    "origin", [None, "https://evil.example", "null", ORIGIN + "/", "http://localhost:5173"]
)
def test_an_unsafe_request_needs_an_exact_allowed_origin(
    auth_env: AuthEnv, origin: str | None
) -> None:
    api = signed_in(auth_env, verified=False)

    response = api.post("/auth/resend-verification", origin=origin)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_pre_session_unsafe_requests_need_origin_but_not_a_csrf_token(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()

    assert api.login(origin=None).status_code == 403
    assert api.login(origin="https://evil.example").status_code == 403
    assert api.post("/auth/forgot-password", {"email": "a@b.org"}, origin=None).status_code == 403
    assert api.post("/auth/verify-email", {"token": "x" * 43}, origin=None).status_code == 403
    assert api.login(csrf=None).status_code == 200  # no token exists before a session


def test_a_stale_cookie_does_not_block_login_or_register(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    stale = {"Cookie": f"{api.cookie_name}={'A' * 43}"}

    assert api.login(csrf=None, headers=stale).status_code == 200
    other = auth_env.client()
    assert other.register(email="new@example.org", csrf=None, headers=stale).status_code == 201


@pytest.mark.parametrize("token", [None, "", "wrong-token", "A" * 43])
def test_an_authenticated_mutation_without_a_valid_csrf_token_is_refused(
    auth_env: AuthEnv, token: str | None
) -> None:
    api = signed_in(auth_env, verified=False)

    response = api.post("/auth/resend-verification", csrf=token)

    assert response.status_code == 403 and response.json()["error"]["code"] == "csrf_failed"
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["error"]["requestId"] == response.headers["x-request-id"]


def test_a_csrf_token_from_another_session_is_refused(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, verified=False)
    mine, theirs = auth_env.client(), auth_env.client()
    mine.login()
    theirs.login()

    assert mine.post("/auth/resend-verification", csrf=theirs.csrf).status_code == 403
    assert mine.post("/auth/resend-verification", csrf=mine.csrf).status_code == 204


def test_the_csrf_token_is_bound_to_the_session_secret(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, verified=False)

    assert api.csrf == csrf_token_for(api.session_cookie or "")
    # after a rotation the old token stops working, the new one works
    old = api.csrf
    api._remember(
        api.post(
            "/auth/change-password", {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD}
        )
    )
    assert api.csrf != old
    assert api.post("/auth/resend-verification", csrf=old).status_code == 403
    assert api.post("/auth/resend-verification").status_code == 204


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, 204), ("same-origin", 204), ("same-site", 204), ("cross-site", 403), ("none", 403)],
)
def test_sec_fetch_site_is_defence_in_depth_not_a_requirement(
    auth_env: AuthEnv, value: str | None, expected: int
) -> None:
    api = signed_in(auth_env, verified=False)
    headers = {"Sec-Fetch-Site": value} if value is not None else None

    assert api.post("/auth/resend-verification", headers=headers).status_code == expected


def test_a_cross_site_fetch_is_refused_even_with_a_valid_token_and_origin(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env, verified=False)

    response = api.post("/auth/resend-verification", headers={"Sec-Fetch-Site": "cross-site"})

    assert response.json()["error"]["code"] == "csrf_failed"


def test_safe_methods_never_need_csrf_or_origin(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    assert api.get("/auth/me", origin=None, csrf=None).status_code == 200
    assert api.get("/auth/me", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 200


def test_every_unsafe_api_request_is_origin_checked_not_just_auth(auth_env: AuthEnv) -> None:
    api = auth_env.client()

    assert api.post("/health", origin=None).status_code == 403
    assert api.post("/health").status_code == 405  # routing is reached only with a good Origin


def test_csrf_failures_are_readable_by_the_allowed_browser_origin(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, verified=False)

    response = api.post("/auth/resend-verification", csrf="nope")

    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"


# -- content type -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "content_type",
    ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"],
)
def test_auth_endpoints_accept_json_bodies_only(auth_env: AuthEnv, content_type: str) -> None:
    api = auth_env.client()

    response = api.post(
        "/auth/login",
        headers={"Content-Type": content_type},
        content=b'{"email":"a","password":"b"}',
    )

    assert response.status_code == 415 and response.json()["error"]["code"] == "bad_request"


def test_a_json_charset_parameter_is_fine(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)

    response = auth_env.client().post(
        "/auth/login",
        headers={"Content-Type": "application/json; charset=utf-8"},
        content=b'{"email":"ayesha@example.org","password":"correct horse battery staple"}',
    )

    assert response.status_code == 200


def test_multipart_is_not_globally_forbidden_outside_auth(auth_env: AuthEnv) -> None:
    """Future upload routes may use multipart; the policy is scoped to /auth/ only."""
    api = auth_env.client()

    response = api.post(
        "/health", headers={"Content-Type": "multipart/form-data; boundary=x"}, content=b""
    )

    assert response.status_code == 405  # reached routing: not rejected as a content type


# -- CORS -------------------------------------------------------------------------------------------------


def test_cors_allows_credentials_only_for_the_exact_configured_origin(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    preflight = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
    }

    allowed = api.http.options("/api/v1/auth/login", headers={"Origin": ORIGIN, **preflight})
    refused = api.http.options(
        "/api/v1/auth/login", headers={"Origin": "https://evil.example", **preflight}
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == ORIGIN != "*"
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert "x-csrf-token" in allowed.headers["access-control-allow-headers"].lower()
    assert refused.status_code == 400 and "access-control-allow-origin" not in refused.headers


# -- caching ----------------------------------------------------------------------------------------------


def test_every_auth_response_is_no_store_but_public_reads_are_untouched(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    responses = [
        api.me(),  # 401
        api.register(),  # 201
        api.me(),  # 200
        api.post("/auth/register", {}),  # 422
        api.post("/auth/resend-verification", csrf="bad"),  # 403
        api.logout(),  # 204
        api.login(password="wrong wrong wrong"),  # 401
        api.post("/auth/forgot-password", {"email": "x@y.org"}),  # 202
    ]
    for response in responses:
        assert response.headers["cache-control"] == "no-store", response.request.url

    assert "no-store" not in api.get("/categories").headers.get("cache-control", "")
    assert "no-store" not in api.get("/health").headers.get("cache-control", "")


# -- redaction (S10) -----------------------------------------------------------------------------------


def test_nothing_secret_is_logged(auth_env: AuthEnv, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    make_account(auth_env.session, "known@example.org")
    api = auth_env.client()
    api.register()
    verification = last_token(auth_env, "email_verification")
    api.login(email="known@example.org", password="wrong wrong wrong")
    api.post("/auth/forgot-password", {"email": "known@example.org"})
    reset_token = last_token(auth_env, "password_reset")
    api.post(
        "/auth/reset-password",
        {"token": reset_token, "newPassword": OTHER_PASSWORD},
    )
    api.post("/auth/register", {"email": "bad", "password": "tooshort1", "displayName": "X"})
    session_token = api.session_cookie

    everything = " ".join(f"{record.getMessage()} {record.__dict__}" for record in caplog.records)

    for secret in (
        PASSWORD,
        OTHER_PASSWORD,
        "wrong wrong wrong",
        "tooshort1",
        verification,
        reset_token,
        session_token or "<none>",
    ):
        assert secret not in everything, secret


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "a@b.org", "password": 1234567890123, "displayName": "Ayesha"},
        {"email": "a@b.org", "password": ["x" * 20], "displayName": "Ayesha"},
        {"email": "a@b.org", "password": None, "displayName": "Ayesha"},
        {"email": "a@b.org", "password": {"nested": "super-secret-value"}, "displayName": "Ayesha"},
    ],
)
def test_malformed_payloads_do_not_echo_secrets(auth_env: AuthEnv, payload: dict) -> None:  # type: ignore[type-arg]
    response = auth_env.client().post("/auth/register", payload)

    assert response.status_code == 422
    assert "super-secret-value" not in response.text and "1234567890123" not in response.text


def test_invalid_json_is_a_plain_bad_request(auth_env: AuthEnv) -> None:
    response = auth_env.client().post(
        "/auth/login",
        headers={"Content-Type": "application/json"},
        content=b'{"email": "a", "password": "hunter2-secret',
    )

    assert response.status_code == 400 and "hunter2-secret" not in response.text
