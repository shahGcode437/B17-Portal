"""Staff mutations under real concurrency (docs/backend/AUTH_RBAC.md §27.6, §30).

Separate PostgreSQL connections over COMMITTED rows. Nothing here is a timing race: the
staff-authority advisory lock is HELD by the test so that every contender provably queues on it
(observed in ``pg_stat_activity``), then released — so each contender runs, one at a time, in an
order the test does not control, and the assertions are the properties that must hold in EVERY
order (never zero usable Super Admins, a consistent before/after chain, never two staff roles).

The lock-order tests prove a staff mutation and an RBAC-B moderation decision, which hold locks the
other needs, finish in either order without a deadlock.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.models import AuthIdentity
from app.models.enums import AuthProvider, StaffAuditAction
from app.repositories.staff import STAFF_AUTHORITY_LOCK_KEY, StaffManagementRepository
from app.services.staff_authority import StaffAuthorityService
from app.services.staff_rules import StaffAuthorityError, StaffCode
from tests.db.auth_helpers import AuthEnv, FakeClock, make_account
from tests.db.staff_helpers import DIRECTORY, EDUCATION, FOOD, REASON, policy, purge_staff_audit
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import (
    ACTORS,
    Decision,
    Gate,
    gate_at,
    scalar,
    status_of,
    wait_until,
    world,
)

TIMEOUT = 30.0
ADVISORY_LIKE = "%pg_advisory_xact_lock%"


@pytest.fixture
def staff_world(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_staff_audit(db_engine), committed_world(db_engine) as env:
        yield env


# -- running service calls on their own connections ----------------------------------------------


class Call:
    """One service call on its own thread and its own session."""

    def __init__(self, engine: Engine, work: Callable[[StaffAuthorityService], Any]) -> None:
        self.value: Any = None
        self.error: BaseException | None = None
        self.finished = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(engine, work), daemon=True)
        self._thread.start()

    def _run(self, engine: Engine, work: Callable[[StaffAuthorityService], Any]) -> None:
        try:
            with Session(engine, expire_on_commit=False) as session:
                self.value = work(StaffAuthorityService(session, FakeClock(), policy()))
        except BaseException as error:
            self.error = error
        finally:
            self.finished.set()

    def wait(self) -> Call:
        self._thread.join(TIMEOUT)
        assert not self._thread.is_alive(), "the call never finished (deadlock?)"
        return self

    @property
    def refused(self) -> StaffCode | None:
        return self.error.code if isinstance(self.error, StaffAuthorityError) else None

    @property
    def crashed(self) -> bool:
        """A failure that is NOT a deliberate refusal (a deadlock victim, a constraint error)."""
        return self.error is not None and not isinstance(self.error, StaffAuthorityError)


def demotion(engine: Engine, email: str) -> Call:
    """A Super Admin demotion of ``email`` on its own connection (the address is bound here, not
    late, so each call demotes ITS account)."""
    return Call(engine, lambda service: service.demote_super_admin(email, REASON))


def waiters(engine: Engine, like: str) -> int:
    """How many backends are blocked on a lock, right now, in a statement matching ``like``."""
    with engine.connect() as connection:
        return int(
            connection.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                    "AND wait_event_type = 'Lock' AND query LIKE :p"
                ),
                {"p": like},
            ).scalar_one()
        )


@contextmanager
def staff_lock_held(engine: Engine) -> Iterator[None]:
    """Hold the staff-authority advisory lock (session level: it shares the transaction-level
    lock's key space, so every staff mutation queues behind it)."""
    connection = engine.connect()
    try:
        connection.execute(text("SELECT pg_advisory_lock(:k)"), {"k": STAFF_AUTHORITY_LOCK_KEY})
        yield
    finally:
        connection.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": STAFF_AUTHORITY_LOCK_KEY})
        connection.commit()
        connection.close()


def queued_behind_the_lock(engine: Engine, calls: list[Call]) -> None:
    """Every call is observed waiting on the advisory lock, and none has finished."""
    wait_until(lambda: waiters(engine, ADVISORY_LIKE) == len(calls), "every call to queue")
    assert not any(call.finished.is_set() for call in calls)


def usable_admins(engine: Engine) -> int:
    """Usable Super Admins under the DEFAULT configuration the ``Call`` services use: no login
    provider is enabled, so only a password is a sign-in method (an identity row is not one)."""
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM user_roles r JOIN users u ON u.id = r.user_id "
            "WHERE r.role = 'admin' AND u.status = 'active' AND u.email_verified_at IS NOT NULL "
            "AND u.password_hash IS NOT NULL AND u.password_hash <> ''",
        )
    )


