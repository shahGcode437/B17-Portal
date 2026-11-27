"""Signing out under REAL concurrency (AUTH_RBAC.md §34; BACKEND_ARCHITECTURE.md §5.2).

ONE lock order for authentication writes: the ``users`` row **before** any ``auth_sessions`` row.
Password change, password reset, a sign-in that evicts a session and every staff change take the
user ``FOR UPDATE`` and then revoke sessions. Logout writes an audit row whose foreign key locks
the user, so it must take that lock first too, or the two can deadlock.

Nothing here is a timing race. One side is paused right after taking its locks, the other is
OBSERVED waiting in ``pg_stat_activity``, and only then is the first released. Separate PostgreSQL
connections, committed rows, the real endpoints.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import pytest
from httpx import Response
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from app.core.security.tokens import hash_token
from app.models.enums import StaffScope
from app.repositories.auth import UserAuthRepository
from app.repositories.grocery import GroceryRepository
from app.repositories.staff import StaffManagementRepository
from app.services.auth_sessions import SessionService
from tests.db.auth_helpers import (
    OTHER_PASSWORD,
    PASSWORD,
    AuthApi,
    AuthEnv,
    last_token,
    make_account,
)
from tests.db.grocery_helpers import (
    cancel,
    open_for_orders,
    order_count,
    outcome,
    places,
    purge_grocery,
    submit,
    submitted,
)
from tests.db.staff_helpers import purge_staff_audit
from tests.db.test_grocery_concurrency import Running, browser, gate_method, user_id, waiting
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import scalar, wait_until

EMAIL = "holder@example.org"
SESSION_CAP = 10  # the default of ``max_sessions_per_user``


@pytest.fixture
def world(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_staff_audit(db_engine), purge_grocery(db_engine), committed_world(db_engine) as env:
        yield env


def session_id(engine: Engine, api: AuthApi) -> uuid.UUID:
    assert api.session_cookie is not None
    found = scalar(
        engine,
        "SELECT id FROM auth_sessions WHERE token_hash = :h",
        h=hash_token(api.session_cookie),
    )
    return uuid.UUID(str(found))


def revoke_reason(engine: Engine, which: uuid.UUID) -> str | None:
    found = scalar(engine, "SELECT revoke_reason FROM auth_sessions WHERE id = :id", id=which)
    return None if found is None else str(found)


def active_sessions(engine: Engine, owner: uuid.UUID) -> int:
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM auth_sessions WHERE user_id = :u AND revoked_at IS NULL",
            u=owner,
        )
    )


def logout_events(engine: Engine, owner: uuid.UUID) -> int:
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM auth_events WHERE user_id = :u "
            "AND event_type IN ('logout', 'logout_all')",
            u=owner,
        )
    )


def session_row_is_free(engine: Engine, which: uuid.UUID) -> bool:
    """Whether another transaction could lock the session row at this instant."""
    with engine.connect() as connection:
        try:
            connection.execute(
                text("SELECT id FROM auth_sessions WHERE id = :id FOR UPDATE NOWAIT"),
                {"id": which},
            )
        except OperationalError:
            return False
        finally:
            connection.rollback()
    return True


def blocked(engine: Engine, count: int) -> None:
    wait_until(lambda: waiting(engine, "%") == count, f"{count} request(s) to wait on a lock")


# -- the operations that lock the user and then revoke sessions ---------------------------------------


@dataclass
class Case:
    """One account, the browser that signs out, and an operation that takes the user row
    ``FOR UPDATE`` and then revokes that browser's session."""

    owner: uuid.UUID
    leaving: AuthApi
    act: Callable[[], Response]
    done: int  # the status of a successful operation
    locks_user: tuple[type, str]  # the call that takes the user row FOR UPDATE
    reason: str  # the revoke reason the operation writes
    #: active sessions afterwards: (after a single logout, operation first), (… logout first),
    #: (after logout-all, operation first), (… logout-all first)
    active: tuple[int, int, int, int]


def password_change(env: AuthEnv, engine: Engine) -> Case:
    make_account(env.session, EMAIL)
    changing, leaving = browser(env, EMAIL), browser(env, EMAIL)
    return Case(
        user_id(engine, EMAIL),
        leaving,
        lambda: changing.post(
            "/auth/change-password",
            {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD},
        ),
        200,
        (UserAuthRepository, "lock"),
        "password_change",
        (1, 1, 0, 0),
    )


def password_reset(env: AuthEnv, engine: Engine) -> Case:
    make_account(env.session, EMAIL)
    leaving = browser(env, EMAIL)
    anonymous = env.client()
    assert anonymous.post("/auth/forgot-password", {"email": EMAIL}).status_code == 202
    token = last_token(env, "password_reset")
    return Case(
        user_id(engine, EMAIL),
        leaving,
        lambda: anonymous.post(
            "/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD}
        ),
        204,
        (UserAuthRepository, "lock"),
        "password_reset",
        (0, 0, 0, 0),
    )


