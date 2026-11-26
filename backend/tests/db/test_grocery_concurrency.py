"""GROCERY-1b under REAL concurrency: separate PostgreSQL connections over COMMITTED rows
(BACKEND_ARCHITECTURE.md §5.1, API_CONTRACT.md §18).

Nothing here is a timing race. The test HOLDS a real lock (or pauses the code at a named step), and
every contender is OBSERVED waiting in ``pg_stat_activity`` before it is released — so they truly
contend, and the assertions are what must hold in every order they can then run in.

Two "workers" are two application instances with their own connection pools over one database:
no limit may live in a process's memory.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import Response
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from app.core.rate_limit import GROCERY_SUBMIT_HOUR
from app.dependencies.db import get_db_session
from app.factory import create_app
from app.repositories.grocery import SETTINGS_LOCK_KEY, GroceryRepository
from app.repositories.staff import StaffAuthorityRepository
from app.services.email import MemoryEmailSender
from tests.db.auth_helpers import (
    PASSWORD,
    AuthApi,
    AuthEnv,
    fast_passwords,
    make_account,
    make_test_settings,
)
from tests.db.grocery_helpers import (
    ORDERS,
    SETTINGS,
    TODAY,
    cancel,
    configure,
    history_count,
    new_key,
    open_for_orders,
    order_body,
    order_count,
    outcome,
    places,
    purge_grocery,
    settings_revisions,
    submit,
    submitted,
)
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import TIMEOUT, Gate, scalar, wait_until


@pytest.fixture
def world(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_grocery(db_engine), committed_world(db_engine) as env:
        yield env


@contextmanager
def second_worker(env: AuthEnv, db_engine: Engine) -> Iterator[AuthEnv]:
    """Another application instance with ITS OWN engine and pool, as another API process has."""
    engine = create_engine(db_engine.url)
    app: FastAPI = create_app(make_test_settings())

    def session_per_request() -> Iterator[Session]:
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db_session] = session_per_request
    app.state.clock = env.clock
    app.state.email_sender = MemoryEmailSender()
    app.state.password_service = fast_passwords()
    other = AuthEnv(app, env.session, env.clock, app.state.email_sender, make_test_settings())
    try:
        yield other
    finally:
        for api in other._apis:
            api.http.close()
        engine.dispose()


def browser(env: AuthEnv, email: str) -> AuthApi:
    """One more signed-in browser for an existing account (its own session and client)."""
    api = env.client()
    assert api.login(email).status_code == 200
    return api


def buyer(env: AuthEnv, name: str) -> AuthApi:
    make_account(env.session, f"{name}@example.org")
    return browser(env, f"{name}@example.org")


def user_id(engine: Engine, email: str) -> uuid.UUID:
    return uuid.UUID(str(scalar(engine, "SELECT id FROM users WHERE email = :e", e=email)))


class Running:
    """One request on its own thread."""

    def __init__(self, work: Callable[[], Response]) -> None:
        self.response: Response | None = None
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, args=(work,), daemon=True)
        self.thread.start()

    def _run(self, work: Callable[[], Response]) -> None:
        try:
            self.response = work()
        except BaseException as error:  # reported by finish()
            self.error = error

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def finish(self) -> Response:
        self.thread.join(TIMEOUT)
        assert not self.thread.is_alive(), "the request never finished (deadlock?)"
        assert self.error is None, repr(self.error)
        assert self.response is not None
        return self.response


def waiting(engine: Engine, like: str) -> int:
    """Backends blocked on a lock, right now, in a statement matching ``like``."""
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
            "AND wait_event_type = 'Lock' AND query LIKE :p",
            p=like,
        )
    )


def all_waiting(engine: Engine, like: str, requests: list[Running]) -> None:
    wait_until(lambda: waiting(engine, like) == len(requests), f"{len(requests)} to wait on {like}")
    assert all(request.running for request in requests)


@contextmanager
def advisory_lock_held(engine: Engine, key_sql: str, **params: Any) -> Iterator[None]:
    """A SESSION-level advisory lock shares the key space of the transaction-level one."""
    connection = engine.connect()
    try:
        connection.execute(text(f"SELECT pg_advisory_lock({key_sql})"), params)  # noqa: S608
        yield
    finally:
        connection.execute(text(f"SELECT pg_advisory_unlock({key_sql})"), params)  # noqa: S608
        connection.commit()
        connection.close()


@contextmanager
def row_locked(engine: Engine, statement: str, **params: Any) -> Iterator[None]:
    with engine.connect() as connection:
        connection.execute(text(statement), params)
        try:
            yield
        finally:
            connection.rollback()


def gate_method(monkeypatch: pytest.MonkeyPatch, owner: type, method: str, *, after: bool) -> Gate:
    """Pause the FIRST call of ``owner.method``, before it runs or right after it returned (when
    it holds the lock it took). Later calls pass straight through."""
    gate = Gate()
    original = getattr(owner, method)
    first = threading.Lock()

    def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        mine = first.acquire(blocking=False)
        if mine and not after:
            gate.pause()
        result = original(self, *args, **kwargs)
        if mine and after:
            gate.pause()
        return result

    monkeypatch.setattr(owner, method, wrapper)
    return gate


def codes(responses: list[Response]) -> list[tuple[int, str | None]]:
    return sorted((outcome(r) for r in responses), key=str)


# -- the daily capacity, shared by every customer and every worker -------------------------------------


def test_many_customers_on_two_workers_never_exceed_the_daily_capacity(
    db_engine: Engine, world: AuthEnv
) -> None:
    open_for_orders(world, dailyCapacity=3)
    with second_worker(world, db_engine) as other:
        buyers = [buyer(world, f"a{n}") for n in range(4)]
        for n in range(4):
            make_account(world.session, f"b{n}@example.org")
        buyers += [browser(other, f"b{n}@example.org") for n in range(4)]
        # the day's counter exists and its row is held: all eight must queue on it
        with db_engine.begin() as connection:
            connection.execute(
                text("INSERT INTO grocery_daily_capacity (service_date, reserved) VALUES (:d, 0)"),
                {"d": TODAY},
            )
        with row_locked(db_engine, "SELECT 1 FROM grocery_daily_capacity FOR UPDATE"):
            running = [Running(lambda api=api: submit(api)) for api in buyers]  # type: ignore[misc]
            all_waiting(db_engine, "UPDATE grocery_daily_capacity%", running)
        responses = [request.finish() for request in running]

    assert codes(responses) == [(201, None)] * 3 + [(409, "grocery_capacity_reached")] * 5
    assert (places(world.session), order_count(world.session), history_count(world.session)) == (
        3,
        3,
        3,
    )


def test_the_capacity_survives_a_new_application_instance(
    db_engine: Engine, world: AuthEnv
) -> None:
    open_for_orders(world, dailyCapacity=1)
    submitted(buyer(world, "first"))
    make_account(world.session, "second@example.org")

    with second_worker(world, db_engine) as restarted:  # nothing carried over in memory
        response = submit(browser(restarted, "second@example.org"))

    assert outcome(response) == (409, "grocery_capacity_reached")
    assert places(world.session) == 1


def test_a_submission_that_fails_after_reserving_gives_its_place_back(
    world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    open_for_orders(world, dailyCapacity=1)
    api = buyer(world, "unlucky")
    original = GroceryRepository.add_history

    def fail_once(self: GroceryRepository, row: Any) -> None:
        monkeypatch.setattr(GroceryRepository, "add_history", original)
        raise RuntimeError("injected failure after the place was reserved")

    monkeypatch.setattr(GroceryRepository, "add_history", fail_once)
    key = new_key()

    failed = submit(api, key=key)

    assert failed.status_code == 500
    assert (places(world.session), order_count(world.session)) == (0, 0)
    assert (
        scalar_count(
            world,
            "SELECT coalesce(sum(count), 0) FROM auth_rate_limits "
            "WHERE policy LIKE 'grocery_submit%'",
        )
        == 0
    )
    assert submit(api, key=key).status_code == 201  # the same key now creates it, once
    assert (places(world.session), order_count(world.session)) == (1, 1)


def scalar_count(world: AuthEnv, statement: str) -> int:
    world.session.expire_all()
    value = world.session.execute(text(statement)).scalar_one()
    world.session.rollback()
    return int(value)


# -- one customer ------------------------------------------------------------------------------------


def one_customer_at_once(
    db_engine: Engine,
    world: AuthEnv,
    other: AuthEnv,
    calls: list[Callable[[AuthApi], Response]],
) -> list[Response]:
    """Every call in its own browser of ONE account, spread over both workers, all observed
    waiting on that customer's lock before any of them runs."""
    email = "solo@example.org"
    make_account(world.session, email)
    browsers = [browser(world if n % 2 == 0 else other, email) for n in range(len(calls))]
    key_sql = "hashtextextended(:k, 0)"
    with advisory_lock_held(db_engine, key_sql, k=f"b17:grocery_order:{user_id(db_engine, email)}"):
        running = [
            Running(lambda call=call, api=api: call(api))  # type: ignore[misc]
            for call, api in zip(calls, browsers, strict=True)
        ]
        all_waiting(db_engine, "SELECT pg_advisory_xact_lock(hashtextextended%", running)
    return [request.finish() for request in running]


