"""Staff operations are ATOMIC (docs/backend/AUTH_RBAC.md §27.7, §30): the role / scope change, the
session revocation, the auth timeline event and the durable audit commit together or not at all.

A failure is injected at each LATER step of every operation (after the authority rows were already
written inside the transaction). Afterwards the stored state must be exactly what it was: the same
roles, the same scopes, every session still live, no audit row (never an audit of a change that
rolled back) and no timeline event.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest

from app.models import User
from app.repositories.auth import SessionRepository
from app.services.auth_audit import AuthAuditService
from app.services.staff_audit import StaffAuditService
from tests.db.auth_helpers import AuthEnv, make_account
from tests.db.staff_helpers import (
    DIRECTORY,
    EDUCATION,
    FOOD,
    REASON,
    candidate,
    live_session,
    live_sessions,
    open_sessions,
    roles_of,
    scopes_of,
    service,
    snapshot,
)


class Injected(RuntimeError):
    """The simulated failure."""


@dataclass(frozen=True)
class Case:
    name: str
    #: builds the world and returns (the target, the operation to attempt)
    build: Callable[[AuthEnv], tuple[User, Callable[[], object]]]
    #: does the operation write an auth timeline event? (only role grants / revocations do)
    writes_timeline: bool


def acting_as(actor_id: uuid.UUID) -> uuid.UUID:
    """The actor's one acting session, created when the actor is (so that no operation under test
    adds a row of its own to what is compared before and after)."""
    return _ACTING[actor_id]


_ACTING: dict[uuid.UUID, uuid.UUID] = {}


def _admin(env: AuthEnv, email: str = "actor@example.org") -> User:
    actor = make_account(env.session, email, admin=True)
    _ACTING[actor.id] = live_session(env.session, actor.id)
    return actor


def _moderator(env: AuthEnv, actor: User, email: str, scopes: Any = (FOOD, DIRECTORY)) -> User:
    user = candidate(env, email)
    service(env.session, env.clock).appoint_moderator(
        actor.id, user.email, scopes, session_id=acting_as(actor.id)
    )
    open_sessions(
        env, user.email, 2
    )  # live sessions AFTER the setup operation revoked the old ones
    return user


def appoint(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    actor, user = _admin(env), candidate(env, "t-appoint@example.org")
    open_sessions(env, user.email, 2)
    return user, lambda: service(env.session, env.clock).appoint_moderator(
        actor.id, user.email, [FOOD], session_id=acting_as(actor.id)
    )


def replace(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    actor = _admin(env)
    user = _moderator(env, actor, "t-replace@example.org")
    return user, lambda: service(env.session, env.clock).replace_scopes(
        actor.id, user.id, [EDUCATION, FOOD], session_id=acting_as(actor.id)
    )


def pause(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    actor = _admin(env)
    user = _moderator(env, actor, "t-pause@example.org")
    return user, lambda: service(env.session, env.clock).pause_moderator(
        actor.id, user.id, session_id=acting_as(actor.id)
    )


def resume(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    actor = _admin(env)
    user = _moderator(env, actor, "t-resume@example.org")
    service(env.session, env.clock).pause_moderator(
        actor.id, user.id, session_id=acting_as(actor.id)
    )
    open_sessions(env, user.email, 2)
    return user, lambda: service(env.session, env.clock).resume_moderator(
        actor.id, user.id, [FOOD], session_id=acting_as(actor.id)
    )


def remove(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    actor = _admin(env)
    user = _moderator(env, actor, "t-remove@example.org")
    return user, lambda: service(env.session, env.clock).remove_moderator(
        actor.id, user.id, session_id=acting_as(actor.id)
    )


def promote(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    user = candidate(env, "t-promote@example.org")
    open_sessions(env, user.email, 2)
    return user, lambda: service(env.session, env.clock).promote_super_admin(user.email, REASON)


def promote_a_moderator(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    actor = _admin(env)
    user = _moderator(env, actor, "t-promote-mod@example.org")
    return user, lambda: service(env.session, env.clock).promote_super_admin(user.email, REASON)


def demote(env: AuthEnv) -> tuple[User, Callable[[], object]]:
    # neither is an acting web user (demotion is an operator command): no acting session, or the
    # target would hold a third one
    make_account(env.session, "keeper@example.org", admin=True)
    user = make_account(env.session, "t-demote@example.org", admin=True)
    open_sessions(env, user.email, 2)
    return user, lambda: service(env.session, env.clock).demote_super_admin(user.email, REASON)


CASES = [
    Case("appoint", appoint, True),
    Case("replace-scopes", replace, False),
    Case("pause", pause, False),
    Case("resume", resume, False),
    Case("remove", remove, True),
    Case("promote", promote, True),
    Case("promote-a-moderator", promote_a_moderator, True),
    Case("demote", demote, True),
]
IDS = [case.name for case in CASES]


def inject(monkeypatch: pytest.MonkeyPatch, step: str) -> None:
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise Injected(step)

    targets = {
        "session-revocation": (SessionRepository, "revoke_all_for_user"),
        "auth-timeline-event": (AuthAuditService, "record"),
        "staff-audit": (StaffAuditService, "record"),
    }
    owner, name = targets[step]
    monkeypatch.setattr(owner, name, boom)


@pytest.mark.parametrize("step", ["session-revocation", "auth-timeline-event", "staff-audit"])
@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_a_failure_after_the_authority_rows_were_written_rolls_everything_back(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch, case: Case, step: str
) -> None:
    if step == "auth-timeline-event" and not case.writes_timeline:
        pytest.skip("this operation writes no timeline event")
    target, operation = case.build(auth_env)
    before = snapshot(auth_env.session, target.id)
    assert live_sessions(auth_env.session, target.id) == 2  # the sessions the failure must spare
    inject(monkeypatch, step)

    with pytest.raises(Injected):
        operation()

    assert snapshot(auth_env.session, target.id) == before
    assert live_sessions(auth_env.session, target.id) == 2


def test_a_rolled_back_appointment_never_leaves_a_role_without_scopes(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The headline atomicity rule: not even for an instant (or after a crash) does a Moderator
    role exist with zero scopes because an appointment half-completed."""
    target, operation = appoint(auth_env)
    inject(monkeypatch, "staff-audit")

    with pytest.raises(Injected):
        operation()

    assert roles_of(auth_env.session, target.id) == set()
    assert scopes_of(auth_env.session, target.id) == []