def sign_in_at_the_session_cap(env: AuthEnv, engine: Engine) -> Case:
    make_account(env.session, EMAIL)
    browsers = []
    for _ in range(SESSION_CAP):
        browsers.append(browser(env, EMAIL))
        env.clock.advance(seconds=1)  # so "the oldest session" is the first one
    arriving = env.client()
    return Case(
        user_id(engine, EMAIL),
        browsers[0],  # the oldest: the one the new sign-in evicts
        lambda: arriving.login(EMAIL),
        200,
        (UserAuthRepository, "lock"),
        "session_cap",
        (SESSION_CAP, SESSION_CAP, 0, 1),
    )


def staff_removal(env: AuthEnv, engine: Engine) -> Case:
    make_account(env.session, "boss@example.org", admin=True)
    make_account(env.session, EMAIL, moderator_scopes=[StaffScope.FOOD])
    boss, leaving = browser(env, "boss@example.org"), browser(env, EMAIL)
    target = user_id(engine, EMAIL)
    return Case(
        target,
        leaving,
        lambda: boss.request("DELETE", f"/admin/staff/moderators/{target}"),
        204,
        (StaffManagementRepository, "lock_user"),
        "role_change",
        (0, 0, 0, 0),
    )


OPERATIONS = {
    "password change": password_change,
    "password reset": password_reset,
    "sign-in at the session cap": sign_in_at_the_session_cap,
    "staff role removal": staff_removal,
}
SIGN_OUT = {"logout": ("/auth/logout", "revoke"), "logout-all": ("/auth/logout-all", "revoke_all")}


@pytest.mark.parametrize("sign_out", list(SIGN_OUT))
@pytest.mark.parametrize("operation", list(OPERATIONS))
def test_a_sign_out_arriving_while_the_user_is_locked_waits_and_both_finish(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    sign_out: str,
) -> None:
    case = OPERATIONS[operation](world, db_engine)
    leaving = session_id(db_engine, case.leaving)
    gate = gate_method(monkeypatch, *case.locks_user, after=True)
    first = Running(case.act)
    gate.wait_arrived()  # the user row is FOR UPDATE; no session has been touched yet

    second = Running(lambda: case.leaving.post(SIGN_OUT[sign_out][0]))
    blocked(db_engine, 1)
    free_while_waiting = session_row_is_free(db_engine, leaving)
    gate.release.set()

    statuses = (first.finish().status_code, second.finish().status_code)
    assert statuses == (case.done, 204)
    assert free_while_waiting, "the sign-out held its session while it waited for the user"
    assert case.leaving.me().status_code == 401
    assert revoke_reason(db_engine, leaving) == case.reason  # the operation committed first
    expected = case.active[0 if sign_out == "logout" else 2]
    assert active_sessions(db_engine, case.owner) == expected
    assert logout_events(db_engine, case.owner) == 1


@pytest.mark.parametrize("sign_out", list(SIGN_OUT))
@pytest.mark.parametrize("operation", list(OPERATIONS))
def test_an_operation_arriving_during_a_sign_out_waits_and_both_finish(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    sign_out: str,
) -> None:
    case = OPERATIONS[operation](world, db_engine)
    leaving = session_id(db_engine, case.leaving)
    path, method = SIGN_OUT[sign_out]
    gate = gate_method(monkeypatch, SessionService, method, after=True)
    first = Running(lambda: case.leaving.post(path))
    gate.wait_arrived()  # the sessions are revoked, not yet committed, no audit row yet

    second = Running(case.act)
    blocked(db_engine, 1)
    gate.release.set()

    # A logout-all also ends the session a password change was requested from, so a change that
    # arrives behind it is refused and changes nothing (AUTH_RBAC.md §35).
    refused = (operation, sign_out) == ("password change", "logout-all")
    statuses = (first.finish().status_code, second.finish().status_code)
    assert statuses == (204, 401 if refused else case.done)
    if refused:
        assert world.client().login(EMAIL, PASSWORD).status_code == 200
        assert world.client().login(EMAIL, OTHER_PASSWORD).status_code == 401
        return
    assert case.leaving.me().status_code == 401
    # the sign-out committed first
    assert revoke_reason(db_engine, leaving) == sign_out.replace("-", "_")
    expected = case.active[1 if sign_out == "logout" else 3]
    assert active_sessions(db_engine, case.owner) == expected
    assert logout_events(db_engine, case.owner) == 1