def audit_after_counts(engine: Engine, action: str) -> list[int]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT (after->>'super_admin_count')::int FROM staff_audit_events "
                "WHERE action = :a ORDER BY id"
            ),
            {"a": action},
        )
        return sorted(int(row[0]) for row in rows)


# -- the last-usable-Super-Admin race ---------------------------------------------------------------


def test_two_super_admins_demoting_each_other_concurrently_never_reach_zero(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    a = make_account(staff_world.session, "a@example.org", admin=True)
    b = make_account(staff_world.session, "b@example.org", admin=True)

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.demote_super_admin(a.email, REASON)),
            Call(db_engine, lambda s: s.demote_super_admin(b.email, REASON)),
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls), [call.error for call in calls]
    assert sorted(call.refused is None for call in calls) == [False, True]  # exactly one succeeded
    assert [call.refused for call in calls if call.refused] == [StaffCode.LAST_SUPER_ADMIN]
    assert usable_admins(db_engine) == 1  # NEVER zero


@pytest.mark.parametrize("count", [3, 5])
def test_n_concurrent_demotions_leave_exactly_one_usable_super_admin(
    db_engine: Engine, staff_world: AuthEnv, count: int
) -> None:
    emails = [f"admin{n}@example.org" for n in range(count)]
    for email in emails:
        make_account(staff_world.session, email, admin=True)

    with staff_lock_held(db_engine):
        calls = [demotion(db_engine, email) for email in emails]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls), [call.error for call in calls]
    assert sum(call.refused is None for call in calls) == count - 1
    assert sum(call.refused is StaffCode.LAST_SUPER_ADMIN for call in calls) == 1
    assert usable_admins(db_engine) == 1
    # Serialised: the successes saw the usable count fall one at a time (count-1, ..., 1). Without
    # the lock two of them could both report the same count.
    assert audit_after_counts(db_engine, StaffAuditAction.SUPER_ADMIN_DEMOTED.value) == list(
        range(1, count)
    )


def released(barrier: threading.Barrier, email: str) -> Callable[[StaffAuthorityService], Any]:
    """A demotion that waits at ``barrier`` first, so the contenders start at the same instant."""

    def work(service: StaffAuthorityService) -> Any:
        barrier.wait(TIMEOUT)
        return service.demote_super_admin(email, REASON)

    return work


def test_a_hammered_mutual_demotion_never_reaches_zero(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    """The lock-gated tests above PROVE serialisation; this one is the plain race — two Super
    Admins demote each other, released from a barrier at the same instant, many rounds. Without the
    advisory lock each demotion sees the other admin still holding the role (its delete is not
    committed) and both succeed, leaving zero. With it, exactly one ever does."""
    for round_number in range(15):
        with db_engine.begin() as connection:
            connection.execute(text("DELETE FROM user_roles WHERE role = 'admin'"))
        first = make_account(staff_world.session, f"hm{round_number}a@example.org", admin=True)
        second = make_account(staff_world.session, f"hm{round_number}b@example.org", admin=True)
        barrier = threading.Barrier(2)

        calls = [
            Call(db_engine, released(barrier, first.email)),
            Call(db_engine, released(barrier, second.email)),
        ]
        for call in calls:
            call.wait()

        assert not any(call.crashed for call in calls), [call.error for call in calls]
        assert usable_admins(db_engine) == 1, f"round {round_number}: not exactly one admin left"
        assert sum(call.refused is None for call in calls) == 1


def test_an_admin_with_only_a_disabled_provider_never_makes_the_real_admin_demotable(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    """A signs in with a password; B has only a Google identity and Google sign-in is off. Both
    demotions are queued on the advisory lock, so whichever runs first, B can be demoted (it never
    counted) and A can NEVER be (B does not make A 'not the last')."""
    real = make_account(staff_world.session, "real@example.org", admin=True)
    ghost = make_account(staff_world.session, "ghost@example.org", admin=True, password=None)
    staff_world.session.add(
        AuthIdentity(user_id=ghost.id, provider=AuthProvider.GOOGLE, provider_subject="ghost-g")
    )
    staff_world.session.commit()

    with staff_lock_held(db_engine):
        real_call, ghost_call = demotion(db_engine, real.email), demotion(db_engine, ghost.email)
        queued_behind_the_lock(db_engine, [real_call, ghost_call])
    real_call.wait()
    ghost_call.wait()

    assert real_call.refused is StaffCode.LAST_SUPER_ADMIN
    assert ghost_call.error is None
    assert usable_admins(db_engine) == 1  # the real admin is still there, still able to sign in


def test_a_demotion_racing_a_promotion_cannot_empty_the_system(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    only = make_account(staff_world.session, "only@example.org", admin=True)
    new = make_account(staff_world.session, "new@example.org")

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.demote_super_admin(only.email, REASON)),
            Call(db_engine, lambda s: s.promote_super_admin(new.email, REASON)),
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls)
    assert usable_admins(db_engine) >= 1  # promote-then-demote, or a refused demotion: never zero


def test_concurrent_promotions_of_one_account_grant_it_once(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    target = make_account(staff_world.session, "once@example.org")

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.promote_super_admin(target.email, REASON)) for _ in range(3)
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.error for call in calls)
    assert sorted(call.value.changed for call in calls) == [False, False, True]
    assert usable_admins(db_engine) == 1
    assert audit_after_counts(db_engine, StaffAuditAction.SUPER_ADMIN_PROMOTED.value) == [1]


