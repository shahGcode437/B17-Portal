"""Late session-cookie responses (GROCERY-4A, ``docs/backend/AUTH_RBAC.md`` §38.5).

A browser keeps ONE session cookie and applies every ``Set-Cookie`` it receives, in the order the
responses ARRIVE: no code of ours can look first. A response to a request sent as an older session
can therefore arrive after a newer sign-in. These tests make that order explicit: each response is
produced by the real application, then applied to a model of the browser's cookie in the order a
slow network could deliver it. Nothing depends on timing.

Rule: only a response that IS a sign-in may set the session cookie. Answering any other request
never re-issues it.
"""

import pytest
from httpx import Response

from tests.db.auth_helpers import PASSWORD, AuthApi, AuthEnv, make_account

COOKIE = "b17_session"
ALICE = "alice@example.org"
BOB = "bob@example.org"


class Browser:
    """The one session cookie of a browser, as ``Set-Cookie`` headers change it."""

    def __init__(self, value: str | None = None) -> None:
        self.cookie = value

    def receive(self, response: Response) -> None:
        for header in response.headers.get_list("set-cookie"):
            pair, *attributes = [part.strip() for part in header.split(";")]
            name, _, value = pair.partition("=")
            if name != COOKIE:
                continue
            cleared = any(a.lower() == "max-age=0" for a in attributes)
            self.cookie = None if cleared else value.strip('"')


def session_cookies(response: Response) -> list[str]:
    return [h for h in response.headers.get_list("set-cookie") if h.startswith(f"{COOKIE}=")]


def signed_in(env: AuthEnv, email: str) -> AuthApi:
    api = env.client()
    assert api.login(email).status_code == 200
    return api


def sign_in_response(env: AuthEnv, email: str) -> Response:
    response = env.client().login(email)
    assert response.status_code == 200
    return response


@pytest.fixture
def accounts(auth_env: AuthEnv) -> AuthEnv:
    make_account(auth_env.session, ALICE)
    make_account(auth_env.session, BOB)
    return auth_env


#: Every kind of request that may slide a session, the identity read included.
SLIDING_REQUESTS = ["/auth/me", "/saved", "/requests", "/users/me/listings", "/grocery/orders"]


@pytest.mark.parametrize("path", SLIDING_REQUESTS)
def test_a_late_answer_to_the_older_session_never_restores_it(accounts: AuthEnv, path: str) -> None:
    alice = signed_in(accounts, ALICE)
    accounts.clock.advance(minutes=6)  # the next use of Alice's session slides it

    late = alice.get(path)  # sent as Alice, still on its way
    bob = sign_in_response(accounts, BOB)  # meanwhile another tab signs in
    browser = Browser(alice.session_cookie)
    browser.receive(bob)  # arrives first
    bobs_cookie = browser.cookie
    browser.receive(late)  # arrives last

    assert late.status_code == 200
    assert browser.cookie == bobs_cookie


@pytest.mark.parametrize("path", SLIDING_REQUESTS)
def test_only_a_sign_in_sets_the_session_cookie(accounts: AuthEnv, path: str) -> None:
    alice = signed_in(accounts, ALICE)
    accounts.clock.advance(minutes=6)
    assert session_cookies(alice.get(path)) == []


def test_a_request_answered_before_logout_cannot_bring_the_session_back(accounts: AuthEnv) -> None:
    alice = signed_in(accounts, ALICE)
    accounts.clock.advance(minutes=6)
    browser = Browser(alice.session_cookie)

    late = alice.get("/saved")  # authenticated while the session was alive
    out = alice.request("POST", "/auth/logout")
    assert out.status_code == 204
    browser.receive(out)
    browser.receive(late)

    assert browser.cookie is None


def test_a_request_answered_before_a_password_change_cannot_restore_the_old_token(
    accounts: AuthEnv,
) -> None:
    alice = signed_in(accounts, ALICE)
    accounts.clock.advance(minutes=6)
    browser = Browser(alice.session_cookie)

    late = alice.get("/saved")
    changed = alice.request(
        "POST",
        "/auth/change-password",
        json={"currentPassword": PASSWORD, "newPassword": "a different long passphrase 91"},
    )
    assert changed.status_code == 200
    browser.receive(changed)
    rotated = browser.cookie
    browser.receive(late)

    assert browser.cookie == rotated


def test_the_cookie_outlasts_the_idle_window_and_the_server_still_enforces_it(
    accounts: AuthEnv,
) -> None:
    """The cookie is issued once, for the session's whole absolute lifetime; the idle timeout is
    the server's to enforce, as before."""
    response = sign_in_response(accounts, ALICE)
    (header,) = session_cookies(response)
    max_age = next(a for a in header.split("; ") if a.lower().startswith("max-age="))
    assert int(max_age.split("=")[1]) == accounts.settings.session_absolute_days * 86400

    # Used every few days, the session lives past the first idle window without a new cookie.
    alice = signed_in(accounts, BOB)
    for _ in range(4):
        accounts.clock.advance(days=5)
        used = alice.me()
        assert used.status_code == 200 and session_cookies(used) == []
    accounts.clock.advance(days=accounts.settings.session_idle_days, seconds=1)
    assert alice.me().json()["error"]["code"] == "session_expired"  # idle: refused by the server


# -- what cookies cannot prevent (documented in §38.5; each is fail-closed) ----------------------


def test_limit_a_late_refusal_of_a_dead_session_still_signs_the_browser_out(
    accounts: AuthEnv,
) -> None:
    """A dead session's refusal clears the cookie, and a cookie can't be cleared conditionally.
    Arriving after a newer sign-in, it signs the browser out. Nothing crosses accounts: the next
    request has no session at all."""
    alice = signed_in(accounts, ALICE)
    elsewhere = signed_in(accounts, ALICE)
    assert elsewhere.request("POST", "/auth/logout-all").status_code == 204

    late = alice.get("/saved")
    bob = sign_in_response(accounts, BOB)
    browser = Browser(alice.session_cookie)
    browser.receive(bob)
    browser.receive(late)

    assert late.status_code == 401
    assert browser.cookie is None


def test_limit_of_two_sign_ins_the_answer_that_arrives_last_wins(accounts: AuthEnv) -> None:
    first = sign_in_response(accounts, ALICE)
    second = sign_in_response(accounts, BOB)
    browser = Browser()
    browser.receive(second)
    browser.receive(first)
    expected = Browser()
    expected.receive(first)
    assert browser.cookie == expected.cookie
