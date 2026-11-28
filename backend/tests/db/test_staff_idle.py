"""Staff inactivity (GROCERY-4A, ``docs/backend/AUTH_RBAC.md`` §38.4).

The staff rule is unchanged: a staff action needs a session USED for staff work within 2 hours and
created within 12. Asking who is signed in (``GET /auth/me``) is not use: a tab checking the
sign-in, a reload or another tab's announcement must never make an idle staff session fresh again.
Time is the test's clock; nothing waits.
"""

from typing import Any

import pytest
from sqlalchemy import select

from app.core.security.tokens import hash_token
from app.models import AuthSession
from app.models.enums import StaffScope
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account

SA = "sa@example.org"
MOD = "mod@example.org"
RESIDENT = "res@example.org"

STAFF = [
    pytest.param({"admin": True}, "/admin/staff", id="super-admin"),
    pytest.param(
        {"moderator_scopes": [StaffScope.FOOD]}, "/admin/listings", id="listing-moderator"
    ),
    pytest.param(
        {"moderator_scopes": [StaffScope.GROCERY]}, "/admin/grocery/orders", id="grocery-moderator"
    ),
]


def sign_in(env: AuthEnv, email: str, **account: object) -> AuthApi:
    make_account(env.session, email, **account)  # type: ignore[arg-type]
    api = env.client()
    assert api.login(email).status_code == 200
    return api


def row(env: AuthEnv, api: AuthApi) -> AuthSession:
    assert api.session_cookie is not None
    env.session.expire_all()
    return env.session.scalars(
        select(AuthSession).where(AuthSession.token_hash == hash_token(api.session_cookie))
    ).one()


def code(response: object) -> str:
    return str(response.json()["error"]["code"])  # type: ignore[attr-defined]


@pytest.mark.parametrize(("account", "staff_path"), STAFF)
def test_identity_checks_never_keep_an_idle_staff_session_alive(
    auth_env: AuthEnv, account: dict[str, object], staff_path: str
) -> None:
    staff = sign_in(auth_env, SA, **account)
    assert staff.get(staff_path).status_code == 200

    # Three hours of tabs asking who is signed in, every ten minutes.
    for _ in range(18):
        auth_env.clock.advance(minutes=10)
        assert staff.me().status_code == 200

    refused = staff.get(staff_path)
    assert refused.status_code == 401 and code(refused) == "session_expired"
    # ...and it stays refused, whatever is asked next.
    assert staff.me().status_code == 200  # still signed in as an account
    assert staff.get(staff_path).status_code == 401


@pytest.mark.parametrize(("account", "staff_path"), STAFF)
def test_an_identity_check_writes_nothing_for_staff(
    auth_env: AuthEnv, account: dict[str, object], staff_path: str
) -> None:
    staff = sign_in(auth_env, SA, **account)
    before = row(auth_env, staff)
    seen, expires = before.last_seen_at, before.expires_at

    auth_env.clock.advance(hours=1)
    assert staff.me().status_code == 200

    after = row(auth_env, staff)
    assert (after.last_seen_at, after.expires_at) == (seen, expires)


@pytest.mark.parametrize(("account", "staff_path"), STAFF)
def test_ordinary_use_of_the_account_does_not_count_as_staff_activity(
    auth_env: AuthEnv, account: dict[str, object], staff_path: str
) -> None:
    """Saved items and one's own requests are the person using the app, not staff work."""
    staff = sign_in(auth_env, SA, **account)
    for _ in range(18):
        auth_env.clock.advance(minutes=10)
        assert staff.get("/saved").status_code == 200

    assert code(staff.get(staff_path)) == "session_expired"


@pytest.mark.parametrize(("account", "staff_path"), STAFF)
def test_staff_work_keeps_the_session_fresh_until_the_absolute_limit(
    auth_env: AuthEnv, account: dict[str, object], staff_path: str
) -> None:
    staff = sign_in(auth_env, SA, **account)
    for _ in range(7):  # 90 minutes apart: each use restarts the two hours
        auth_env.clock.advance(minutes=90)
        assert staff.get(staff_path).status_code == 200
    assert row(auth_env, staff).last_seen_at == auth_env.clock()

    auth_env.clock.advance(minutes=91)  # past 12 hours since sign-in
    assert code(staff.get(staff_path)) == "session_expired"


@pytest.mark.parametrize(("account", "staff_path"), STAFF)
def test_the_two_hours_are_measured_to_the_boundary(
    auth_env: AuthEnv, account: dict[str, object], staff_path: str
) -> None:
    on_time = sign_in(auth_env, SA, **account)
    auth_env.clock.advance(hours=2)
    assert on_time.get(staff_path).status_code == 200
    auth_env.clock.advance(hours=2, seconds=1)
    assert on_time.get(staff_path).status_code == 401


def test_a_refused_staff_request_leaves_nothing_for_the_next_one(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No request may make the session fresh before the staff rule has judged it, not even for the
    moment until a refusal is undone (another request could look in between)."""
    staff = sign_in(auth_env, SA, admin=True)
    seen = row(auth_env, staff).last_seen_at
    auth_env.clock.advance(hours=3)

    writes: list[str] = []
    original = auth_env.session.execute

    def watching(statement: Any, *args: Any, **kwargs: Any) -> Any:
        text = str(statement)
        if text.lstrip().upper().startswith("UPDATE AUTH_SESSIONS") and "last_seen_at" in text:
            writes.append(text)
        return original(statement, *args, **kwargs)

    monkeypatch.setattr(auth_env.session, "execute", watching)
    assert staff.get("/admin/staff").status_code == 401
    monkeypatch.undo()

    assert writes == []
    assert row(auth_env, staff).last_seen_at == seen


def test_a_staff_account_stays_signed_in_for_ordinary_use(auth_env: AuthEnv) -> None:
    """Only the staff clock stands still: the account's own session still slides when it is used."""
    staff = sign_in(auth_env, SA, admin=True)
    started = row(auth_env, staff)
    expires = started.expires_at
    auth_env.clock.advance(days=10)
    assert staff.get("/saved").status_code == 200
    assert row(auth_env, staff).expires_at > expires
    auth_env.clock.advance(days=10)  # past the first idle window, not past the slid one
    assert staff.get("/saved").status_code == 200


def test_residents_are_not_affected(auth_env: AuthEnv) -> None:
    resident = sign_in(auth_env, RESIDENT)
    auth_env.clock.advance(days=13)
    assert resident.me().status_code == 200  # their identity read still slides, as before
    assert row(auth_env, resident).last_seen_at == auth_env.clock()
    auth_env.clock.advance(days=13)
    assert resident.me().status_code == 200