def test_concurrent_orders_of_one_customer_stop_at_the_active_limit(
    db_engine: Engine, world: AuthEnv
) -> None:
    open_for_orders(world)
    with second_worker(world, db_engine) as other:
        responses = one_customer_at_once(db_engine, world, other, [submit] * 3)

    assert codes(responses) == [(201, None), (201, None), (409, "grocery_active_order_limit")]
    assert (order_count(world.session), places(world.session)) == (2, 2)


def test_concurrent_retries_of_one_key_create_exactly_one_order(
    db_engine: Engine, world: AuthEnv
) -> None:
    open_for_orders(world, dailyCapacity=1)
    key = new_key()
    with second_worker(world, db_engine) as other:
        responses = one_customer_at_once(
            db_engine, world, other, [lambda api: submit(api, key=key)] * 5
        )

    assert sorted(r.status_code for r in responses) == [200, 200, 200, 200, 201]
    assert len({r.json()["data"]["id"] for r in responses}) == 1
    assert (order_count(world.session), places(world.session), history_count(world.session)) == (
        1,
        1,
        1,
    )
    assert (
        scalar_count(
            world,
            f"SELECT sum(count) FROM auth_rate_limits WHERE policy = '{GROCERY_SUBMIT_HOUR.name}'",
        )
        == 1
    )


