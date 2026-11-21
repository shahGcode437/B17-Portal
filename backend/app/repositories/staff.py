"""Persistence for staff authority (RBAC-A / RBAC-B). ``add`` + ``flush`` and locking reads only —
**never commits** (BACKEND_ARCHITECTURE.md §5): a staff audit row commits or rolls back with the
action it records, and the authority locks live exactly as long as the decision transaction.

``StaffAuditRepository`` has deliberately no update or delete method: the table is append-only (a
database trigger enforces it too).

``StaffAuthorityRepository`` reads the rows a privileged decision rests on **and locks them**, so
the answer cannot change before the decision commits (``AUTH_RBAC.md §27.4``, §28). The lock order
is part of its contract — see :class:`StaffAuthorityRepository`.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import StaffAuditEvent, StaffScopeAssignment, User, UserRole
from app.models.enums import CategoryModule, RoleName


class StaffAuditRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, event: StaffAuditEvent) -> StaffAuditEvent:
        self._session.add(event)
        self._session.flush()
        return event


class StaffAuthorityRepository:
    """Locking reads of one actor's authority rows. Call them in THIS order, once per decision:

    1. :meth:`key_share_user`     — ``users``                   ``FOR KEY SHARE``
    2. :meth:`share_staff_roles`  — ``user_roles``              ``FOR SHARE``
    3. :meth:`share_moderator_scope` — ``staff_scope_assignments`` ``FOR SHARE``

    That is the same direction every staff mutation takes (``users`` → ``user_roles`` →
    ``staff_scope_assignments``; ``AdminRoleService`` already locks the ``users`` row ``FOR
    UPDATE`` before it grants or revokes a role, and RBAC-C must do the same), so a decision and a
    role change can never wait on each other in a cycle. Step 1 exists for exactly that reason: a
    decision's history row has a foreign key to ``users``, and the foreign-key check takes ``FOR
    KEY SHARE`` on the actor's ``users`` row — taken LAST it would conflict with a role change's
    ``FOR UPDATE`` while that change waits for the ``user_roles`` lock the decision already holds.
    Taking it FIRST means a role change either waits before the decision holds anything else, or
    the decision waits before it holds any authority row.

    A concurrent ``DELETE`` (revoke, demotion, role removal with its cascade) of a locked row waits
    until the decision commits or rolls back; a revoke that committed first is simply not found.
    Under READ COMMITTED a ``SELECT ... FOR SHARE`` that waited re-reads the latest committed row,
    so both orders linearise.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def key_share_user(self, user_id: uuid.UUID) -> bool:
        """``SELECT ... FOR KEY SHARE`` on the actor's ``users`` row; whether the user exists.
        Blocks a role change that holds ``FOR UPDATE`` on it until that change commits."""
        found = self._session.scalar(
            select(User.id).where(User.id == user_id).with_for_update(read=True, key_share=True)
        )
        return found is not None

    def share_staff_roles(self, user_id: uuid.UUID) -> frozenset[RoleName]:
        """The actor's CURRENT staff roles (``admin`` and / or ``moderator``), their ``user_roles``
        rows locked ``FOR SHARE`` until the transaction ends. At most one row can exist (the
        partial unique index ``uq_user_roles_one_staff_role``)."""
        rows = self._session.scalars(
            select(UserRole.role)
            .where(
                UserRole.user_id == user_id,
                UserRole.role.in_((RoleName.ADMIN, RoleName.MODERATOR)),
            )
            .order_by(UserRole.role)
            .with_for_update(read=True)
        )
        return frozenset(rows)

    def share_moderator_scope(self, user_id: uuid.UUID, scope: CategoryModule) -> bool:
        """Whether the actor holds ``scope`` RIGHT NOW; the one assignment row that proves it is
        locked ``FOR SHARE`` until the transaction ends, so a revoke waits for the decision."""
        found = self._session.scalars(
            select(StaffScopeAssignment.scope)
            .where(
                StaffScopeAssignment.user_id == user_id,
                StaffScopeAssignment.scope == scope,
            )
            .with_for_update(read=True)
        ).one_or_none()
        return found is not None
