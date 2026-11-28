"""Private reads are bound to a session (GROCERY-4A, ``docs/backend/AUTH_RBAC.md`` §38).

A ``GET`` is answered for whoever the browser's cookie belongs to when it arrives. A client that
sends the session's CSRF token (``X-CSRF-Token``) says which session it means, and any other
session is refused (``403 session_mismatch``) before anything is read or written.

The routes are taken from the application's own route table, so a new route is covered, or has to
be classified here, the moment it exists.
"""

import logging
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select

from app.core.security.tokens import csrf_token_for, hash_token
from app.dependencies.auth import resolve_authentication
from app.factory import create_app
from app.models import AuthSession
from app.models.enums import PlanCode
from app.services.auth_sessions import SessionService
from tests.db.auth_helpers import ORIGIN, AuthApi, AuthEnv, make_account, make_test_settings

PREFIX = "/api/v1"
HEADER = "X-CSRF-Token"
#: Answering these reads the session; asking who is signed in must work for any token a tab holds.
DISCOVERY = {f"{PREFIX}/auth/me"}
#: Every ``GET`` that needs no session. A new route lands in neither list by accident: the last
#: tests fail until it is classified.
PUBLIC = {
    f"{PREFIX}/auth/oauth/google/callback",  # a browser navigation from Google, never a fetch
    f"{PREFIX}/categories",
    f"{PREFIX}/grocery/availability",
    f"{PREFIX}/health",
    f"{PREFIX}/health/ready",
    f"{PREFIX}/listings/{{listing_id}}",
    f"{PREFIX}/news",
    f"{PREFIX}/news/{{article_id}}",
    f"{PREFIX}/search",
    f"{PREFIX}/search/suggestions",
}
PRIVATE = {
    f"{PREFIX}/admin/audit",
    f"{PREFIX}/admin/categories",
    f"{PREFIX}/admin/grocery/orders",
    f"{PREFIX}/admin/grocery/orders/{{order_id}}",
    f"{PREFIX}/admin/grocery/settings",
    f"{PREFIX}/admin/listings",
    f"{PREFIX}/admin/listings/{{listing_id}}",
    f"{PREFIX}/admin/requests",
    f"{PREFIX}/admin/requests/{{request_id}}",
    f"{PREFIX}/admin/staff",
    f"{PREFIX}/grocery/orders",
    f"{PREFIX}/grocery/orders/{{order_id}}",
    f"{PREFIX}/requests",
    f"{PREFIX}/requests/{{request_id}}",
    f"{PREFIX}/saved",
    f"{PREFIX}/users/me/leads",
    f"{PREFIX}/users/me/listings",
    f"{PREFIX}/users/me/listings/{{listing_id}}",
}


def _calls(dependant: Any) -> Iterator[Any]:
    yield dependant.call
    for child in dependant.dependencies:
        yield from _calls(child)


def _routes(items: Any, prefix: str = "") -> Iterator[tuple[str, APIRoute]]:
    for route in items:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        elif hasattr(route, "original_router"):
            context = getattr(route, "include_context", None)
            yield from _routes(
                route.original_router.routes, prefix + (getattr(context, "prefix", "") or "")
            )


def get_routes() -> dict[str, bool]:
    """``path template -> does answering it read the session``."""
    app = create_app(make_test_settings())
    return {
        path: any(call is resolve_authentication for call in _calls(route.dependant))
        for path, route in _routes(app.router.routes)
        if "GET" in (route.methods or set())
    }


def concrete(template: str) -> str:
    path = template.removeprefix(PREFIX)
    while "{" in path:
        start, end = path.index("{"), path.index("}")
        path = path[:start] + str(uuid.UUID(int=7)) + path[end + 1 :]
    return path


# -- the table is complete -------------------------------------------------------------------------


def test_every_get_route_is_classified() -> None:
    found = get_routes()
    assert {path for path, reads_session in found.items() if reads_session} == PRIVATE | DISCOVERY
    assert {path for path, reads_session in found.items() if not reads_session} == PUBLIC
    # The same GET paths the API publishes: nothing was missed by walking the routers.
    published = create_app(make_test_settings()).openapi()["paths"]
    assert {path for path, operations in published.items() if "get" in operations} == set(found)


