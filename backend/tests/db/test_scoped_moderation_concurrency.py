"""RBAC-B: the authorisation race between a moderation decision and a revoke / demotion
(``docs/backend/AUTH_RBAC.md §27.4``, §28; lock order in ``app/services/moderation.py``).

The savepoint-isolated tests share one connection, so they cannot show authority holding under
concurrency. These run on SEPARATE committed connections through the real HTTP stack, and every
interleaving is **driven, not raced**: the decision is paused at an exact point with a
``threading.Event`` gate, and "blocked" is observed in PostgreSQL itself (``pg_stat_activity``
``wait_event_type = 'Lock'``), never inferred from a sleep.

What must hold, for a Moderator losing a scope, a Moderator losing the role, and a Super Admin
being demoted:

* revoke COMMITTED after the decision locked the listing but BEFORE it read its authority → the
  decision fails, the listing is unchanged (``test_a_revoke_committed_between...``);
* revoke starts AFTER the decision read AND locked its authority → the revoke WAITS until the
  decision commits, the decision succeeds, and only then does the revoke complete
  (``test_a_decision_that_holds_its_authority...``);
* a role change that follows the ``users -> user_roles`` protocol (as ``AdminRoleService`` does)
  waits at its FIRST lock instead of deadlocking with the decision's history foreign key;
* a role change that holds the ``users`` lock first makes the decision wait, then fail.

The hammered race at the end is only an additional safety net.
"""

from __future__ import annotations

import re
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import DBAPIError

from app.models.enums import PlanCode, StaffScope
from app.repositories.staff import StaffAuthorityRepository
from tests.db.admin_helpers import ADMIN_LISTINGS, pending
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.write_helpers import food_body

TIMEOUT = 30.0

# -- the actors -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Actor:
    """Who decides, the statement that takes their authority away, and what a decision that lost
    the race answers."""

    label: str
    email: str
    account: dict[str, Any]
    #: Revokes the authority the decision rests on (``:e`` = the actor's e-mail).
    revoke: str
    #: ``LIKE`` pattern matching ``revoke`` in ``pg_stat_activity``.
    revoke_like: str
    #: A SQL count that is 0 once the revoke has been applied.
    gone: str
    #: The repository call AFTER which the decision holds ALL the authority it needs.
    holds_after: str
    #: What the decision answers when the revoke won.
    lost_status: int
    #: ``actor_role`` its history row carries when it wins.
    role: str


FOOD = StaffScope.FOOD
_USER = "(SELECT id FROM users WHERE email = :e)"

ACTORS = [
    Actor(
        "moderator-scope-removed",
        "mod-scope@example.org",
        {"professional": None, "moderator_scopes": [FOOD]},
        f"DELETE FROM staff_scope_assignments WHERE user_id = {_USER}",
        "DELETE FROM staff_scope_assignments%",
        f"SELECT count(*) FROM staff_scope_assignments WHERE user_id = {_USER}",
        "share_moderator_scope",
        404,  # still a Moderator, but no longer holds the listing's scope: same as "not found"
        "moderator",
    ),
    Actor(
        "moderator-role-removed",
        "mod-role@example.org",
        {"professional": None, "moderator_scopes": [FOOD]},
        f"DELETE FROM user_roles WHERE role = 'moderator' AND user_id = {_USER}",
        "DELETE FROM user_roles%",
        f"SELECT count(*) FROM user_roles WHERE role = 'moderator' AND user_id = {_USER}",
        "share_moderator_scope",
        403,  # no staff role at all any more
        "moderator",
    ),
    Actor(
        "super-admin-demoted",
        "sa@example.org",
        {"professional": None, "admin": True},
        f"DELETE FROM user_roles WHERE role = 'admin' AND user_id = {_USER}",
        "DELETE FROM user_roles%",
        f"SELECT count(*) FROM user_roles WHERE role = 'admin' AND user_id = {_USER}",
        "share_staff_roles",
        403,
        "admin",
    ),
]
IDS = [actor.label for actor in ACTORS]


# -- deterministic control ------------------------------------------------------------------------


class Gate:
    """A pause the code under test announces (``arrived``) and then waits to be ``release``d at."""

    def __init__(self) -> None:
        self.arrived = threading.Event()
        self.release = threading.Event()

    def pause(self) -> None:
        self.arrived.set()
        assert self.release.wait(TIMEOUT), "the gate was never released"

    def wait_arrived(self) -> None:
        assert self.arrived.wait(TIMEOUT), "the decision never reached the gate"


