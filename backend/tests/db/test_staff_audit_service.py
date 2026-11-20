"""The staff audit writer against real PostgreSQL (RBAC-A; docs/backend/AUTH_RBAC.md §27.11).

The rules of WHAT may be written are in ``tests/test_staff_audit_unit.py``; here: what a written row
looks like, that the writer never ends the caller's transaction (an event commits or rolls back with
the action it records), that a refused record leaves nothing behind, and that a written row cannot be
changed afterwards.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.logging import request_id_var
from app.db.session import transaction
from app.models import StaffAuditEvent
from app.models.enums import (
    CategoryModule,
    RoleName,
    StaffAuditAction,
    StaffAuditResource,
    StaffAuditSource,
)
from app.services.staff_audit import StaffAuditError, StaffAuditService
from tests.db.helpers import violates

NOW = datetime(2026, 11, 19, 12, 30, tzinfo=UTC)
REASON = "Approved as the only available reviewer."


def writer(session: Session) -> StaffAuditService:
    return StaffAuditService(session, lambda: NOW)


def audit_count(session: Session) -> int:
    return int(session.scalar(select(func.count()).select_from(StaffAuditEvent)) or 0)


def test_a_recorded_event_carries_exactly_what_the_writer_was_given(db_session: Session) -> None:
    actor, target, session_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    token = request_id_var.set("req-abc123")
    try:
        event = writer(db_session).record(
            StaffAuditAction.SCOPE_GRANTED,
            source=StaffAuditSource.WEB,
            actor_user_id=actor,
            target_user_id=target,
            before={"scopes": [CategoryModule.FOOD]},
            after={
                "scopes": [CategoryModule.FOOD, CategoryModule.DIRECTORY],
                "sessions_revoked": 2,
            },
            session_id=session_id,
        )
    finally:
        request_id_var.reset(token)

    stored = db_session.get(StaffAuditEvent, event.id)
    assert stored is not None
    assert stored.action is StaffAuditAction.SCOPE_GRANTED
    assert stored.source is StaffAuditSource.WEB
    assert (stored.actor_user_id, stored.target_user_id, stored.session_id) == (
        actor,
        target,
        session_id,
    )
    assert stored.before == {"scopes": ["food"]}  # plain JSON, enums flattened
    assert stored.after == {"scopes": ["food", "directory"], "sessions_revoked": 2}
    assert stored.occurred_at == NOW  # the application clock, not the transaction start
    assert stored.request_id == "req-abc123"
    assert stored.reason is None and stored.resource_type is None


def test_a_cli_event_has_no_actor_and_a_provider_event_names_its_resource(
    db_session: Session,
) -> None:
    listing = uuid.uuid4()

    promoted = writer(db_session).record(
        StaffAuditAction.SUPER_ADMIN_PROMOTED,
        source=StaffAuditSource.CLI,
        target_user_id=uuid.uuid4(),
        after={"role": RoleName.ADMIN, "break_glass": False},
        reason="  Rotating the   second account.  ",
    )
    provider = writer(db_session).record(
        StaffAuditAction.PROVIDER_CREATED,
        source=StaffAuditSource.WEB,
        actor_user_id=uuid.uuid4(),
        resource_type=StaffAuditResource.LISTING,
        resource_id=listing,
        after={"kind": "provider", "status": "pending"},
    )

    assert promoted.actor_user_id is None and promoted.source is StaffAuditSource.CLI
    assert promoted.reason == "Rotating the second account."  # normalized
    assert provider.resource_type is StaffAuditResource.LISTING and provider.resource_id == listing


def test_the_self_override_cannot_be_recorded_without_a_reason(db_session: Session) -> None:
    with pytest.raises(StaffAuditError, match="reason is required"):
        writer(db_session).record(
            StaffAuditAction.MODERATION_SELF_OVERRIDE,
            source=StaffAuditSource.WEB,
            actor_user_id=uuid.uuid4(),
            resource_type=StaffAuditResource.LISTING,
            resource_id=uuid.uuid4(),
        )

    assert audit_count(db_session) == 0


@pytest.mark.parametrize(
    "bad_after",
    [
        {"password_hash": "$argon2id$v=19$..."},
        {"session_token": "raw-secret-token"},
        {"cookie": "b17_session=abc"},
        {"oauth_code": "4/0Abc"},
        {"unapproved": "value"},
    ],
)
def test_a_refused_record_writes_nothing_at_all(
    db_session: Session, bad_after: dict[str, object]
) -> None:
    with pytest.raises(StaffAuditError):
        writer(db_session).record(
            StaffAuditAction.SCOPE_GRANTED,
            source=StaffAuditSource.WEB,
            actor_user_id=uuid.uuid4(),
            after=bad_after,
        )

    assert audit_count(db_session) == 0  # no half-written row, and no secret ever reached the table
    assert (
        db_session.scalar(
            text(
                "SELECT count(*) FROM staff_audit_events WHERE after::text ~* 'secret|argon2|b17_session'"
            )
        )
        == 0
    )


# -- it participates in the caller's transaction and never ends it ----------------------------------


def test_the_writer_never_commits_so_the_caller_can_roll_it_back(db_session: Session) -> None:
    """If ``record`` committed, rolling back afterwards would leave the row behind."""
    writer(db_session).record(
        StaffAuditAction.MODERATOR_APPOINTED,
        source=StaffAuditSource.WEB,
        actor_user_id=uuid.uuid4(),
    )
    assert audit_count(db_session) == 1  # flushed, visible inside the transaction

    db_session.rollback()

    assert audit_count(db_session) == 0  # rolled back with everything else


def test_an_event_commits_together_with_the_action_it_records(db_session: Session) -> None:
    with transaction(db_session):
        writer(db_session).record(
            StaffAuditAction.MODERATOR_REMOVED,
            source=StaffAuditSource.WEB,
            actor_user_id=uuid.uuid4(),
        )

    assert audit_count(db_session) == 1


def test_a_failing_action_takes_its_audit_event_down_with_it(db_session: Session) -> None:
    class ActionFailed(Exception):
        pass

    with pytest.raises(ActionFailed), transaction(db_session):
        writer(db_session).record(
            StaffAuditAction.MODERATOR_REMOVED,
            source=StaffAuditSource.WEB,
            actor_user_id=uuid.uuid4(),
        )
        raise ActionFailed

    assert audit_count(db_session) == 0  # no audit record for an action that did not happen


# -- a written event cannot be changed ---------------------------------------------------------------


def test_a_recorded_event_is_immutable_even_through_the_orm(db_session: Session) -> None:
    event = writer(db_session).record(
        StaffAuditAction.SCOPE_REVOKED,
        source=StaffAuditSource.WEB,
        actor_user_id=uuid.uuid4(),
    )

    with violates(db_session, "trg_staff_audit_events_append_only"):
        event.action = StaffAuditAction.SCOPE_GRANTED
        db_session.flush()
    db_session.expire_all()
    with violates(db_session, "trg_staff_audit_events_append_only"):
        db_session.delete(db_session.get(StaffAuditEvent, event.id))
        db_session.flush()

    kept = db_session.get(StaffAuditEvent, event.id)
    assert kept is not None and kept.action is StaffAuditAction.SCOPE_REVOKED