def test_after_a_concurrent_logout_only_the_new_password_and_the_changer_remain(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The semantics of a password change survive the collision."""
    make_account(world.session, EMAIL)
    changing, leaving = browser(world, EMAIL), browser(world, EMAIL)
    old_cookie = changing.session_cookie
    gate = gate_method(monkeypatch, UserAuthRepository, "lock", after=True)
    change = Running(
        lambda: changing.post(
            "/auth/change-password",
            {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD},
        )
    )
    gate.wait_arrived()
    logout = Running(leaving.logout)
    blocked(db_engine, 1)
    gate.release.set()

    changed = change.finish()
    assert (changed.status_code, logout.finish().status_code) == (200, 204)
    changing.csrf = changed.json()["data"]["csrfToken"]
    assert changing.session_cookie != old_cookie and changing.me().status_code == 200
    assert leaving.me().status_code == 401
    assert world.client().login(EMAIL, PASSWORD).status_code == 401
    assert world.client().login(EMAIL, OTHER_PASSWORD).status_code == 200


# -- Grocery submit and cancel against a sign-out of the same session ---------------------------------


def grocery_buyer(env: AuthEnv) -> AuthApi:
    open_for_orders(env)
    make_account(env.session, EMAIL)
    return browser(env, EMAIL)


def same_session(api: AuthApi, env: AuthEnv) -> AuthApi:
    """A second HTTP client holding the SAME session, so two requests can be in flight."""
    twin = env.client()
    assert api.session_cookie is not None
    twin.http.cookies.set(api.cookie_name, api.session_cookie)
    twin.csrf = api.csrf
    return twin


def test_a_logout_waits_for_an_order_submission_in_flight(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = grocery_buyer(world)
    twin = same_session(api, world)
    gate = gate_method(monkeypatch, GroceryRepository, "lock_account", after=True)
    submission = Running(lambda: submit(api))
    gate.wait_arrived()
    logout = Running(twin.logout)
    blocked(db_engine, 1)
    gate.release.set()

    assert (submission.finish().status_code, logout.finish().status_code) == (201, 204)
    assert order_count(world.session) == 1


def test_a_submission_waits_for_a_logout_in_flight_and_then_stores_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = grocery_buyer(world)
    twin = same_session(api, world)
    gate = gate_method(monkeypatch, SessionService, "revoke", after=True)
    logout = Running(twin.logout)
    gate.wait_arrived()
    submission = Running(lambda: submit(api))
    blocked(db_engine, 1)
    gate.release.set()

    assert logout.finish().status_code == 204
    assert outcome(submission.finish()) == (401, "session_expired")
    assert (order_count(world.session), places(world.session)) == (0, 0)


def test_a_logout_waits_for_a_cancellation_in_flight(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = grocery_buyer(world)
    order = submitted(api)
    twin = same_session(api, world)
    gate = gate_method(monkeypatch, GroceryRepository, "lock_account", after=True)
    cancellation = Running(lambda: cancel(api, order["id"]))
    gate.wait_arrived()
    logout = Running(twin.logout)
    blocked(db_engine, 1)
    gate.release.set()

    assert (cancellation.finish().status_code, logout.finish().status_code) == (200, 204)


def test_a_cancellation_waits_for_a_logout_in_flight_and_then_changes_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = grocery_buyer(world)
    order = submitted(api)
    twin = same_session(api, world)
    gate = gate_method(monkeypatch, SessionService, "revoke", after=True)
    logout = Running(twin.logout)
    gate.wait_arrived()
    cancellation = Running(lambda: cancel(api, order["id"]))
    blocked(db_engine, 1)
    gate.release.set()

    assert logout.finish().status_code == 204
    assert outcome(cancellation.finish()) == (401, "session_expired")
    assert scalar(db_engine, "SELECT status FROM grocery_orders") == "submitted"


def test_a_submission_a_queued_password_change_and_a_logout_all_finish(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Three at once: the order holds the user ``FOR SHARE``, a password change is queued for it
    ``FOR UPDATE``, and the order's own session signs out. PostgreSQL lets the sign-out's weaker
    user lock pass the queued writer, so the three cannot form a cycle."""
    api = grocery_buyer(world)
    twin = same_session(api, world)
    elsewhere = browser(world, EMAIL)
    gate = gate_method(monkeypatch, GroceryRepository, "lock_account", after=True)
    submission = Running(lambda: submit(api))
    gate.wait_arrived()
    change = Running(
        lambda: elsewhere.post(
            "/auth/change-password",
            {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD},
        )
    )
    blocked(db_engine, 1)
    logout = Running(twin.logout)
    blocked(db_engine, 2)
    gate.release.set()

    assert submission.finish().status_code == 201
    assert (logout.finish().status_code, change.finish().status_code) == (204, 200)
    assert order_count(world.session) == 1