def test_a_rolled_back_promotion_keeps_the_moderators_role_and_scopes(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    target, operation = promote_a_moderator(auth_env)
    inject(monkeypatch, "staff-audit")

    with pytest.raises(Injected):
        operation()

    assert roles_of(auth_env.session, target.id) == {"moderator"}  # NOT admin, NOT nothing
    assert scopes_of(auth_env.session, target.id) == ["directory", "food"]


def test_a_refused_operation_leaves_no_trace_either(auth_env: AuthEnv) -> None:
    """Atomicity includes refusals: nothing was written before the check that refused."""
    actor = _admin(auth_env)
    target = candidate(auth_env, "refused@example.org", verified=False)
    before = snapshot(auth_env.session, target.id)

    with pytest.raises(Exception, match="cannot be given a staff role"):
        service(auth_env.session, auth_env.clock).appoint_moderator(
            actor.id, target.email, [FOOD], session_id=acting_as(actor.id)
        )

    assert snapshot(auth_env.session, target.id) == before


def test_the_failure_cases_cover_every_web_and_cli_operation() -> None:
    assert set(IDS) == {
        "appoint",
        "replace-scopes",
        "pause",
        "resume",
        "remove",
        "promote",
        "promote-a-moderator",
        "demote",
    }
    assert uuid.UUID(int=0)  # (keeps the module's imports honest)