# -- Moderator operations racing each other ---------------------------------------------------------


def moderator(env: AuthEnv, email: str = "m@example.org", scopes: Any = (FOOD,)) -> Any:
    return make_account(env.session, email, moderator_scopes=list(scopes))


def test_simultaneous_scope_replacements_serialise_into_one_consistent_chain(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    actor = make_account(staff_world.session, "actor@example.org", admin=True)
    mod = moderator(staff_world)

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.replace_scopes(actor.id, mod.id, [DIRECTORY])),
            Call(db_engine, lambda s: s.replace_scopes(actor.id, mod.id, [EDUCATION])),
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.error for call in calls), [call.error for call in calls]
    final = scalar(
        db_engine,
        "SELECT string_agg(scope, ',' ORDER BY scope) FROM staff_scope_assignments WHERE user_id = :u",
        u=mod.id,
    )
    assert final in ("directory", "education")  # exactly one winner's set, never a union
    with db_engine.connect() as connection:
        chain = {
            (tuple(row[0]), tuple(row[1]))
            for row in connection.execute(
                text(
                    "SELECT before->'scopes', after->'scopes' FROM staff_audit_events "
                    "WHERE action = 'scope_granted'"
                )
            )
        }
    first, second = sorted(chain, key=lambda pair: pair[0] != ("food",))
    assert first[0] == ("food",)  # the first replacement started from the original set...
    assert second[0] == first[1]  # ...and the second from the FIRST's result (not the original)


@pytest.mark.parametrize("racer", ["pause", "remove"])
def test_a_scope_replacement_racing_a_pause_or_removal_ends_in_the_stronger_state(
    db_engine: Engine, staff_world: AuthEnv, racer: str
) -> None:
    actor = make_account(staff_world.session, "actor2@example.org", admin=True)
    mod = moderator(staff_world, "m2@example.org", (FOOD, DIRECTORY))
    operation: Callable[[StaffAuthorityService], Any] = (
        (lambda s: s.pause_moderator(actor.id, mod.id))
        if racer == "pause"
        else (lambda s: s.remove_moderator(actor.id, mod.id))
    )

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.replace_scopes(actor.id, mod.id, [EDUCATION])),
            Call(db_engine, operation),
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls), [call.error for call in calls]
    replace, other = calls
    assert other.error is None  # the pause / removal always succeeds
    # the replacement either ran first, or was refused because the target had already moved on
    assert replace.error is None or replace.refused in (
        StaffCode.MODERATOR_PAUSED,
        StaffCode.MODERATOR_NOT_FOUND,
    )
    roles = scalar(
        db_engine,
        "SELECT count(*) FROM user_roles WHERE user_id = :u AND role = 'moderator'",
        u=mod.id,
    )
    scopes = scalar(
        db_engine, "SELECT count(*) FROM staff_scope_assignments WHERE user_id = :u", u=mod.id
    )
    assert (roles, scopes) == ((1, 0) if racer == "pause" else (0, 0))