def gate_at(monkeypatch: pytest.MonkeyPatch, method: str, *, after: bool) -> Gate:
    """Pause the next ``StaffAuthorityRepository.<method>`` call — BEFORE it runs (``after=False``:
    the decision holds the listing but has read no authority) or right AFTER it returned (it holds
    the locks that call took). Only the moderation decision calls these methods."""
    gate = Gate()
    original = getattr(StaffAuthorityRepository, method)

    def wrapper(self: StaffAuthorityRepository, *args: Any, **kwargs: Any) -> Any:
        if not after:
            gate.pause()
        result = original(self, *args, **kwargs)
        if after:
            gate.pause()
        return result

    monkeypatch.setattr(StaffAuthorityRepository, method, wrapper)
    return gate


class Decision:
    """``POST .../approve`` on its own thread."""

    def __init__(self, api: AuthApi, listing_id: str) -> None:
        self.response: Response | None = None
        self.thread = threading.Thread(target=self._run, args=(api, listing_id), daemon=True)
        self.thread.start()

    def _run(self, api: AuthApi, listing_id: str) -> None:
        self.response = api.request(
            "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}
        )

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def finish(self) -> Response:
        self.thread.join(TIMEOUT)
        assert not self.thread.is_alive(), "the decision never finished (deadlock?)"
        assert self.response is not None
        return self.response


class Revoker:
    """Statements run in ONE transaction on their own connection and thread."""

    def __init__(self, engine: Engine, statements: list[str], email: str) -> None:
        self.done = threading.Event()
        self.error: BaseException | None = None
        self.thread = threading.Thread(
            target=self._run, args=(engine, statements, email), daemon=True
        )
        self.thread.start()

    def _run(self, engine: Engine, statements: list[str], email: str) -> None:
        try:
            with engine.begin() as connection:
                connection.execute(text("SET LOCAL statement_timeout = '30s'"))
                for statement in statements:
                    connection.execute(text(statement), {"e": email})
        except BaseException as error:
            self.error = error
        finally:
            self.done.set()

    def finish(self) -> None:
        self.thread.join(TIMEOUT)
        assert not self.thread.is_alive(), "the revoke never finished (deadlock?)"
        assert self.error is None, repr(self.error)


def wait_until(condition: Callable[[], bool], what: str) -> None:
    """Poll an OBSERVABLE condition (never a duration) until it holds, with a hard deadline."""
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.02)
    pytest.fail(f"timed out waiting for {what}")


def waiting_on_a_lock(engine: Engine, like: str) -> bool:
    """Is some backend, right now, blocked on a lock while running a statement matching ``like``?"""
    with engine.connect() as connection:
        count = connection.execute(
            text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND wait_event_type = 'Lock' AND query LIKE :p"
            ),
            {"p": like},
        ).scalar_one()
    return int(count) >= 1


def listing_is_locked(engine: Engine, listing_id: str) -> bool:
    """Does another transaction hold the listing row lock right now? (``FOR UPDATE NOWAIT``.)"""
    with engine.connect() as connection:
        try:
            connection.execute(
                text("SELECT 1 FROM listings WHERE id = :i FOR UPDATE NOWAIT"),
                {"i": uuid.UUID(listing_id)},
            )
        except DBAPIError as error:
            return getattr(error.orig, "sqlstate", None) == "55P03"  # lock_not_available
        finally:
            connection.rollback()
    return False


# -- the world ------------------------------------------------------------------------------------


def _sign_in(env: AuthEnv, email: str, **account: Any) -> AuthApi:
    make_account(env.session, email, **account)
    api = env.client()
    assert api.login(email).status_code == 200
    return api


def world(env: AuthEnv, actor: Actor) -> tuple[AuthApi, str]:
    """The actor, signed in, and a pending Food listing that a third party owns."""
    owner = _sign_in(env, "owner-c@example.org", professional=PlanCode.FREE)
    listing_id = pending(owner, food_body(name="Race Food"))
    return _sign_in(env, actor.email, **actor.account), listing_id


def scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as connection:
        return connection.execute(text(sql), params).scalar_one()


def status_of(engine: Engine, listing_id: str) -> str:
    return str(scalar(engine, "SELECT status FROM listings WHERE id = :i", i=uuid.UUID(listing_id)))


def history_rows(engine: Engine, listing_id: str) -> int:
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM listing_status_history WHERE listing_id = :i",
            i=uuid.UUID(listing_id),
        )
    )


def audit_rows(engine: Engine) -> int:
    return int(scalar(engine, "SELECT count(*) FROM staff_audit_events"))


def commit_now(engine: Engine, statement: str, email: str) -> None:
    """A revoke that COMMITS, failing fast (not hanging) if it ever has to wait."""
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        connection.execute(text(statement), {"e": email})


