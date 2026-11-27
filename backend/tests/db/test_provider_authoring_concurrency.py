"""RBAC-D: staff Provider authoring under real concurrency (docs/backend/AUTH_RBAC.md §31; lock order
in ``app/services/provider_authoring.py``).

Separate PostgreSQL connections over COMMITTED rows, through the real HTTP stack. Every interleaving
is **driven, not raced**: the write is paused at an exact point with a ``threading.Event`` gate and
"blocked" is observed in PostgreSQL itself (``pg_stat_activity`` ``wait_event_type = 'Lock'``),
never inferred from a sleep — the same harness as the RBAC-B moderation race tests.

What must hold, for a Moderator losing the ``services`` scope, a Moderator losing the role and a
Super Admin being demoted, and for CREATE, EDIT and ARCHIVE alike:

* the revoke COMMITTED before the write read its authority → the write fails and changes nothing
  (create ``403``; edit / archive ``404`` for a lost scope — the id is concealed — and ``403`` for a
  lost role);
* the write read AND locked its authority first → the revoke WAITS until the write commits, the write
  succeeds, and only then does the revoke complete;
* a role change that follows the staff-management protocol (``users FOR UPDATE`` first) waits at its
  first statement instead of deadlocking with the write.

Then the lock-order properties of the feature itself: an authoring write and an RBAC-B decision, an
RBAC-C removal, a taxonomy change and another authoring write can all meet without a deadlock, and
ordinary Provider authoring takes NO global lock.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import Engine, text

from app.models.enums import PlanCode, StaffScope
from app.repositories.staff import STAFF_AUTHORITY_LOCK_KEY, StaffAuthorityRepository
from app.repositories.taxonomy import TAXONOMY_LOCK_KEY
from tests.db.admin_helpers import ADMIN_LISTINGS
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.staff_helpers import MODERATORS, purge_staff_audit, super_admin
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import (
    ACTOR_LOCK_LIKE,
    TIMEOUT,
    USERS_FIRST,
    USERS_FIRST_LIKE,
    Gate,
    Revoker,
    commit_now,
    gate_at,
    listing_is_locked,
    scalar,
    wait_until,
    waiting_on_a_lock,
)
from tests.db.test_scoped_moderation_concurrency import _sign_in as sign_in_account
from tests.db.write_helpers import (
    PROVIDERS,
    staff_provider_body,
)

SERVICES = StaffScope.SERVICES
_USER = "(SELECT id FROM users WHERE email = :e)"
#: The Provider / listing row lock, as ``pg_stat_activity`` shows it. The statement lists many columns,
#: so ``track_activity_query_size`` truncates its tail (``FOR UPDATE OF listings``): match its head
#: (the computed public-address columns come first). Only the waiting writer is ever "in Lock" here.
LISTING_LOCK_LIKE = "SELECT CASE WHEN (listings.location_visibility%"
ADVISORY_SHARED_LIKE = "%pg_advisory_xact_lock_shared%"
ADVISORY_EXCLUSIVE_LIKE = "SELECT pg_advisory_xact_lock(%"


@pytest.fixture
def world_env(db_engine: Engine) -> Iterator[AuthEnv]:
    """A committed world; the append-only staff audit is cleared in teardown (it has no foreign
    keys, so ``TRUNCATE users CASCADE`` does not reach it)."""
    with purge_staff_audit(db_engine), committed_world(db_engine) as env:
        yield env


# -- the actors whose authority can be taken away -------------------------------------------------


@dataclass(frozen=True)
class Actor:
    label: str
    email: str
    account: dict[str, Any]
    revoke: str
    revoke_like: str
    gone: str
    #: The ``StaffAuthorityRepository`` call AFTER which the write holds ALL the authority it needs.
    holds_after: str
    #: What an EDIT / ARCHIVE of an existing id answers when the revoke won (create is always 403).
    lost_existing: int
    role: str


ACTORS = [
    Actor(
        "moderator-scope-removed",
        "mod-scope@example.org",
        {"professional": None, "moderator_scopes": [SERVICES]},
        f"DELETE FROM staff_scope_assignments WHERE user_id = {_USER}",
        "DELETE FROM staff_scope_assignments%",
        f"SELECT count(*) FROM staff_scope_assignments WHERE user_id = {_USER}",
        "share_moderator_scope",
        404,  # still a Moderator, but no longer holds ``services``: concealed like a missing id
        "moderator",
    ),
    Actor(
        "moderator-role-removed",
        "mod-role@example.org",
        {"professional": None, "moderator_scopes": [SERVICES]},
        f"DELETE FROM user_roles WHERE role = 'moderator' AND user_id = {_USER}",
        "DELETE FROM user_roles%",
        f"SELECT count(*) FROM user_roles WHERE role = 'moderator' AND user_id = {_USER}",
        "share_moderator_scope",
        403,
        "moderator",
    ),
    Actor(
        "super-admin-demoted",
        "sa-prov@example.org",
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
OPERATIONS = ["create", "edit", "archive"]


def gate_first_call(monkeypatch: pytest.MonkeyPatch, method: str) -> Gate:
    """Pause ONLY the first call of ``StaffAuthorityRepository.<method>`` (right after it returned,
    so that caller holds the locks it took); every later call passes straight through. That lets a
    test hold one write open while a second one runs to completion."""
    gate = Gate()
    original = getattr(StaffAuthorityRepository, method)
    guard = threading.Lock()
    seen = {"first": True}

    def wrapper(self: StaffAuthorityRepository, *args: Any, **kwargs: Any) -> Any:
        with guard:
            first, seen["first"] = seen["first"], False
        result = original(self, *args, **kwargs)
        if first:
            gate.pause()
        return result

    monkeypatch.setattr(StaffAuthorityRepository, method, wrapper)
    return gate


# -- the write under test, on its own thread ------------------------------------------------------


class Write:
    """One staff Provider write (``create`` / ``edit`` / ``archive``) on its own thread."""

    def __init__(self, api: AuthApi, operation: str, listing_id: str | None = None) -> None:
        self.response: Response | None = None
        self._thread = threading.Thread(
            target=self._run, args=(api, operation, listing_id), daemon=True
        )
        self._thread.start()

    def _run(self, api: AuthApi, operation: str, listing_id: str | None) -> None:
        if operation == "create":
            self.response = api.request("POST", PROVIDERS, json=staff_provider_body())
        elif operation == "edit":
            self.response = api.request(
                "PATCH",
                f"{PROVIDERS}/{listing_id}",
                json={"revision": 1, "name": "Race Edited Name"},
            )
        else:
            self.response = api.request(
                "POST", f"{PROVIDERS}/{listing_id}/archive", json={"revision": 1}
            )

    @property
    def running(self) -> bool:
        return self._thread.is_alive()

    def finish(self) -> Response:
        self._thread.join(TIMEOUT)
        assert not self._thread.is_alive(), "the write never finished (deadlock?)"
        assert self.response is not None
        return self.response


def ok_status(operation: str) -> int:
    return 201 if operation == "create" else 200


def provider_count(engine: Engine) -> int:
    return int(scalar(engine, "SELECT count(*) FROM listings WHERE kind = 'provider'"))


def audit_rows(engine: Engine) -> int:
    return int(scalar(engine, "SELECT count(*) FROM staff_audit_events"))


def history_rows(engine: Engine, listing_id: str | None = None) -> int:
    if listing_id is None:
        return int(scalar(engine, "SELECT count(*) FROM listing_status_history"))
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM listing_status_history WHERE listing_id = :i",
            i=uuid.UUID(listing_id),
        )
    )


def status_and_revision(engine: Engine, listing_id: str) -> tuple[str, int]:
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT status, revision FROM listings WHERE id = :i"),
            {"i": uuid.UUID(listing_id)},
        ).one()
    return str(row[0]), int(row[1])


def world(env: AuthEnv, actor: Actor, operation: str) -> tuple[AuthApi, str | None]:
    """The actor, signed in, and (for edit / archive) a Provider authored by someone else."""
    api = sign_in_account(env, actor.email, **actor.account)
    if operation == "create":
        return api, None
    author = sign_in_account(env, "author-root@example.org", professional=None, admin=True)
    created = author.request("POST", PROVIDERS, json=staff_provider_body())
    assert created.status_code == 201, created.text
    return api, str(created.json()["data"]["id"])


def unchanged(
    engine: Engine, operation: str, listing_id: str | None, before: dict[str, int]
) -> None:
    """A write that lost the race left every table exactly as it was."""
    assert provider_count(engine) == before["providers"]
    assert audit_rows(engine) == before["audit"]
    assert history_rows(engine) == before["history"]
    if listing_id is not None:
        assert status_and_revision(engine, listing_id) == ("pending", 1)
        assert scalar(
            engine, "SELECT title FROM listings WHERE id = :i", i=uuid.UUID(listing_id)
        ) == ("Bright Spark Electricians")


def counts(engine: Engine) -> dict[str, int]:
    return {
        "providers": provider_count(engine),
        "audit": audit_rows(engine),
        "history": history_rows(engine),
    }


# =================================================================================================
# Interleaving 1: the revoke commits between the taxonomy / listing lock and the authority read
# =================================================================================================


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_revoke_committed_before_the_authority_read_fails_the_write(
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    world_env: AuthEnv,
    actor: Actor,
    operation: str,
) -> None:
    """1. the write takes its first locks (taxonomy; for edit / archive also the listing row); 2. it
    is paused BEFORE it reads or locks any authority; 3. the revoke runs and COMMITS; 4. the write
    resumes → it must fail and change nothing."""
    api, listing_id = world(world_env, actor, operation)
    before = counts(db_engine)
    gate = gate_at(monkeypatch, "share_user", after=False)

    write = Write(api, operation, listing_id)
    gate.wait_arrived()
    if listing_id is not None:
        assert listing_is_locked(db_engine, listing_id), (
            "an edit / archive holds the Provider first"
        )

    commit_now(db_engine, actor.revoke, actor.email)  # nothing of the actor is locked yet
    assert scalar(db_engine, actor.gone, e=actor.email) == 0
    gate.release.set()

    response = write.finish()
    expected = 403 if operation == "create" else actor.lost_existing
    assert response.status_code == expected, response.text
    unchanged(db_engine, operation, listing_id, before)


# =================================================================================================
# Interleaving 2: the write holds its authority; the revoke must wait
# =================================================================================================


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_write_that_holds_its_authority_makes_the_revoke_wait_until_it_commits(
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    world_env: AuthEnv,
    actor: Actor,
    operation: str,
) -> None:
    """1. the write reads AND locks its authority; 2. it is paused; 3. the revoke starts and is
    observed BLOCKED in PostgreSQL; 4. the write commits; 5. only then does the revoke complete."""
    api, listing_id = world(world_env, actor, operation)
    before = counts(db_engine)
    gate = gate_at(monkeypatch, actor.holds_after, after=True)

    write = Write(api, operation, listing_id)
    gate.wait_arrived()
    revoker = Revoker(db_engine, [actor.revoke], actor.email)

    wait_until(lambda: waiting_on_a_lock(db_engine, actor.revoke_like), "the revoke to block")
    assert not revoker.done.is_set(), "the revoke must wait, not complete"
    assert scalar(db_engine, actor.gone, e=actor.email) == 1  # nothing was revoked yet
    assert write.running and counts(db_engine) == before  # and the write has committed nothing

    gate.release.set()
    response = write.finish()
    assert response.status_code == ok_status(operation), response.text  # the write linearised first
    revoker.finish()  # ...and only now could the revoke complete

    assert scalar(db_engine, actor.gone, e=actor.email) == 0  # the revoke applied, afterwards
    assert audit_rows(db_engine) == before["audit"] + 1
    role = scalar(
        db_engine,
        "SELECT actor_role FROM listing_status_history ORDER BY created_at DESC, id LIMIT 1",
    )
    assert role == actor.role  # the history row records the authority the write really held


# =================================================================================================
# Interleavings 3 & 4: a role change that locks the users row first (the RBAC-C protocol)
# =================================================================================================


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_role_change_that_locks_users_first_waits_instead_of_deadlocking(
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    world_env: AuthEnv,
    actor: Actor,
    operation: str,
) -> None:
    """The write holds users (KEY SHARE) → user_roles → scope. A change doing ``users FOR UPDATE`` →
    ``DELETE`` must wait at its FIRST statement; nothing is killed as a deadlock victim."""
    api, listing_id = world(world_env, actor, operation)
    gate = gate_at(monkeypatch, actor.holds_after, after=True)

    write = Write(api, operation, listing_id)
    gate.wait_arrived()
    revoker = Revoker(db_engine, [USERS_FIRST, actor.revoke], actor.email)

    wait_until(lambda: waiting_on_a_lock(db_engine, USERS_FIRST_LIKE), "the change to wait")
    assert not revoker.done.is_set()

    gate.release.set()
    response = write.finish()
    assert response.status_code == ok_status(operation), response.text  # not a deadlock victim
    revoker.finish()
    assert scalar(db_engine, actor.gone, e=actor.email) == 0


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("actor", ACTORS, ids=IDS)
def test_a_write_arriving_while_a_role_change_holds_users_waits_and_then_fails(
    db_engine: Engine, world_env: AuthEnv, actor: Actor, operation: str
) -> None:
    """The role change (``users FOR UPDATE`` → ``DELETE``, uncommitted) is first. The write must
    wait for it — holding at most the taxonomy / listing locks, no authority row — then see the
    revoke and fail."""
    api, listing_id = world(world_env, actor, operation)
    before = counts(db_engine)

    with db_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(text(USERS_FIRST), {"e": actor.email})
        connection.execute(text(actor.revoke), {"e": actor.email})  # held, uncommitted

        write = Write(api, operation, listing_id)
        wait_until(lambda: waiting_on_a_lock(db_engine, ACTOR_LOCK_LIKE), "the write to wait")
        assert write.running
        assert counts(db_engine) == before

        transaction.commit()

    response = write.finish()
    expected = 403 if operation == "create" else actor.lost_existing
    assert response.status_code == expected, response.text
    unchanged(db_engine, operation, listing_id, before)


# =================================================================================================
# Lock order against the other writers that touch the same rows
# =================================================================================================


def test_an_edit_and_an_rbac_b_decision_on_one_provider_serialise_without_a_deadlock(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """The decision holds listings → users → user_roles. The edit, arriving then, waits at the
    LISTING row (before it holds any authority row), and runs after the decision commits."""
    boss = sign_in_account(world_env, "boss@example.org", professional=None, admin=True)
    editor = sign_in_account(
        world_env, "services-editor@example.org", professional=None, moderator_scopes=[SERVICES]
    )
    created = boss.request("POST", PROVIDERS, json=staff_provider_body())
    assert created.status_code == 201, created.text
    listing_id = str(created.json()["data"]["id"])
    gate = gate_at(monkeypatch, "share_staff_roles", after=True)

    decision: dict[str, Response] = {}
    decider = threading.Thread(
        target=lambda: decision.setdefault(
            "r",
            boss.request("POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}),
        ),
        daemon=True,
    )
    decider.start()
    gate.wait_arrived()  # the decision holds the listing, users and its role row

    edit = Write(editor, "edit", listing_id)
    wait_until(lambda: waiting_on_a_lock(db_engine, LISTING_LOCK_LIKE), "the edit to wait")
    assert edit.running
    assert status_and_revision(db_engine, listing_id) == ("pending", 1)

    gate.release.set()
    decider.join(TIMEOUT)
    assert not decider.is_alive() and decision["r"].status_code == 200, decision["r"].text
    response = edit.finish()
    assert response.status_code == 200, response.text  # the revision is unchanged by a decision
    assert status_and_revision(db_engine, listing_id) == ("pending", 2)  # edited AFTER approval
    with db_engine.connect() as connection:  # closed here: an open one would block the teardown
        actions = [
            str(row[0])
            for row in connection.execute(
                text(
                    "SELECT action FROM listing_status_history WHERE listing_id = :i "
                    "ORDER BY created_at, revision, id"
                ),
                {"i": uuid.UUID(listing_id)},
            )
        ]
    assert actions == ["submitted", "approved", "resubmitted"]


def test_an_authoring_write_and_an_rbac_c_removal_meet_without_a_deadlock(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """The removal takes the staff-authority advisory lock, then ``users FOR UPDATE``, and never a
    listing. A create paused while holding the moderator's authority makes the removal wait for
    it; the create commits, then the removal completes — and the Provider survives the removal."""
    boss = super_admin(world_env)
    email = "removed-mod@example.org"
    moderator = sign_in_account(world_env, email, professional=None, moderator_scopes=[SERVICES])
    moderator_id = scalar(db_engine, "SELECT id FROM users WHERE email = :e", e=email)
    gate = gate_at(monkeypatch, "share_moderator_scope", after=True)

    create = Write(moderator, "create")
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
    assert remover.is_alive() and create.running
    assert provider_count(db_engine) == 0

    gate.release.set()
    created = create.finish()
    remover.join(TIMEOUT)
    assert not remover.is_alive(), "the removal never finished (deadlock?)"
    assert created.status_code == 201, created.text
    assert removed["r"].status_code == 204, removed["r"].text
    assert provider_count(db_engine) == 1  # the Provider outlived its author's authority
    assert scalar(db_engine, "SELECT count(*) FROM user_roles WHERE role = 'moderator'") == 0
    assert (
        scalar(db_engine, "SELECT owner_id IS NULL FROM listings WHERE kind = 'provider'") is True
    )


def test_a_create_after_a_committed_removal_is_refused_and_leaves_no_provider(
    db_engine: Engine, world_env: AuthEnv
) -> None:
    boss = super_admin(world_env)
    email = "removed-first@example.org"
    moderator = sign_in_account(world_env, email, professional=None, moderator_scopes=[SERVICES])
    moderator_id = scalar(db_engine, "SELECT id FROM users WHERE email = :e", e=email)

    assert boss.request("DELETE", f"{MODERATORS}/{moderator_id}").status_code == 204
    response = moderator.request("POST", PROVIDERS, json=staff_provider_body())

    assert response.status_code in (401, 403)  # the sessions were revoked with the role
    assert provider_count(db_engine) == 0 and audit_rows(db_engine) >= 1  # only the removal's audit


def test_taxonomy_administration_waits_for_an_in_flight_authoring_write(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """A create holds the taxonomy lock SHARED; a category change takes it EXCLUSIVELY first, so it
    waits for the create — a rename / reindex can never interleave with a write that read the old
    name — and both then complete."""
    try:
        boss = sign_in_account(world_env, "tax-boss@example.org", professional=None, admin=True)
        gate = gate_at(monkeypatch, "share_user", after=False)

        create = Write(boss, "create")
        gate.wait_arrived()  # the create holds the shared taxonomy lock, nothing else
        category: dict[str, Response] = {}
        admin = sign_in_account(world_env, "tax-admin@example.org", professional=None, admin=True)
        changer = threading.Thread(
            target=lambda: category.setdefault(
                "r",
                admin.request(
                    "POST",
                    "/admin/categories",
                    json={"module": "services", "name": "Solar Fitters"},
                ),
            ),
            daemon=True,
        )
        changer.start()

        wait_until(
            lambda: waiting_on_a_lock(db_engine, ADVISORY_EXCLUSIVE_LIKE),
            "the category change to wait",
        )
        assert changer.is_alive() and provider_count(db_engine) == 0

        gate.release.set()
        assert create.finish().status_code == 201
        changer.join(TIMEOUT)
        assert not changer.is_alive(), "the category change never finished (deadlock?)"
        assert category["r"].status_code == 201, category["r"].text
    finally:
        # The committed world truncates listings and users but NOT the reference taxonomy, so a
        # category this test created would leak into every later test of the session.
        with db_engine.begin() as connection:
            connection.execute(
                text("DELETE FROM categories WHERE module = 'services' AND slug = 'solar-fitters'")
            )


def test_an_authoring_write_waits_for_a_taxonomy_change_in_flight(
    db_engine: Engine, world_env: AuthEnv
) -> None:
    boss = sign_in_account(world_env, "tax-wait@example.org", professional=None, admin=True)

    with db_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": TAXONOMY_LOCK_KEY})
        create = Write(boss, "create")
        wait_until(lambda: waiting_on_a_lock(db_engine, ADVISORY_SHARED_LIKE), "the create to wait")
        assert create.running and provider_count(db_engine) == 0
        transaction.commit()

    assert create.finish().status_code == 201
    assert provider_count(db_engine) == 1


# =================================================================================================
# No global lock: ordinary Provider authoring runs in parallel
# =================================================================================================


def test_two_authoring_writes_by_different_staff_do_not_block_each_other(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """Create A is paused WHILE HOLDING its authority locks. Create B — another staff member —
    runs to completion meanwhile: there is no global staff lock around ordinary authoring."""
    first = sign_in_account(world_env, "first@example.org", professional=None, admin=True)
    second = sign_in_account(
        world_env, "second@example.org", professional=None, moderator_scopes=[SERVICES]
    )
    gate = gate_first_call(monkeypatch, "share_staff_roles")

    slow = Write(first, "create")
    gate.wait_arrived()  # A holds taxonomy (shared), users (key share), user_roles (share)
    fast = second.request("POST", PROVIDERS, json=staff_provider_body(name="Second Provider"))

    assert fast.status_code == 201, fast.text  # B finished while A was still open
    assert slow.running and provider_count(db_engine) == 1
    gate.release.set()
    assert slow.finish().status_code == 201
    assert provider_count(db_engine) == 2


def test_two_writes_by_the_same_staff_member_do_not_block_each_other(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """The authority locks an authoring write takes are all SHARED, so one actor's concurrent
    writes are compatible with each other."""
    actor = sign_in_account(world_env, "same@example.org", professional=None, admin=True)
    gate = gate_first_call(monkeypatch, "share_staff_roles")

    slow = Write(actor, "create")
    gate.wait_arrived()
    second = actor.request("POST", PROVIDERS, json=staff_provider_body(name="Second Provider"))

    assert second.status_code == 201, second.text
    assert slow.running and provider_count(db_engine) == 1
    gate.release.set()
    assert slow.finish().status_code == 201
    assert provider_count(db_engine) == 2


def test_authoring_does_not_take_the_staff_authority_advisory_lock(
    db_engine: Engine, world_env: AuthEnv
) -> None:
    """While a staff mutation (simulated by holding its advisory lock) is in flight, a Provider
    write completes: it never contends for the global staff-authority lock."""
    boss = sign_in_account(world_env, "adv@example.org", professional=None, admin=True)

    with db_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(
            text("SELECT pg_advisory_xact_lock(:k)"), {"k": STAFF_AUTHORITY_LOCK_KEY}
        )
        created = boss.request("POST", PROVIDERS, json=staff_provider_body())
        assert created.status_code == 201, created.text
        listing_id = str(created.json()["data"]["id"])
        edited = boss.request(
            "PATCH", f"{PROVIDERS}/{listing_id}", json={"revision": 1, "name": "Edited While Held"}
        )
        archived = boss.request("POST", f"{PROVIDERS}/{listing_id}/archive", json={"revision": 2})
        transaction.commit()

    assert edited.status_code == 200 and archived.status_code == 200


# =================================================================================================
# Two edits of one Provider
# =================================================================================================


def test_two_edits_of_one_revision_serialise_and_the_second_is_a_conflict(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    boss = sign_in_account(world_env, "edits@example.org", professional=None, admin=True)
    other = sign_in_account(
        world_env, "edits-two@example.org", professional=None, moderator_scopes=[SERVICES]
    )
    created = boss.request("POST", PROVIDERS, json=staff_provider_body())
    listing_id = str(created.json()["data"]["id"])
    gate = gate_at(monkeypatch, "share_staff_roles", after=True)

    first = Write(boss, "edit", listing_id)
    gate.wait_arrived()  # the first edit holds the Provider row and its authority
    second = Write(other, "edit", listing_id)
    wait_until(lambda: waiting_on_a_lock(db_engine, LISTING_LOCK_LIKE), "the second edit to wait")
    assert second.running

    gate.release.set()
    results = sorted([first.finish().status_code, second.finish().status_code])
    assert results == [200, 409]  # one wins at revision 1; the other reads revision 2 and conflicts
    assert status_and_revision(db_engine, listing_id)[1] == 2
    assert (
        scalar(
            db_engine, "SELECT count(*) FROM staff_audit_events WHERE action = 'provider_updated'"
        )
        == 1
    )


def test_an_archive_and_an_edit_of_one_provider_never_both_win(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    boss = sign_in_account(world_env, "ae@example.org", professional=None, admin=True)
    created = boss.request("POST", PROVIDERS, json=staff_provider_body())
    listing_id = str(created.json()["data"]["id"])
    gate = gate_at(monkeypatch, "share_staff_roles", after=True)

    archive = Write(boss, "archive", listing_id)
    gate.wait_arrived()
    edit = Write(boss, "edit", listing_id)
    wait_until(lambda: waiting_on_a_lock(db_engine, LISTING_LOCK_LIKE), "the edit to wait")

    gate.release.set()
    assert archive.finish().status_code == 200
    losing = edit.finish()
    assert losing.status_code == 409  # archived is terminal: the edit fails, nothing changed
    assert status_and_revision(db_engine, listing_id) == ("archived", 2)


# =================================================================================================
# The Provider row is not locked by a probe through the wrong route
# =================================================================================================


def test_probing_a_non_provider_id_through_a_provider_route_does_not_lock_it(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, world_env: AuthEnv
) -> None:
    """The locking query is restricted to ``kind = 'provider'`` IN SQL, so a Business id is "not
    found" without its row being locked: a staff member cannot stall a moderation decision on
    someone else's listing by hammering a provider route with its id."""
    owner = sign_in_account(world_env, "biz-owner@example.org", professional=PlanCode.PREMIUM)
    business = owner.request(
        "POST",
        "/listings",
        json={
            "kind": "business",
            "vertical": "general",
            "name": "Capital Stationers",
            "description": "A clean, friendly place that has served the neighbourhood for years.",
            "area": "B-17",
            "category": "grocery",
            # Listing Contact v1: a new owner-created Business must say how customers reach it.
            "contactPhone": "0300 1234567",
            "location": {
                "visibility": "exact",
                "address": "Shop 4, Main Market",
                "latitude": 33.1,
                "longitude": 72.1,
            },
        },
    )
    assert business.status_code == 201, business.text
    business_id = str(business.json()["data"]["id"])
    boss = sign_in_account(world_env, "probe-boss@example.org", professional=None, admin=True)
    gate: Gate = gate_at(monkeypatch, "share_user", after=False)

    probe = Write(boss, "edit", business_id)
    gate.wait_arrived()  # the probe is as far as it can get without authority

    assert not listing_is_locked(db_engine, business_id)  # the Business row was never locked
    gate.release.set()
    assert probe.finish().status_code == 404