def test_two_appointments_of_one_account_create_one_moderator(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    actor = make_account(staff_world.session, "actor3@example.org", admin=True)
    target = make_account(staff_world.session, "target@example.org")

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.appoint_moderator(actor.id, target.email, [FOOD])),
            Call(db_engine, lambda s: s.appoint_moderator(actor.id, target.email, [DIRECTORY])),
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls)
    assert sorted(call.refused is None for call in calls) == [False, True]
    assert [call.refused for call in calls if call.refused] == [StaffCode.ALREADY_MODERATOR]
    assert scalar(db_engine, "SELECT count(*) FROM user_roles WHERE user_id = :u", u=target.id) == 1


def test_a_promotion_racing_an_appointment_never_leaves_two_staff_roles(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    actor = make_account(staff_world.session, "actor4@example.org", admin=True)
    target = make_account(staff_world.session, "both@example.org")

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, lambda s: s.appoint_moderator(actor.id, target.email, [FOOD])),
            Call(db_engine, lambda s: s.promote_super_admin(target.email, REASON)),
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls), [call.error for call in calls]
    with db_engine.connect() as connection:  # closed, so no transaction is left holding a lock
        roles = {
            row[0]
            for row in connection.execute(
                text("SELECT role FROM user_roles WHERE user_id = :u"), {"u": target.id}
            )
        }
    assert len(roles) == 1  # exactly one staff role, whichever order won
    if roles == {"admin"}:  # promoted last (or only): no Moderator scopes may remain
        assert (
            scalar(
                db_engine,
                "SELECT count(*) FROM staff_scope_assignments WHERE user_id = :u",
                u=target.id,
            )
            == 0
        )


# -- staff mutations vs an RBAC-B moderation decision (the frozen lock order) -----------------------


def gate_on(
    monkeypatch: pytest.MonkeyPatch, owner: type, method: str, *, after: bool = True
) -> Gate:
    """Pause the next ``owner.method`` call (see ``test_scoped_moderation_concurrency``)."""
    gate = Gate()
    original = getattr(owner, method)

    def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        if not after:
            gate.pause()
        result = original(self, *args, **kwargs)
        if after:
            gate.pause()
        return result

    monkeypatch.setattr(owner, method, wrapper)
    return gate