# -- interleaving 1: the revoke commits between the listing lock and the authority read ----------


@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_revoke_committed_between_the_listing_lock_and_the_authority_read_fails_the_decision(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, actor: Actor
) -> None:
    """1. the decision locks the listing; 2. it is paused BEFORE it reads or locks any authority;
    3. the revoke runs and COMMITS; 4. the decision resumes → it must fail, listing untouched."""
    with committed_world(db_engine) as env:
        api, listing_id = world(env, actor)
        history_before = history_rows(db_engine, listing_id)
        gate = gate_at(monkeypatch, "key_share_user", after=False)

        decision = Decision(api, listing_id)
        gate.wait_arrived()
        assert listing_is_locked(db_engine, listing_id), (
            "the decision must already hold the listing"
        )

        commit_now(db_engine, actor.revoke, actor.email)  # nothing of the actor is locked yet
        assert scalar(db_engine, actor.gone, e=actor.email) == 0
        gate.release.set()

        response = decision.finish()
        assert response.status_code == actor.lost_status, response.text
        assert status_of(db_engine, listing_id) == "pending"
        assert history_rows(db_engine, listing_id) == history_before
        assert audit_rows(db_engine) == 0


# -- interleaving 2: the decision holds its authority; the revoke must wait -----------------------


@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_decision_that_holds_its_authority_makes_the_revoke_wait_until_it_commits(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, actor: Actor
) -> None:
    """1. the decision locks the listing, reads AND locks its authority; 2. it is paused; 3. the
    revoke starts and is observed BLOCKED in PostgreSQL; 4. the decision commits; 5. only then does
    the revoke complete."""
    with committed_world(db_engine) as env:
        api, listing_id = world(env, actor)
        gate = gate_at(monkeypatch, actor.holds_after, after=True)

        decision = Decision(api, listing_id)
        gate.wait_arrived()
        revoker = Revoker(db_engine, [actor.revoke], actor.email)

        wait_until(lambda: waiting_on_a_lock(db_engine, actor.revoke_like), "the revoke to block")
        assert not revoker.done.is_set(), "the revoke must wait, not complete"
        assert scalar(db_engine, actor.gone, e=actor.email) == 1  # nothing was revoked yet
        assert decision.running and status_of(db_engine, listing_id) == "pending"

        gate.release.set()
        response = decision.finish()
        assert response.status_code == 200, response.text  # the decision linearised first
        revoker.finish()  # ...and only now could the revoke complete

        assert status_of(db_engine, listing_id) == "approved"
        assert scalar(db_engine, actor.gone, e=actor.email) == 0  # the revoke did apply, afterwards
        role = scalar(
            db_engine,
            "SELECT actor_role FROM listing_status_history "
            "WHERE listing_id = :i AND action = 'approved'",
            i=uuid.UUID(listing_id),
        )
        assert role == actor.role


# -- interleaving 3 & 4: a role change that locks the users row first (the AdminRoleService way) -


USERS_FIRST = "SELECT id FROM users WHERE email = :e FOR UPDATE"
USERS_FIRST_LIKE = "SELECT id FROM users WHERE email%FOR UPDATE"
KEY_SHARE_LIKE = "%FOR KEY SHARE%"


@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_role_change_that_locks_users_first_waits_instead_of_deadlocking(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, actor: Actor
) -> None:
    """The decision holds users (KEY SHARE) → user_roles → scope. A role change that does
    ``users FOR UPDATE`` → ``DELETE`` must wait at its FIRST statement. Had the decision taken the
    users lock late (at its history row's foreign key), the change would hold ``users`` and wait for
    ``user_roles`` while the decision waited for ``users`` — a deadlock PostgreSQL would break by
    killing one of them. Here nothing is killed."""
    with committed_world(db_engine) as env:
        api, listing_id = world(env, actor)
        gate = gate_at(monkeypatch, actor.holds_after, after=True)

        decision = Decision(api, listing_id)
        gate.wait_arrived()
        revoker = Revoker(db_engine, [USERS_FIRST, actor.revoke], actor.email)

        wait_until(lambda: waiting_on_a_lock(db_engine, USERS_FIRST_LIKE), "the change to wait")
        assert not revoker.done.is_set()

        gate.release.set()
        response = decision.finish()
        assert response.status_code == 200, response.text  # not a 500 from a deadlock victim
        revoker.finish()  # not a deadlock_detected error either
        assert status_of(db_engine, listing_id) == "approved"
        assert scalar(db_engine, actor.gone, e=actor.email) == 0


