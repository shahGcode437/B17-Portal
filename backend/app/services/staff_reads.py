"""The Super Admin roster and audit reads (RBAC-C). Read-only; Super Admin routes only.

The roster answers with the minimum an administrator needs to manage staff — identity, role,
scopes, whether the account is usable and who granted the role — built from explicit fields, never
from the ORM object, so nothing secret can ride along. The audit is the durable
``staff_audit_events`` table read newest-first with bounded pages and optional filters; the API has
no write path to it (the table is append-only, and its repository has no update or delete).
"""

import uuid

from sqlalchemy.orm import Session

from app.models import StaffAuditEvent, User, UserRole
from app.models.enums import RoleName, StaffScope
from app.repositories.staff import AuditFilters, StaffReadRepository
from app.schemas.staff import (
    StaffAuditEntry,
    StaffAuditQuery,
    StaffGrantor,
    StaffMember,
    StaffPerson,
)
from app.services.staff_rules import StaffAuthorityError, StaffCode


def _member(
    role: UserRole,
    user: User,
    scopes: list[StaffScope],
    names: dict[uuid.UUID, str],
) -> StaffMember:
    grantor = names.get(role.granted_by) if role.granted_by is not None else None
    return StaffMember(
        user_id=user.id,
        display_name=user.display_name,
        email=user.email,
        role=role.role,
        scopes=scopes if role.role is RoleName.MODERATOR else [],
        paused=role.role is RoleName.MODERATOR and not scopes,
        account_status=user.status,
        email_verified=user.email_verified_at is not None,
        granted_at=role.granted_at,
        granted_by=(
            StaffGrantor(user_id=role.granted_by, display_name=grantor)
            if role.granted_by is not None and grantor is not None
            else None
        ),
    )


def _person(user_id: uuid.UUID | None, names: dict[uuid.UUID, str]) -> StaffPerson | None:
    return (
        None if user_id is None else StaffPerson(user_id=user_id, display_name=names.get(user_id))
    )


class StaffReadService:
    def __init__(self, session: Session) -> None:
        self._repository = StaffReadRepository(session)

    def roster(self, limit: int, offset: int) -> tuple[list[StaffMember], int]:
        rows, total = self._repository.roster_page(limit, offset)
        return self._members(rows), total

    def member(self, user_id: uuid.UUID) -> StaffMember:
        """One staff member as the roster shows them (read AFTER the change commits)."""
        row = self._repository.member(user_id)
        if row is None:  # pragma: no cover - the caller just wrote or located this member
            raise StaffAuthorityError(StaffCode.MODERATOR_NOT_FOUND, "No such moderator.")
        return self._members([row])[0]

    def audit(self, query: StaffAuditQuery) -> tuple[list[StaffAuditEntry], int]:
        events, total = self._repository.audit_page(
            AuditFilters(
                action=query.action,
                actor=query.actor,
                target=query.target,
                resource_type=query.resource,
                since=query.since,
                until=query.until,
            ),
            query.limit,
            query.offset,
        )
        ids = {
            person
            for event in events
            for person in (event.actor_user_id, event.target_user_id)
            if person is not None
        }
        names = self._repository.names_for(ids)
        return [self._entry(event, names) for event in events], total

    # -- internals ------------------------------------------------------------------------------

    def _members(self, rows: list[tuple[UserRole, User]]) -> list[StaffMember]:
        scopes = self._repository.scopes_for([user.id for _, user in rows])
        grantors = {role.granted_by for role, _ in rows if role.granted_by is not None}
        names = self._repository.names_for(grantors)
        return [_member(role, user, scopes.get(user.id, []), names) for role, user in rows]

    @staticmethod
    def _entry(event: StaffAuditEvent, names: dict[uuid.UUID, str]) -> StaffAuditEntry:
        return StaffAuditEntry(
            id=event.id,
            occurred_at=event.occurred_at,
            source=event.source,
            action=event.action,
            actor=_person(event.actor_user_id, names),
            target=_person(event.target_user_id, names),
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            before=event.before,
            after=event.after,
            reason=event.reason,
            request_id=event.request_id,
        )