def test_removing_a_moderator_waits_for_a_decision_that_holds_its_authority_and_nothing_deadlocks(
    db_engine: Engine, staff_world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The decision holds listing X, users KEY SHARE, user_roles S and its scope row S. A removal
    (advisory lock, then users FOR UPDATE) must WAIT at ``users`` — before it holds anything the
    decision needs — and complete once the decision commits."""
    actor = make_account(staff_world.session, "remover@example.org", admin=True)
    api, listing_id = world(staff_world, ACTORS[0])  # a Food Moderator and a pending Food listing
    mod_id = scalar(db_engine, "SELECT id FROM users WHERE email = :e", e=ACTORS[0].email)
    gate = gate_at(monkeypatch, "share_moderator_scope", after=True)

    decision = Decision(api, listing_id)
    gate.wait_arrived()
    removal = Call(db_engine, lambda s: s.remove_moderator(actor.id, mod_id))

    wait_until(lambda: waiters(db_engine, "%FROM users%FOR UPDATE%") == 1, "the removal to wait")
    assert not removal.finished.is_set() and decision.running
    assert status_of(db_engine, listing_id) == "pending"

    gate.release.set()
    response = decision.finish()
    removal.wait()

    assert response.status_code == 200, response.text  # the decision linearised first
    assert removal.error is None
    assert status_of(db_engine, listing_id) == "approved"
    assert scalar(db_engine, "SELECT count(*) FROM user_roles WHERE user_id = :u", u=mod_id) == 0
    assert (
        scalar(
            db_engine,
            "SELECT actor_role FROM listing_status_history "
            "WHERE listing_id = :i AND action = 'approved'",
            i=listing_id,
        )
        == "moderator"
    )


def test_a_decision_arriving_while_a_removal_holds_the_user_lock_waits_then_is_refused(
    db_engine: Engine, staff_world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The removal holds the advisory lock and ``users FOR UPDATE``. The decision, already past
    ``require_staff``, locks its listing and then WAITS at its ``users`` key-share (holding no
    authority row); when the removal commits it finds no staff role and fails: ``403``."""
    actor = make_account(staff_world.session, "remover2@example.org", admin=True)
    api, listing_id = world(staff_world, ACTORS[0])
    mod_id = scalar(db_engine, "SELECT id FROM users WHERE email = :e", e=ACTORS[0].email)
    gate = gate_on(monkeypatch, StaffManagementRepository, "staff_roles_of", after=True)

    removal = Call(db_engine, lambda s: s.remove_moderator(actor.id, mod_id))
    gate.wait_arrived()  # the removal now holds the advisory lock AND users FOR UPDATE
    decision = Decision(api, listing_id)

    wait_until(lambda: waiters(db_engine, "%FOR KEY SHARE%") == 1, "the decision to wait")
    assert decision.running and not removal.finished.is_set()
    gate.release.set()
    removal.wait()
    response = decision.finish()

    assert removal.error is None
    assert response.status_code == 403, response.text  # no staff role any more
    assert status_of(db_engine, listing_id) == "pending"
    assert scalar(db_engine, "SELECT count(*) FROM user_roles WHERE user_id = :u", u=mod_id) == 0


def test_a_moderation_decision_never_waits_on_the_staff_authority_lock(
    db_engine: Engine, staff_world: AuthEnv
) -> None:
    """Moderation does not take the advisory lock, so holding it blocks staff MUTATIONS only: the
    two cannot form a cycle through it."""
    actor = make_account(staff_world.session, "actor5@example.org", admin=True)
    api, listing_id = world(staff_world, ACTORS[0])
    other = make_account(staff_world.session, "victim@example.org")

    with staff_lock_held(db_engine):
        blocked = Call(db_engine, lambda s: s.appoint_moderator(actor.id, other.email, [FOOD]))
        queued_behind_the_lock(db_engine, [blocked])
        decision = Decision(api, listing_id).finish()  # completes while the lock is held
        assert decision.status_code == 200, decision.text
        assert not blocked.finished.is_set()
    blocked.wait()
    assert blocked.error is None


LOCK = re.compile(r"FROM (\w+).*?FOR (KEY SHARE|NO KEY UPDATE|SHARE|UPDATE)", re.DOTALL)


@contextmanager
def recorded_locks(engine: Engine) -> Iterator[list[tuple[str, str]]]:
    """Every lock a service call takes, in order: ``("advisory", "")`` or ``(table, mode)``."""
    seen: list[tuple[str, str]] = []

    def record(
        connection: Any, cursor: Any, statement: str, parameters: Any, context: Any, many: bool
    ) -> None:
        if "pg_advisory_xact_lock" in statement:
            seen.append(("advisory", ""))
        elif statement.lstrip().upper().startswith("SELECT"):
            match = LOCK.search(statement)
            if match is not None:
                seen.append((match.group(1), match.group(2)))

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


@pytest.mark.parametrize("operation", ["remove", "promote", "demote"])
def test_a_staff_mutation_takes_the_advisory_lock_first_then_users_and_never_a_listing(
    db_engine: Engine, staff_world: AuthEnv, operation: str
) -> None:
    actor = make_account(staff_world.session, "actor6@example.org", admin=True)
    mod = moderator(staff_world, "lock-mod@example.org")
    plain = make_account(staff_world.session, "lock-plain@example.org")
    calls: dict[str, Callable[[StaffAuthorityService], Any]] = {
        "remove": lambda s: s.remove_moderator(actor.id, mod.id),
        "promote": lambda s: s.promote_super_admin(plain.email, REASON),
        "demote": lambda s: s.demote_super_admin(actor.email, REASON),
    }
    # `demote` needs a second usable Super Admin, or the guard would (correctly) refuse
    make_account(staff_world.session, "spare@example.org", admin=True)

    with recorded_locks(db_engine) as seen:
        Call(db_engine, calls[operation]).wait()

    assert seen[0] == ("advisory", "")  # BEFORE any row lock
    assert ("users", "UPDATE") in seen and seen.index(("users", "UPDATE")) == 1
    assert not [lock for lock in seen if lock[0] == "listings"]  # NEVER a listing
