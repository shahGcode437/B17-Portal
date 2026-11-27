"""RBAC-D: the portal's request handling under real concurrency (docs/backend/AUTH_RBAC.md §31;
lock order in ``app/services/portal_requests.py``).

Separate PostgreSQL connections over COMMITTED rows, through the real HTTP stack. Every interleaving
is driven, not raced: the action is paused at an exact point with a ``threading.Event`` gate and
"blocked" is observed in PostgreSQL itself (``pg_stat_activity``), never inferred from a sleep — the
same harness as the RBAC-B moderation and the Provider authoring race tests.

For a Moderator losing the ``services`` scope, a Moderator losing the role and a Super Admin being
demoted, and for the actions that move a request (accept, cancel):

* the revoke COMMITTED after the action locked the request row but BEFORE it read its authority →
  the action fails (``404`` for a lost scope — the id is concealed — ``403`` for a lost role) and the
  request is untouched;
* the action read AND locked its authority first → the revoke WAITS until the action commits, the
  action succeeds (and its history row records the authority it really held), and only then does the
  revoke complete;
* a role change that follows the staff-management protocol (``users FOR UPDATE`` first) waits at its
  first statement instead of deadlocking with the action, and an action arriving behind one waits
  and then fails.

Then the lock-order properties of the feature itself: two staff acting on one request serialise (one
``409``), an action and a staff removal, a Provider edit, a moderation takedown and a new request can
meet without a deadlock.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app.models.enums import StaffScope
from tests.db.admin_helpers import ADMIN_LISTINGS
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.request_helpers import PORTAL_REQUESTS, REQUESTS, request_body
from tests.db.staff_helpers import MODERATORS, purge_staff_audit, super_admin
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_provider_authoring_concurrency import (
    ACTORS,
    IDS,
    Actor,
    gate_first_call,
)
from tests.db.test_scoped_moderation_concurrency import (
    ACTOR_LOCK_LIKE,
    TIMEOUT,
    USERS_FIRST,
    USERS_FIRST_LIKE,
    Revoker,
    commit_now,
    gate_at,
    scalar,
    wait_until,
    waiting_on_a_lock,
)
from tests.db.test_scoped_moderation_concurrency import _sign_in as sign_in_account
from tests.db.write_helpers import PROVIDERS, staff_provider_body

SERVICES = StaffScope.SERVICES
ACTIONS = ["accept", "cancel"]
#: A statement that waits for a ``service_requests`` row lock, as ``pg_stat_activity`` shows it (the
#: tail ``FOR UPDATE OF service_requests`` is truncated away: match the head).
REQUEST_LOCK_LIKE = "SELECT service_requests.%"


@pytest.fixture
def world_env(db_engine: Engine) -> Iterator[AuthEnv]:
    """A committed world; the append-only staff audit (written by authoring a Provider) is cleared
    in teardown because it has no foreign key."""
    with purge_staff_audit(db_engine), committed_world(db_engine) as env:
        yield env


class Handle:
    """One portal action (``accept`` / ``cancel`` / …) on its own thread."""

    def __init__(self, api: AuthApi, request_id: str, action: str) -> None:
        self.response: Response | None = None
        self._thread = threading.Thread(
            target=self._run, args=(api, request_id, action), daemon=True
        )
        self._thread.start()

    def _run(self, api: AuthApi, request_id: str, action: str) -> None:
        self.response = api.request("POST", f"{PORTAL_REQUESTS}/{request_id}/{action}")

    @property
    def running(self) -> bool:
        return self._thread.is_alive()

    def finish(self) -> Response:
        self._thread.join(TIMEOUT)
        assert not self._thread.is_alive(), "the action never finished (deadlock?)"
        assert self.response is not None
        return self.response


def request_is_locked(engine: Engine, request_id: str) -> bool:
    """Does another transaction hold the request row lock right now? (``FOR UPDATE NOWAIT``.)"""
    with engine.connect() as connection:
        try:
            connection.execute(
                text("SELECT 1 FROM service_requests WHERE id = :i FOR UPDATE NOWAIT"),
                {"i": uuid.UUID(request_id)},
            )
        except DBAPIError as error:
            return getattr(error.orig, "sqlstate", None) == "55P03"  # lock_not_available
        finally:
            connection.rollback()
    return False


def request_state(engine: Engine, request_id: str) -> tuple[str, int]:
    """``(status, number of history rows)`` of the request, from the stored truth."""
    with engine.connect() as connection:
        status = connection.execute(
            text("SELECT status FROM service_requests WHERE id = :i"), {"i": uuid.UUID(request_id)}
        ).scalar_one()
        history = connection.execute(
            text("SELECT count(*) FROM service_request_status_history WHERE request_id = :i"),
            {"i": uuid.UUID(request_id)},
        ).scalar_one()
    return str(status), int(history)


def world(env: AuthEnv, actor: Actor) -> tuple[AuthApi, str]:
    """The actor, signed in; a Provider authored by a Super Admin; one submitted request to it."""
    api = sign_in_account(env, actor.email, **actor.account)
    author = sign_in_account(env, "author-root@example.org", professional=None, admin=True)
    created = author.request("POST", PROVIDERS, json=staff_provider_body())
    assert created.status_code == 201, created.text
    listing_id = str(created.json()["data"]["id"])
    engine: Engine = env.session.get_bind().engine
    with engine.begin() as connection:  # approve directly: moderation has its own suites
        connection.execute(
            text("UPDATE listings SET status = 'approved' WHERE id = :i"),
            {"i": uuid.UUID(listing_id)},
        )
    resident = sign_in_account(env, "resident-race@example.org", professional=None)
    made = resident.request("POST", REQUESTS, json=request_body(listing_id))
    assert made.status_code == 201, made.text
    return api, str(made.json()["data"]["id"])


# =================================================================================================
# Interleaving 1: the revoke commits after the request lock, before the authority read
# =================================================================================================


@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_revoke_committed_before_the_authority_read_fails_the_action(
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    world_env: AuthEnv,
    actor: Actor,
    action: str,
) -> None:
    """1. the action locks the request row; 2. it is paused BEFORE it reads or locks any authority;
    3. the revoke runs and COMMITS; 4. the action resumes → it must fail and change nothing."""
    api, request_id = world(world_env, actor)
    before = request_state(db_engine, request_id)
    gate = gate_at(monkeypatch, "share_user", after=False)

    handle = Handle(api, request_id, action)
    gate.wait_arrived()
    assert request_is_locked(db_engine, request_id), "the action must already hold the request"

    commit_now(db_engine, actor.revoke, actor.email)  # nothing of the actor is locked yet
    assert scalar(db_engine, actor.gone, e=actor.email) == 0
    gate.release.set()

    response = handle.finish()
    assert response.status_code == actor.lost_existing, response.text
    assert request_state(db_engine, request_id) == before  # the request is untouched


# =================================================================================================
# Interleaving 2: the action holds its authority; the revoke must wait
# =================================================================================================


@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_an_action_that_holds_its_authority_makes_the_revoke_wait_until_it_commits(
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    world_env: AuthEnv,
    actor: Actor,
    action: str,
) -> None:
    """1. the action locks the request, reads AND locks its authority; 2. it is paused; 3. the
    revoke starts and is observed BLOCKED in PostgreSQL; 4. the action commits; 5. only then does the
    revoke complete."""
    api, request_id = world(world_env, actor)
    before = request_state(db_engine, request_id)
    gate = gate_at(monkeypatch, actor.holds_after, after=True)

    handle = Handle(api, request_id, action)
    gate.wait_arrived()
    revoker = Revoker(db_engine, [actor.revoke], actor.email)

    wait_until(lambda: waiting_on_a_lock(db_engine, actor.revoke_like), "the revoke to block")
    assert not revoker.done.is_set(), "the revoke must wait, not complete"
    assert scalar(db_engine, actor.gone, e=actor.email) == 1  # nothing was revoked yet
    assert handle.running and request_state(db_engine, request_id) == before

    gate.release.set()
    response = handle.finish()
    assert response.status_code == 200, response.text  # the action linearised first
    revoker.finish()  # ...and only now could the revoke complete

    assert scalar(db_engine, actor.gone, e=actor.email) == 0  # the revoke applied, afterwards
    status, history = request_state(db_engine, request_id)
    assert (status, history) == ("accepted" if action == "accept" else "cancelled", before[1] + 1)
    last = scalar(
        db_engine,
        "SELECT actor_role FROM service_request_status_history WHERE request_id = :i "
        "ORDER BY created_at DESC, id LIMIT 1",
        i=uuid.UUID(request_id),
    )
    assert last == "provider"  # the staff capacity; the actor id is the staff member's own
    actor_id = scalar(
        db_engine,
        "SELECT actor_user_id FROM service_request_status_history WHERE request_id = :i "
        "ORDER BY created_at DESC, id LIMIT 1",
        i=uuid.UUID(request_id),
    )
    assert actor_id == scalar(db_engine, "SELECT id FROM users WHERE email = :e", e=actor.email)


# =================================================================================================
# Interleavings 3 & 4: a role change that locks the users row first (the RBAC-C protocol)
# =================================================================================================


@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_role_change_that_locks_users_first_waits_instead_of_deadlocking(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv, actor: Actor
) -> None:
    api, request_id = world(world_env, actor)
    gate = gate_at(monkeypatch, actor.holds_after, after=True)

    handle = Handle(api, request_id, "accept")
    gate.wait_arrived()
    revoker = Revoker(db_engine, [USERS_FIRST, actor.revoke], actor.email)

    wait_until(lambda: waiting_on_a_lock(db_engine, USERS_FIRST_LIKE), "the change to wait")
    assert not revoker.done.is_set()

    gate.release.set()
    response = handle.finish()
    assert response.status_code == 200, response.text  # not a deadlock victim
    revoker.finish()
    assert scalar(db_engine, actor.gone, e=actor.email) == 0


@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_an_action_arriving_while_a_role_change_holds_users_waits_and_then_fails(
    db_engine: Engine, world_env: AuthEnv, actor: Actor
) -> None:
    api, request_id = world(world_env, actor)
    before = request_state(db_engine, request_id)

    with db_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(text(USERS_FIRST), {"e": actor.email})
        connection.execute(text(actor.revoke), {"e": actor.email})  # held, uncommitted

        handle = Handle(api, request_id, "accept")
        wait_until(lambda: waiting_on_a_lock(db_engine, ACTOR_LOCK_LIKE), "the action to wait")
        assert handle.running and request_state(db_engine, request_id) == before

        transaction.commit()

    response = handle.finish()
    assert response.status_code == actor.lost_existing, response.text
    assert request_state(db_engine, request_id) == before


# =================================================================================================
# Lock order against the other writers that touch the same rows
# =================================================================================================


def test_two_staff_acting_on_one_request_serialise_and_the_second_is_a_conflict(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    first = sign_in_account(
        world_env, "mod-one@example.org", professional=None, moderator_scopes=[SERVICES]
    )
    api, request_id = world(
        world_env,
        Actor(
            "x",
            "mod-two@example.org",
            {"professional": None, "moderator_scopes": [SERVICES]},
            "",
            "",
            "",
            "share_moderator_scope",
            404,
            "moderator",
        ),
    )
    gate = gate_first_call(monkeypatch, "share_moderator_scope")

    one = Handle(first, request_id, "accept")
    gate.wait_arrived()  # the first holds the request row and its authority
    two = Handle(api, request_id, "accept")
    wait_until(lambda: waiting_on_a_lock(db_engine, REQUEST_LOCK_LIKE), "the second action to wait")
    assert two.running

    gate.release.set()
    results = sorted([one.finish().status_code, two.finish().status_code])
    assert results == [200, 409]  # one wins from ``submitted``; the other reads ``accepted``
    assert request_state(db_engine, request_id) == ("accepted", 2)  # an unbroken, single chain


def test_an_action_and_a_staff_removal_meet_without_a_deadlock(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """The removal takes the staff-authority advisory lock, then ``users FOR UPDATE``, and never a
    request. An action paused while holding the moderator's authority makes it wait; the action
    commits, then the removal completes — and the request survives, manageable by anyone else."""
    boss = super_admin(world_env)
    actor = ACTORS[0]
    api, request_id = world(world_env, actor)
    moderator_id = scalar(db_engine, "SELECT id FROM users WHERE email = :e", e=actor.email)
    gate = gate_at(monkeypatch, "share_moderator_scope", after=True)

    handle = Handle(api, request_id, "accept")
    gate.wait_arrived()
    removed: dict[str, Response] = {}
    remover = threading.Thread(
        target=lambda: removed.setdefault(
            "r", boss.request("DELETE", f"{MODERATORS}/{moderator_id}")
        ),
        daemon=True,
    )
    remover.start()

    wait_until(lambda: waiting_on_a_lock(db_engine, "%FOR UPDATE%"), "the removal to wait")
    assert remover.is_alive() and handle.running
    assert request_state(db_engine, request_id) == ("submitted", 1)

    gate.release.set()
    response = handle.finish()
    remover.join(TIMEOUT)
    assert not remover.is_alive(), "the removal never finished (deadlock?)"
    assert response.status_code == 200, response.text
    assert removed["r"].status_code == 204, removed["r"].text
    assert request_state(db_engine, request_id) == ("accepted", 2)
    follow_up = boss.request("POST", f"{PORTAL_REQUESTS}/{request_id}/start")
    assert follow_up.status_code == 200, follow_up.text  # nothing depended on the removed person


def test_portal_actions_requests_provider_edits_and_moderation_never_deadlock(
    db_engine: Engine, world_env: AuthEnv
) -> None:
    """One request row, one Provider row and the authority rows are touched by five different
    writers released together: none of them may wait for another in a cycle."""
    actor = ACTORS[0]
    api, request_id = world(world_env, actor)
    boss = sign_in_account(world_env, "boss-mix@example.org", professional=None, admin=True)
    resident = sign_in_account(world_env, "resident-mix@example.org", professional=None)
    listing_id = scalar(
        db_engine,
        "SELECT provider_listing_id FROM service_requests WHERE id = :i",
        i=uuid.UUID(request_id),
    )

    def run(index: int) -> Response:
        if index == 0:
            return api.request("POST", f"{PORTAL_REQUESTS}/{request_id}/accept")
        if index == 1:
            return boss.request("POST", f"{PORTAL_REQUESTS}/{request_id}/cancel")
        if index == 2:
            return boss.request(
                "PATCH",
                f"{PROVIDERS}/{listing_id}",
                json={"revision": 1, "name": "Renamed In The Race"},
            )
        if index == 3:
            return boss.request(
                "POST",
                f"{ADMIN_LISTINGS}/{listing_id}/reject",
                json={"revision": 1, "reason": "A plausible reason to reject."},
            )
        return resident.request("POST", REQUESTS, json=request_body(str(listing_id)))

    barrier = threading.Barrier(5)
    results: list[Any] = [None] * 5

    def runner(index: int) -> None:
        barrier.wait()
        try:
            results[index] = run(index)
        except Exception as error:  # noqa: BLE001 - a thread must report, not crash silently
            results[index] = error

    threads = [threading.Thread(target=runner, args=(i,), daemon=True) for i in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(TIMEOUT)
        assert not thread.is_alive(), "a writer never finished (deadlock?)"

    for result in results:
        assert not isinstance(result, Exception), result
        assert result.status_code < 500, result.text
    status, _ = request_state(db_engine, request_id)
    assert status in ("accepted", "cancelled")
