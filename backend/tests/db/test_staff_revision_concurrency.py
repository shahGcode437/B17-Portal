"""The staff revision under real concurrency (GROCERY-4A, ``docs/backend/AUTH_RBAC.md`` §39).

Independent PostgreSQL connections over COMMITTED rows, on separate threads. Nothing depends on
timing: contenders are held on a lock the test owns and are OBSERVED waiting on it
(``pg_stat_activity``) before it is released. Only this kind of test says anything about the
database's atomicity.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import Engine, text

from app.services.staff_audit import StaffAuditService
from app.services.staff_authority import StaffAuthorityService
from app.services.staff_rules import StaffAuthorityError, StaffCode
from tests.db.auth_helpers import AuthEnv, make_account
from tests.db.staff_helpers import DIRECTORY, EDUCATION, FOOD, REASON, live_session, revision_of
from tests.db.test_scoped_moderation_concurrency import scalar, wait_until
from tests.db.test_staff_concurrency import (
    Call,
    moderator,
    queued_behind_the_lock,
    staff_lock_held,
    staff_world,  # noqa: F401 - the fixture
    waiters,
)

Operation = Callable[[StaffAuthorityService], Any]


def revision_now(engine: Engine, user_id: Any) -> int:
    """From a connection of its own: the committed value."""
    return int(scalar(engine, "SELECT staff_revision FROM users WHERE id = :u", u=user_id))


def authority(engine: Engine, user_id: Any) -> tuple[Any, ...]:
    """The committed staff state, whole: roles, scopes, revision, audit rows, sessions ended."""
    return (
        scalar(
            engine,
            "SELECT string_agg(role, ',' ORDER BY role) FROM user_roles WHERE user_id = :u",
            u=user_id,
        ),
        scalar(
            engine,
            "SELECT string_agg(scope, ',' ORDER BY scope) FROM staff_scope_assignments "
            "WHERE user_id = :u",
            u=user_id,
        ),
        revision_now(engine, user_id),
        scalar(
            engine, "SELECT count(*) FROM staff_audit_events WHERE target_user_id = :u", u=user_id
        ),
        scalar(
            engine,
            "SELECT count(*) FROM auth_sessions WHERE user_id = :u AND revoked_at IS NOT NULL",
            u=user_id,
        ),
    )


def actors(env: AuthEnv, count: int = 2) -> list[tuple[Any, Any]]:
    """``count`` Super Admins, each with a live session of their own."""
    found = []
    for n in range(count):
        admin = make_account(env.session, f"admin{n}@example.org", admin=True)
        found.append((admin.id, live_session(env.session, admin.id)))
    return found


def contenders(
    operation: str, target: Any, email: str, seen: int, who: list[tuple[Any, Any]]
) -> list[Operation]:
    """The same decision made by two different Super Admins on the same revision."""

    def one(actor: Any, session: Any) -> Operation:
        if operation == "appoint":
            return lambda s: s.appoint_moderator(
                actor, email, [FOOD], revision=seen, session_id=session
            )
        if operation == "replace":
            scope = DIRECTORY if actor == who[0][0] else EDUCATION
            return lambda s: s.replace_scopes(
                actor, target, [scope], revision=seen, session_id=session
            )
        if operation == "pause":
            return lambda s: s.pause_moderator(actor, target, revision=seen, session_id=session)
        if operation == "resume":
            return lambda s: s.resume_moderator(
                actor, target, [FOOD], revision=seen, session_id=session
            )
        return lambda s: s.remove_moderator(actor, target, revision=seen, session_id=session)

    return [one(actor, session) for actor, session in who]


@pytest.mark.parametrize("operation", ["appoint", "replace", "pause", "resume", "remove"])
def test_two_administrators_on_one_revision_exactly_one_wins(
    db_engine: Engine,
    staff_world: AuthEnv,  # noqa: F811
    operation: str,
) -> None:
    who = actors(staff_world)
    if operation == "appoint":
        target = make_account(staff_world.session, "target@example.org")
    else:
        scopes: tuple[Any, ...] = () if operation == "resume" else (FOOD,)
        target = moderator(staff_world, "target@example.org", scopes)
    seen = revision_of(staff_world.session, target.id)

    with staff_lock_held(db_engine):
        calls = [
            Call(db_engine, work)
            for work in contenders(operation, target.id, target.email, seen, who)
        ]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    assert not any(call.crashed for call in calls), [call.error for call in calls]
    losers = [call for call in calls if call.error is not None]
    assert len(losers) == 1
    # (After a removal the loser's target is no Moderator at all, which is answered first.)
    assert losers[0].refused is (
        StaffCode.MODERATOR_NOT_FOUND if operation == "remove" else StaffCode.STAFF_CHANGED
    )
    assert revision_now(db_engine, target.id) == seen + 1  # advanced once, by the winner


@pytest.mark.parametrize("operation", ["appoint", "replace", "pause", "resume", "remove"])
def test_the_revision_compared_is_the_committed_one_even_if_it_changed_while_waiting(
    db_engine: Engine,
    staff_world: AuthEnv,  # noqa: F811
    operation: str,
) -> None:
    """The call is already under way, holding the staff lock and waiting for the TARGET's row,
    when another writer commits a new revision. Had it compared anything read earlier, it would
    write on top of the change."""
    who = actors(staff_world, 1)
    if operation == "appoint":
        target = make_account(staff_world.session, "waited@example.org")
    else:
        scopes: tuple[Any, ...] = () if operation == "resume" else (FOOD,)
        target = moderator(staff_world, "waited@example.org", scopes)
    seen = revision_of(staff_world.session, target.id)
    (work,) = contenders(operation, target.id, target.email, seen, who)

    writer = db_engine.connect()
    try:
        transaction = writer.begin()
        writer.execute(text("SELECT 1 FROM users WHERE id = :u FOR UPDATE"), {"u": target.id})
        call = Call(db_engine, work)
        wait_until(
            lambda: waiters(db_engine, "%FROM users%FOR UPDATE%") == 1,
            "the change to wait for the target",
        )
        assert not call.finished.is_set()
        writer.execute(
            text("UPDATE users SET staff_revision = staff_revision + 2 WHERE id = :u"),
            {"u": target.id},
        )
        transaction.commit()  # A -> B -> A as far as roles and scopes show: only the count moved
    finally:
        writer.close()
    before = authority(db_engine, target.id)
    call.wait()

    assert call.refused is StaffCode.STAFF_CHANGED, call.error
    assert isinstance(call.error, StaffAuthorityError)
    assert call.error.current_revision == seen + 2
    assert authority(db_engine, target.id) == before


@pytest.mark.parametrize("operation", ["appoint", "replace", "pause", "resume", "remove"])
def test_a_change_that_fails_after_writing_leaves_nothing_committed(
    db_engine: Engine,
    staff_world: AuthEnv,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    """The audit is the last write: when it fails, the revision goes back with everything else."""
    who = actors(staff_world, 1)
    if operation == "appoint":
        target = make_account(staff_world.session, "rolled@example.org")
    else:
        scopes: tuple[Any, ...] = () if operation == "resume" else (FOOD,)
        target = moderator(staff_world, "rolled@example.org", scopes)
    seen = revision_of(staff_world.session, target.id)
    (work,) = contenders(operation, target.id, target.email, seen, who)
    before = authority(db_engine, target.id)

    def broken(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("the audit could not be written")

    monkeypatch.setattr(StaffAuditService, "record", broken)
    call = Call(db_engine, work)
    call.wait()

    assert isinstance(call.error, RuntimeError)
    assert authority(db_engine, target.id) == before


@pytest.mark.parametrize("operator", ["promote", "demote"])
def test_the_operator_cli_racing_a_web_change_never_both_apply_on_one_state(
    db_engine: Engine,
    staff_world: AuthEnv,  # noqa: F811
    operator: str,
) -> None:
    who = actors(staff_world, 1)
    if operator == "promote":  # one admin so far: a second needs no policy override
        target = moderator(staff_world, "both@example.org")
    else:
        target = make_account(staff_world.session, "both@example.org", admin=True)
    seen = revision_of(staff_world.session, target.id)
    actor, session = who[0]
    web: Operation = (
        (lambda s: s.pause_moderator(actor, target.id, revision=seen, session_id=session))
        if operator == "promote"
        else (
            lambda s: s.appoint_moderator(
                actor, target.email, [FOOD], revision=seen, session_id=session
            )
        )
    )
    cli: Operation = (
        (lambda s: s.promote_super_admin(target.email, REASON))
        if operator == "promote"
        else (lambda s: s.demote_super_admin(target.email, REASON))
    )

    with staff_lock_held(db_engine):
        calls = [Call(db_engine, web), Call(db_engine, cli)]
        queued_behind_the_lock(db_engine, calls)
    for call in calls:
        call.wait()

    web_call, cli_call = calls
    assert not any(call.crashed for call in calls), [call.error for call in calls]
    assert cli_call.error is None  # the operator's change always applies
    # The web change applied only if it ran FIRST, on the state it was decided on.
    assert web_call.refused in (
        None,
        StaffCode.STAFF_CHANGED,
        StaffCode.SUPER_ADMIN_TARGET_FORBIDDEN,
    )
    expected = seen + 1 + (1 if web_call.error is None else 0)
    assert revision_now(db_engine, target.id) == expected
