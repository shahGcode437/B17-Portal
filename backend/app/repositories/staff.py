"""Persistence for staff authority (RBAC-A / RBAC-B / RBAC-C). ``add`` + ``flush`` and locking or
plain reads only — **never commits** (BACKEND_ARCHITECTURE.md §5): a staff audit row commits or
rolls back with the action it records, and the authority locks live exactly as long as the
decision or mutation transaction.

``StaffAuditRepository`` has deliberately no update or delete method: the table is append-only (a
database trigger enforces it too).

``StaffAuthorityRepository`` reads the rows a privileged DECISION rests on **and locks them**, so
the answer cannot change before the decision commits (``AUTH_RBAC.md §27.4``, §28).

``StaffManagementRepository`` is the write side of staff management (RBAC-C): the staff-authority
advisory lock, the scope-assignment rows and the usable-Super-Admin queries. Role rows are written
through ``RoleRepository`` (``repositories/auth.py``); **only ``StaffAuthorityService`` calls
either**, and a test fails if anything else does.

``StaffReadRepository`` serves the Super Admin roster and the audit API: read-only.

Lock order (frozen in RBAC-B, binding here): a decision takes ``listings`` → ``users`` →
``auth_sessions`` → ``user_roles`` → ``staff_scope_assignments``; a staff mutation takes the
staff-authority advisory lock → the ACTOR's ``users`` and session rows ``FOR SHARE`` → the target
``users`` row → ``user_roles`` → ``staff_scope_assignments`` and NEVER a listing.
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, case, delete, exists, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models import (
    AuthIdentity,
    AuthSession,
    StaffAuditEvent,
    StaffScopeAssignment,
    User,
    UserRole,
)
from app.models.enums import (
    AuthProvider,
    RoleName,
    StaffAuditAction,
    StaffAuditResource,
    StaffScope,
    UserStatus,
)

#: The one advisory-lock key of staff authority ("STAFAUTH" as a 64-bit integer; ``AUTH_RBAC.md``
#: §27.6). Every staff-authority mutation takes it first, transaction-scoped and exclusive, so
#: such mutations run one at a time — which is what makes "is this the last usable Super Admin?" a
#: question with one consistent answer. Taxonomy uses a different key, so the two never contend.
STAFF_AUTHORITY_LOCK_KEY = 0x5354414641555448


class StaffAuditRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, event: StaffAuditEvent) -> StaffAuditEvent:
        self._session.add(event)
        self._session.flush()
        return event


class StaffAuthorityRepository:
    """Locking reads of one actor's authority rows. Call them in THIS order, once per decision:

    1. :meth:`share_user`         — ``users``                   ``FOR SHARE``
    2. :meth:`share_session`      — ``auth_sessions``           ``FOR SHARE``
    3. :meth:`share_staff_roles`  — ``user_roles``              ``FOR SHARE``
    4. :meth:`share_moderator_scope` — ``staff_scope_assignments`` ``FOR SHARE``

    Steps 1 and 2 are taken together by ``auth_sessions.hold_acting_session``.

    WHY ``FOR SHARE`` and not ``FOR KEY SHARE`` on the user: a key-share lock holds back only a
    ``FOR UPDATE`` (a password reset). An update of the row itself, a suspension, passes it.
    And neither mode on the user holds back a sign-out, which writes only the session row:
    revocation is held back by the lock on that row.

    That is the same direction every staff mutation takes (``users`` → ``user_roles`` →
    ``staff_scope_assignments``; ``StaffAuthorityService`` takes the staff-authority advisory
    lock, then locks the ``users`` row ``FOR UPDATE``, before it changes a role), so a decision and
    a role change can never wait on each other in a cycle. Step 1 exists for exactly that reason: a
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

    def share_user(self, user_id: uuid.UUID) -> User | None:
        """The actor's ``users`` row ``FOR SHARE``, as stored now. Waits for, and then holds
        back, a role change or password reset (``FOR UPDATE``) and any update of the account.
        Other privileged changes and orders of the same person run alongside."""
        return self._session.scalars(
            select(User)
            .where(User.id == user_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        ).one_or_none()

    def share_session(self, user_id: uuid.UUID, session_id: uuid.UUID) -> AuthSession | None:
        """The actor's acting session ``FOR SHARE``, as stored now: its revocation, rotation
        or removal waits until this transaction ends. Only after :meth:`share_user`."""
        return self._session.scalars(
            select(AuthSession)
            .where(AuthSession.id == session_id, AuthSession.user_id == user_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        ).one_or_none()

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

    def share_moderator_scope(self, user_id: uuid.UUID, scope: StaffScope) -> bool:
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


def _has_usable_sign_in(login_providers: Collection[AuthProvider]) -> ColumnElement[bool]:
    """A way to sign in that works RIGHT NOW (``AUTH_RBAC.md §27.6``): a local password credential,
    or a linked identity whose provider can authenticate in the current configuration.

    ``login_providers`` is the set the OAuth flow itself would accept (``enabled_login_providers``).
    A stored identity of any other provider — ``google`` while Google sign-in is disabled,
    ``facebook`` / ``apple`` (stored vocabulary, no adapter) — is just a row that cannot sign
    anyone in and does NOT count. This is deliberately stricter than the identity-DISCONNECT guard,
    which only asks "is this the account's last stored method?" and is left as it was."""
    has_password = and_(User.password_hash.is_not(None), User.password_hash != "")
    if not login_providers:
        return has_password
    has_identity = exists().where(
        AuthIdentity.user_id == User.id, AuthIdentity.provider.in_(login_providers)
    )
    return or_(has_password, has_identity)


def _usable_account(login_providers: Collection[AuthProvider]) -> ColumnElement[bool]:
    """The account half of "usable Super Admin": active, e-mail verified and holding a CURRENTLY
    usable sign-in method. Staff MFA joins this once it exists."""
    return and_(
        User.status == UserStatus.ACTIVE,
        User.email_verified_at.is_not(None),
        _has_usable_sign_in(login_providers),
    )


class StaffManagementRepository:
    """The write side of staff management. Not for decisions: those use
    ``StaffAuthorityRepository`` and take their own, differently ordered locks.

    ``login_providers`` is fixed at construction and applied by EVERY "usable" query, so no caller
    can count a sign-in method that cannot currently authenticate."""

    def __init__(self, session: Session, login_providers: Collection[AuthProvider]) -> None:
        self._session = session
        self._login_providers = frozenset(login_providers)

    # -- serialisation --------------------------------------------------------------------------

    def lock_staff_authority(self) -> None:
        """``pg_advisory_xact_lock`` on the staff-authority key: waits while another staff
        mutation is in flight; released at COMMIT or ROLLBACK. Take it BEFORE any row lock."""
        self._session.execute(select(func.pg_advisory_xact_lock(STAFF_AUTHORITY_LOCK_KEY)))

    def lock_user(self, user_id: uuid.UUID) -> User | None:
        """``SELECT ... FOR UPDATE`` the target account, re-read from the database even if this
        session already holds a copy. Take it AFTER the advisory lock, BEFORE its roles."""
        return self._session.scalars(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one_or_none()

    def lock_user_by_email(self, email: str) -> User | None:
        """Like :meth:`lock_user`, by the canonical (lower-cased) e-mail address."""
        return self._session.scalars(
            select(User)
            .where(func.lower(User.email) == email)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    # -- reads ----------------------------------------------------------------------------------

    def staff_roles_of(self, user_id: uuid.UUID) -> frozenset[RoleName]:
        return frozenset(
            self._session.scalars(
                select(UserRole.role).where(
                    UserRole.user_id == user_id,
                    UserRole.role.in_((RoleName.ADMIN, RoleName.MODERATOR)),
                )
            )
        )

    def scopes_of(self, user_id: uuid.UUID) -> frozenset[StaffScope]:
        return frozenset(
            self._session.scalars(
                select(StaffScopeAssignment.scope).where(StaffScopeAssignment.user_id == user_id)
            )
        )

    def is_live_super_admin(self, user_id: uuid.UUID) -> bool:
        """Active, verified and holding ``admin`` RIGHT NOW (re-read under the advisory lock, so a
        demotion that committed after the request began is seen)."""
        count = self._session.scalar(
            select(func.count())
            .select_from(User)
            .join(UserRole, UserRole.user_id == User.id)
            .where(
                User.id == user_id,
                UserRole.role == RoleName.ADMIN,
                User.status == UserStatus.ACTIVE,
                User.email_verified_at.is_not(None),
            )
        )
        return (count or 0) > 0

    def has_sign_in_method(self, user_id: uuid.UUID) -> bool:
        """Does the account have a sign-in method that works RIGHT NOW (``_has_usable_sign_in``)?"""
        count = self._session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.id == user_id, _has_usable_sign_in(self._login_providers))
        )
        return (count or 0) > 0

    def usable_super_admin_count(self, *, excluding: uuid.UUID | None = None) -> int:
        """How many Super Admins are USABLE (not merely holding the role)."""
        statement = (
            select(func.count())
            .select_from(User)
            .join(UserRole, UserRole.user_id == User.id)
            .where(UserRole.role == RoleName.ADMIN, _usable_account(self._login_providers))
        )
        if excluding is not None:
            statement = statement.where(User.id != excluding)
        return int(self._session.scalar(statement) or 0)

    def is_usable_super_admin(self, user_id: uuid.UUID) -> bool:
        count = self._session.scalar(
            select(func.count())
            .select_from(User)
            .join(UserRole, UserRole.user_id == User.id)
            .where(
                User.id == user_id,
                UserRole.role == RoleName.ADMIN,
                _usable_account(self._login_providers),
            )
        )
        return (count or 0) > 0

    # -- writes ---------------------------------------------------------------------------------

    def add_scopes(
        self,
        user_id: uuid.UUID,
        scopes: Collection[StaffScope],
        granted_by: uuid.UUID | None,
        now: datetime,
    ) -> None:
        for scope in sorted(scopes):
            self._session.add(
                StaffScopeAssignment(
                    user_id=user_id, scope=scope, granted_by=granted_by, granted_at=now
                )
            )
        self._session.flush()

    def remove_scopes(self, user_id: uuid.UUID, scopes: Collection[StaffScope]) -> None:
        if not scopes:
            return
        self._session.execute(
            delete(StaffScopeAssignment).where(
                StaffScopeAssignment.user_id == user_id, StaffScopeAssignment.scope.in_(scopes)
            )
        )
        self._session.flush()


@dataclass(frozen=True)
class AuditFilters:
    """Every filter is optional; they AND together. None can widen what the endpoint may read."""

    action: StaffAuditAction | None = None
    actor: uuid.UUID | None = None
    target: uuid.UUID | None = None
    resource_type: StaffAuditResource | None = None
    since: datetime | None = None
    until: datetime | None = None


class StaffReadRepository:
    """Read-only queries for the Super Admin roster and audit (RBAC-C)."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def roster_page(self, limit: int, offset: int) -> tuple[list[tuple[UserRole, User]], int]:
        """Every staff member (Super Admins first, then by name), one row each: the exclusivity
        index guarantees at most one staff role per user."""
        staff = UserRole.role.in_((RoleName.ADMIN, RoleName.MODERATOR))
        total = int(
            self._session.scalar(select(func.count()).select_from(UserRole).where(staff)) or 0
        )
        rows = self._session.execute(
            select(UserRole, User)
            .join(User, User.id == UserRole.user_id)
            .where(staff)
            .order_by(
                case((UserRole.role == RoleName.ADMIN, 0), else_=1),
                func.lower(User.display_name),
                User.id,
            )
            .limit(limit)
            .offset(offset)
        ).all()
        return [(role, user) for role, user in rows], total

    def member(self, user_id: uuid.UUID) -> tuple[UserRole, User] | None:
        row = self._session.execute(
            select(UserRole, User)
            .join(User, User.id == UserRole.user_id)
            .where(
                User.id == user_id,
                UserRole.role.in_((RoleName.ADMIN, RoleName.MODERATOR)),
            )
            .execution_options(populate_existing=True)
        ).first()
        return None if row is None else (row[0], row[1])

    def scopes_for(self, user_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[StaffScope]]:
        grouped: dict[uuid.UUID, list[StaffScope]] = {}
        if not user_ids:
            return grouped
        for user_id, scope in self._session.execute(
            select(StaffScopeAssignment.user_id, StaffScopeAssignment.scope)
            .where(StaffScopeAssignment.user_id.in_(user_ids))
            .order_by(StaffScopeAssignment.scope)
        ):
            grouped.setdefault(user_id, []).append(scope)
        return grouped

    def names_for(self, user_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not user_ids:
            return {}
        return {
            user_id: name
            for user_id, name in self._session.execute(
                select(User.id, User.display_name).where(User.id.in_(user_ids))
            )
        }

    def audit_page(
        self, filters: AuditFilters, limit: int, offset: int
    ) -> tuple[list[StaffAuditEvent], int]:
        """One page of the audit, newest first (ties broken by id so pages are stable)."""
        conditions = []
        if filters.action is not None:
            conditions.append(StaffAuditEvent.action == filters.action)
        if filters.actor is not None:
            conditions.append(StaffAuditEvent.actor_user_id == filters.actor)
        if filters.target is not None:
            conditions.append(StaffAuditEvent.target_user_id == filters.target)
        if filters.resource_type is not None:
            conditions.append(StaffAuditEvent.resource_type == filters.resource_type)
        if filters.since is not None:
            conditions.append(StaffAuditEvent.occurred_at >= filters.since)
        if filters.until is not None:
            conditions.append(StaffAuditEvent.occurred_at <= filters.until)
        total = int(
            self._session.scalar(
                select(func.count()).select_from(StaffAuditEvent).where(*conditions)
            )
            or 0
        )
        rows = self._session.scalars(
            select(StaffAuditEvent)
            .where(*conditions)
            .order_by(StaffAuditEvent.occurred_at.desc(), StaffAuditEvent.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(rows), total