def test_concurrent_different_orders_under_one_key_give_one_order_and_a_conflict(
    db_engine: Engine, world: AuthEnv
) -> None:
    open_for_orders(world)
    key = new_key()
    with second_worker(world, db_engine) as other:
        responses = one_customer_at_once(
            db_engine,
            world,
            other,
            [
                lambda api: submit(api, order_body(instructions="First version"), key),
                lambda api: submit(api, order_body(instructions="Second version"), key),
            ],
        )

    assert codes(responses) == [(201, None), (409, "idempotency_key_reused")]
    assert (order_count(world.session), places(world.session)) == (1, 1)


def test_two_cancellations_at_once_apply_exactly_once(db_engine: Engine, world: AuthEnv) -> None:
    open_for_orders(world)
    first = buyer(world, "canceller")
    order = submitted(first)
    second = browser(world, "canceller@example.org")
    with row_locked(db_engine, "SELECT 1 FROM grocery_orders FOR UPDATE"):
        running = [Running(lambda api=api: cancel(api, order["id"])) for api in (first, second)]  # type: ignore[misc]
        all_waiting(db_engine, "%FROM grocery_orders%FOR UPDATE%", running)
    responses = [request.finish() for request in running]

    assert codes(responses) == [(200, None), (409, "invalid_state_transition")]
    assert (history_count(world.session), places(world.session)) == (2, 1)
    assert scalar_count(world, "SELECT revision FROM grocery_orders") == 2