# -- two sessions -----------------------------------------------------------------------------------


def sign_in(env: AuthEnv, email: str, **account: Any) -> AuthApi:
    make_account(env.session, email, **account)
    api = env.client()
    assert api.login(email).status_code == 200
    return api


@pytest.fixture
def two_accounts(auth_env: AuthEnv) -> tuple[AuthEnv, AuthApi, AuthApi]:
    """Both may read everything (a Super Admin with a professional profile), so a refusal can only
    be about the session named."""
    everything: dict[str, Any] = {"admin": True, "professional": PlanCode.PREMIUM}
    alice = sign_in(auth_env, "alice@example.org", **everything)
    bob = sign_in(auth_env, "bob@example.org", **everything)
    return auth_env, alice, bob


def sessions(env: AuthEnv) -> list[tuple[Any, ...]]:
    env.session.expire_all()
    return sorted(
        (s.id, s.token_hash, s.last_seen_at, s.expires_at, s.revoked_at)
        for s in env.session.scalars(select(AuthSession))
    )


def csrf(api: AuthApi) -> str:
    assert api.session_cookie is not None
    return csrf_token_for(api.session_cookie)


def named(api: AuthApi, token: str | None, path: str) -> Any:
    """A read naming ``token``'s session (``None``: naming none). NOTE: the test client sends its
    own token unless ``csrf=`` says otherwise, and that replaces any header passed by hand."""
    return api.get(path, csrf=token)


@pytest.mark.parametrize("template", sorted(PRIVATE))
def test_a_read_naming_another_accounts_session_is_refused_untouched(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], template: str
) -> None:
    env, alice, bob = two_accounts
    env.clock.advance(minutes=6)  # both sessions are due to slide: a refused read must not
    before = sessions(env)

    # The browser's cookie is now Bob's; the tab still means Alice.
    response = named(bob, csrf(alice), concrete(template))

    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "session_mismatch" and "data" not in body
    assert body["error"]["requestId"]
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"
    assert sessions(env) == before  # nothing refreshed, rotated, revoked or overwritten


@pytest.mark.parametrize("template", sorted(PRIVATE))
def test_a_read_naming_its_own_session_is_answered_as_before(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], template: str
) -> None:
    _, alice, _ = two_accounts
    without = named(alice, None, concrete(template))
    bound = named(alice, csrf(alice), concrete(template))

    assert bound.status_code == without.status_code
    assert bound.status_code in (200, 404)  # the detail routes were given an id that does not exist
    assert bound.json().get("data") == without.json().get("data")


@pytest.mark.parametrize("template", sorted(PRIVATE))
def test_a_client_that_names_no_session_is_served_as_before(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], template: str
) -> None:
    """COMPATIBILITY, and the limit of it: an older client is not protected by the server."""
    _, _, bob = two_accounts
    assert named(bob, None, concrete(template)).status_code in (200, 404)


def test_the_same_accounts_other_session_is_another_session(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi],
) -> None:
    env, alice, _ = two_accounts
    again = env.client()
    assert again.login("alice@example.org").status_code == 200
    response = named(again, csrf(alice), "/saved")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "session_mismatch"


@pytest.mark.parametrize(
    "token", ["", "nonsense", "a" * 43, "é"], ids=["empty", "junk", "long", "non-ascii"]
)
def test_a_malformed_name_is_a_mismatch_not_an_error(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], token: str
) -> None:
    _, alice, _ = two_accounts
    raw: Any = {HEADER: token.encode("utf-8")}  # bytes, so a non-ASCII value can be sent at all
    response = alice.get("/saved", csrf=None, headers=raw)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "session_mismatch"