@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_decision_arriving_while_a_role_change_holds_users_waits_and_then_fails(
    db_engine: Engine, actor: Actor
) -> None:
    """The role change (``users FOR UPDATE`` → ``DELETE``, not yet committed) is first. The decision
    must wait for it — holding only the listing, no authority row — and then see the revoke."""
    with committed_world(db_engine) as env:
        api, listing_id = world(env, actor)
        history_before = history_rows(db_engine, listing_id)

        with db_engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text(USERS_FIRST), {"e": actor.email})
            connection.execute(text(actor.revoke), {"e": actor.email})  # held, uncommitted

            decision = Decision(api, listing_id)
            wait_until(lambda: waiting_on_a_lock(db_engine, KEY_SHARE_LIKE), "the decision to wait")
            assert decision.running
            assert status_of(db_engine, listing_id) == "pending"

            transaction.commit()

        response = decision.finish()
        assert response.status_code == actor.lost_status, response.text
        assert status_of(db_engine, listing_id) == "pending"
        assert history_rows(db_engine, listing_id) == history_before
        assert audit_rows(db_engine) == 0


# -- the documented lock order is the actual one --------------------------------------------------

LOCK = re.compile(r"FROM (\w+).*?FOR (KEY SHARE|NO KEY UPDATE|SHARE|UPDATE)", re.DOTALL)


@contextmanager
def recorded_locks(engine: Engine) -> Iterator[list[tuple[str, str]]]:
    """Every locking SELECT the engine runs, as ``(first table, lock mode)``, in order."""
    seen: list[tuple[str, str]] = []

    def record(
        connection: Any, cursor: Any, statement: str, parameters: Any, context: Any, many: bool
    ) -> None:
        match = LOCK.search(statement)
        if match is not None and statement.lstrip().upper().startswith("SELECT"):
            seen.append((match.group(1), match.group(2)))

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


@pytest.mark.parametrize("actor", [ACTORS[0], ACTORS[2]], ids=["moderator", "super-admin"])
def test_the_decision_takes_its_locks_in_the_documented_order(
    db_engine: Engine, actor: Actor
) -> None:
    """``listings`` → ``users`` → ``user_roles`` → ``staff_scope_assignments`` (a Super Admin has no
    scope row). A staff mutation must walk ``users → user_roles → scopes`` the same way and never
    lock a listing; this pins the decision's half of that contract."""
    with committed_world(db_engine) as env:
        api, listing_id = world(env, actor)
        with recorded_locks(db_engine) as seen:
            assert (
                api.request(
                    "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}
                ).status_code
                == 200
            )

    start = seen.index(("listings", "UPDATE"))
    order = seen[start:]
    expected = [
        ("listings", "UPDATE"),
        ("users", "KEY SHARE"),
        ("user_roles", "SHARE"),
        ("staff_scope_assignments", "SHARE"),
    ]
    assert order == (expected if actor.role == "moderator" else expected[:3])


# -- an additional safety net: a hammered race ----------------------------------------------------


def hammer_round(engine: Engine, env: AuthEnv, index: int, statements: list[str]) -> None:
    """One decision racing one revoke, released together. Whatever the order, both finish, and the
    listing agrees with the answer."""
    owner = _sign_in(env, f"hammer-owner-{index}@example.org", professional=PlanCode.FREE)
    listing_id = pending(owner, food_body(name=f"Hammer Food {index}"))
    email = f"hammer-mod-{index}@example.org"
    api = _sign_in(env, email, professional=None, moderator_scopes=[FOOD])
    barrier = threading.Barrier(2)
    outcome: dict[str, Response] = {}

    def decide() -> None:
        barrier.wait()
        outcome["decision"] = api.request(
            "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}
        )

    def revoke() -> None:
        barrier.wait()
        Revoker(engine, statements, email).finish()

    threads = [threading.Thread(target=decide), threading.Thread(target=revoke)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(TIMEOUT)
        assert not thread.is_alive(), "the race deadlocked"

    code = outcome["decision"].status_code
    assert code in (200, 403, 404), outcome["decision"].text  # never a 500
    assert status_of(engine, listing_id) == ("approved" if code == 200 else "pending")
    assert scalar(engine, ACTORS[0].gone, e=email) == 0  # the revoke always completed


@pytest.mark.parametrize("users_first", [False, True], ids=["direct-delete", "users-first"])
def test_a_hammered_decision_and_revoke_never_deadlock_and_always_agree(
    db_engine: Engine, users_first: bool
) -> None:
    statements = [USERS_FIRST, ACTORS[0].revoke] if users_first else [ACTORS[0].revoke]
    with committed_world(db_engine) as env:
        for index in range(10):
            hammer_round(db_engine, env, index, statements)