def test_cancelling_while_submitting_never_leaves_more_than_two_active_orders(
    db_engine: Engine, world: AuthEnv
) -> None:
    open_for_orders(world)
    first = buyer(world, "juggler")
    order = submitted(first)
    submitted(first)
    others = [browser(world, "juggler@example.org") for _ in range(2)]

    running = [Running(lambda: cancel(first, order["id"]))]
    running += [Running(lambda api=api: submit(api)) for api in others]  # type: ignore[misc]
    responses = [request.finish() for request in running]

    assert responses[0].status_code == 200
    won = [r for r in responses[1:] if r.status_code == 201]
    assert len(won) <= 1
    assert all(outcome(r)[0] in (409, 429) for r in responses[1:] if r.status_code != 201)
    active = scalar_count(world, "SELECT count(*) FROM grocery_orders WHERE status = 'submitted'")
    assert active == 1 + len(won) <= 2
    assert places(world.session) == 2 + len(won)


# -- settings changes against submissions ---------------------------------------------------------------


def disable(admin: AuthApi, revision: int) -> Response:
    return admin.request("PATCH", SETTINGS, json={"revision": revision, "enabled": False})


def test_a_settings_change_waits_for_a_submission_already_in_flight(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = open_for_orders(world)
    api = buyer(world, "early")
    gate = gate_method(monkeypatch, GroceryRepository, "lock_settings_shared", after=True)
    submission = Running(lambda: submit(api))
    gate.wait_arrived()  # it holds the settings lock, shared

    change = Running(lambda: disable(admin, 2))
    all_waiting(db_engine, "SELECT pg_advisory_xact_lock(%", [change])
    gate.release.set()

    assert submission.finish().status_code == 201  # accepted under the settings it read
    assert change.finish().status_code == 200
    assert outcome(submit(api)) == (503, "grocery_unavailable")


def test_a_submission_waits_for_a_settings_change_in_flight_and_obeys_it(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = open_for_orders(world)
    api = buyer(world, "late")
    gate = gate_method(monkeypatch, GroceryRepository, "lock_settings_exclusive", after=True)
    change = Running(lambda: disable(admin, 2))
    gate.wait_arrived()  # it holds the settings lock, exclusive, and has not committed

    submission = Running(lambda: submit(api))
    all_waiting(db_engine, "SELECT pg_advisory_xact_lock_shared(%", [submission])
    gate.release.set()

    assert change.finish().status_code == 200
    assert outcome(submission.finish()) == (503, "grocery_unavailable")
    assert (order_count(world.session), places(world.session)) == (0, 0)


def test_two_settings_changes_from_the_same_revision_cannot_both_apply(
    db_engine: Engine, world: AuthEnv
) -> None:
    first = open_for_orders(world)
    second = browser(world, "grocery-admin@example.org")
    with advisory_lock_held(db_engine, ":k", k=SETTINGS_LOCK_KEY):
        running = [
            Running(
                lambda api=api, value=value: api.request(  # type: ignore[misc]
                    "PATCH", SETTINGS, json={"revision": 2, "dailyCapacity": value}
                )
            )
            for api, value in ((first, 20), (second, 30))
        ]
        all_waiting(db_engine, "SELECT pg_advisory_xact_lock(%", running)
    responses = [request.finish() for request in running]

    assert codes(responses) == [(200, None), (409, "conflict")]
    versions = settings_revisions(world.session)
    assert [v.revision for v in versions] == [1, 2, 3]
    assert versions[-1].daily_capacity in (20, 30)


def test_a_super_admin_demoted_during_the_request_changes_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = open_for_orders(world)
    gate = gate_method(monkeypatch, StaffAuthorityRepository, "key_share_user", after=False)
    change = Running(lambda: disable(admin, 2))
    gate.wait_arrived()  # authenticated as Super Admin; has locked nothing yet
    with db_engine.begin() as connection:
        connection.execute(text("DELETE FROM user_roles WHERE role = 'admin'"))
    gate.release.set()

    assert outcome(change.finish()) == (403, "forbidden")
    assert [v.revision for v in settings_revisions(world.session)] == [1, 2]


# -- account suspension and session revocation ------------------------------------------------------------

ACCOUNT_CHANGES = {
    "suspended": ("UPDATE users SET status = 'suspended' WHERE email = :e", 401, "session_expired"),
    "session revoked": (
        "UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'admin_action' "
        "WHERE user_id = (SELECT id FROM users WHERE email = :e)",
        401,
        "session_expired",
    ),
    "email unverified": (
        "UPDATE users SET email_verified_at = NULL WHERE email = :e",
        403,
        "email_not_verified",
    ),
}


@pytest.mark.parametrize("change", list(ACCOUNT_CHANGES))
@pytest.mark.parametrize("action", ["submit", "cancel"])
def test_an_account_change_that_commits_during_the_request_is_obeyed(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    change: str,
    action: str,
) -> None:
    statement, status, code = ACCOUNT_CHANGES[change]
    open_for_orders(world)
    api = buyer(world, "target")
    order = submitted(api) if action == "cancel" else None
    gate = gate_method(monkeypatch, GroceryRepository, "lock_account", after=False)
    request = Running(
        (lambda: cancel(api, order["id"])) if order is not None else (lambda: submit(api))
    )
    gate.wait_arrived()  # already authenticated; the account is not yet re-read
    with db_engine.begin() as connection:
        connection.execute(text(statement), {"e": "target@example.org"})
    gate.release.set()

    assert outcome(request.finish()) == (status, code)
    if order is None:
        assert (order_count(world.session), places(world.session)) == (0, 0)
    else:
        assert history_count(world.session) == 1
        assert scalar_count(world, "SELECT revision FROM grocery_orders") == 1


@pytest.mark.parametrize(
    ("change", "blocked_on"),
    [
        ("suspended", "UPDATE users SET status%"),
        ("session revoked", "UPDATE auth_sessions SET revoked_at%"),
    ],
)
def test_an_account_change_waits_for_a_submission_that_holds_the_account(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    change: str,
    blocked_on: str,
) -> None:
    open_for_orders(world)
    api = buyer(world, "holder")
    gate = gate_method(monkeypatch, GroceryRepository, "lock_account", after=True)
    submission = Running(lambda: submit(api))
    gate.wait_arrived()  # it holds the user and session rows FOR SHARE
    done = threading.Event()

    def apply() -> None:
        with db_engine.begin() as connection:
            connection.execute(text(ACCOUNT_CHANGES[change][0]), {"e": "holder@example.org"})
        done.set()

    thread = threading.Thread(target=apply, daemon=True)
    thread.start()
    wait_until(lambda: waiting(db_engine, blocked_on) == 1, "the account change to wait")
    assert not done.is_set()
    gate.release.set()

    assert submission.finish().status_code == 201
    thread.join(TIMEOUT)
    assert done.is_set()
    assert submit(api).status_code == 401  # and from now on it applies


def test_a_password_change_and_a_submission_cannot_deadlock(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Password change locks the user and then revokes sessions: the same direction a submission
    takes (``users`` before ``auth_sessions``)."""
    open_for_orders(world)
    api = buyer(world, "changer")
    elsewhere = browser(world, "changer@example.org")
    gate = gate_method(monkeypatch, GroceryRepository, "lock_account", after=True)
    submission = Running(lambda: submit(api))
    gate.wait_arrived()

    change = Running(
        lambda: elsewhere.request(
            "POST",
            "/auth/change-password",
            json={"currentPassword": PASSWORD, "newPassword": "another long passphrase 42"},
        )
    )
    wait_until(lambda: waiting(db_engine, "%FROM users%FOR UPDATE%") == 1, "the change to wait")
    gate.release.set()

    assert submission.finish().status_code == 201
    assert change.finish().status_code == 200
    assert order_count(world.session) == 1


def test_orders_stay_listed_after_concurrent_use(world: AuthEnv) -> None:
    open_for_orders(world)
    api = buyer(world, "reader")
    order = submitted(api)

    listed = api.get(ORDERS).json()["data"]

    assert [o["id"] for o in listed] == [order["id"]]
    configure(browser(world, "grocery-admin@example.org"), enabled=False)
    assert api.get(f"{ORDERS}/{order['id']}").status_code == 200