def test_the_binding_is_judged_before_the_session_is_looked_up(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, alice, bob = two_accounts

    def never(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("the session was looked up for a mismatched read")

    monkeypatch.setattr(SessionService, "authenticate", never)
    assert named(bob, csrf(alice), "/saved").status_code == 403


def test_it_comes_before_every_permission_rule(auth_env: AuthEnv) -> None:
    """No oracle: a mismatched read learns nothing about the cookie's account."""
    alice = sign_in(auth_env, "alice@example.org", admin=True)
    plain = sign_in(auth_env, "plain@example.org", verified=False)
    for path in ("/admin/staff", "/grocery/orders", "/users/me/leads"):
        response = named(plain, csrf(alice), path)
        assert response.json()["error"]["code"] == "session_mismatch", path


def test_a_dead_cookie_named_wrongly_is_not_cleared(auth_env: AuthEnv) -> None:
    """A mismatched read must never overwrite or clear the cookie, even a dead one."""
    alice = sign_in(auth_env, "alice@example.org")
    bob = sign_in(auth_env, "bob@example.org")
    elsewhere = auth_env.client()
    assert elsewhere.login("bob@example.org").status_code == 200
    assert elsewhere.request("POST", "/auth/logout-all").status_code == 204

    response = named(bob, csrf(alice), "/saved")

    assert response.json()["error"]["code"] == "session_mismatch"
    assert "set-cookie" not in response.headers


def test_a_name_with_no_cookie_is_simply_signed_out(auth_env: AuthEnv) -> None:
    alice = sign_in(auth_env, "alice@example.org")
    response = named(auth_env.client(), csrf(alice), "/saved")
    assert response.status_code == 401 and response.json()["error"]["code"] == "unauthenticated"


def test_asking_who_is_signed_in_is_never_bound(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi],
) -> None:
    _, alice, bob = two_accounts
    response = named(bob, csrf(alice), "/auth/me")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["email"] == "bob@example.org"
    assert body["csrfToken"] == csrf(bob)
    assert body["readBinding"] is True


@pytest.mark.parametrize("template", sorted(PUBLIC - {f"{PREFIX}/auth/oauth/google/callback"}))
def test_public_reads_ignore_the_name(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], template: str
) -> None:
    _, alice, bob = two_accounts
    path = concrete(template)
    expected = bob.get(path)
    response = named(bob, csrf(alice), path)
    assert response.status_code == expected.status_code != 403
    anonymous = named(bob.env.client(), csrf(alice), path)
    assert anonymous.status_code == expected.status_code


def test_changes_keep_their_own_refusal(two_accounts: tuple[AuthEnv, AuthApi, AuthApi]) -> None:
    _, alice, bob = two_accounts
    response = bob.request("PUT", f"/saved/{uuid.UUID(int=7)}", csrf=csrf(alice))
    assert response.status_code == 403 and response.json()["error"]["code"] == "csrf_failed"


def test_a_credentialed_cross_origin_reader_may_send_the_header_and_read_the_refusal(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi],
) -> None:
    _, alice, bob = two_accounts
    preflight = bob.http.options(
        f"{PREFIX}/saved",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-csrf-token",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == ORIGIN
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert "x-csrf-token" in preflight.headers["access-control-allow-headers"].lower()

    refused = bob.get("/saved", csrf=csrf(alice))
    assert refused.status_code == 403
    assert refused.headers["access-control-allow-origin"] == ORIGIN
    assert refused.headers["access-control-allow-credentials"] == "true"

    stranger = bob.http.options(
        f"{PREFIX}/saved",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-csrf-token",
        },
    )
    assert "access-control-allow-origin" not in stranger.headers


def test_neither_token_nor_cookie_is_logged(
    two_accounts: tuple[AuthEnv, AuthApi, AuthApi], caplog: pytest.LogCaptureFixture
) -> None:
    _, alice, bob = two_accounts
    with caplog.at_level(logging.DEBUG):
        named(bob, csrf(alice), "/saved")
        named(alice, csrf(alice), "/saved")
    written = "\n".join(f"{record.getMessage()} {record.__dict__}" for record in caplog.records)
    for secret in (csrf(alice), csrf(bob), alice.session_cookie or "", bob.session_cookie or ""):
        assert secret not in written
    assert hash_token(alice.session_cookie or "").hex() not in written
