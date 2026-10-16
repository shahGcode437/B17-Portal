"""Granting and revoking the Admin role (docs/backend/AUTH_RBAC.md §11.6).

There is **no HTTP endpoint** for this: Admin is a backend/ops decision, performed by the
``python -m app.cli.admin`` command. Each change runs in one transaction that locks the user row,
inserts/deletes the ``user_roles`` row (never a duplicate), **revokes all of that user's sessions**
(privilege change => the user signs in again, so no pre-change session survives) and writes an
audit event.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.db.session import transaction
from app.models.enums import AuthEventType, RoleName, SessionRevokeReason, UserStatus
from app.repositories.auth import RoleRepository, SessionRepository, UserAuthRepository
from app.services.auth_audit import AuthAuditService


class AdminRoleError(Exception):
    """An operator-facing refusal (unknown account, not active, not verified, ...)."""


@dataclass(frozen=True)
class RoleChange:
    email: str
    changed: bool
    sessions_revoked: int


class AdminRoleService:
    def __init__(self, session: Session, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._users = UserAuthRepository(session)
        self._roles = RoleRepository(session)
        self._sessions = SessionRepository(session)
        self._audit = AuthAuditService(session, clock)

    def grant_admin(self, email: str) -> RoleChange:
        """The account must exist, be ``active`` and have a verified email."""
        with transaction(self._session):
            user = self._users.lock_by_email(email)
            if user is None:
                raise AdminRoleError(f"no account with email {email!r}")
            if user.status != UserStatus.ACTIVE:
                raise AdminRoleError("the account is not active")
            if user.email_verified_at is None:
                raise AdminRoleError("the account's email is not verified")
            now = self._clock()
            inserted = self._roles.grant(user.id, RoleName.ADMIN, None, now)
            if not inserted:
                return RoleChange(email, changed=False, sessions_revoked=0)
            revoked = self._sessions.revoke_all_for_user(
                user.id, SessionRevokeReason.ROLE_CHANGE, now
            )
            self._audit.record(
                AuthEventType.ROLE_GRANTED, user_id=user.id, details={"reason": RoleName.ADMIN}
            )
            return RoleChange(email, changed=True, sessions_revoked=len(revoked))

    def revoke_admin(self, email: str) -> RoleChange:
        with transaction(self._session):
            user = self._users.lock_by_email(email)
            if user is None:
                raise AdminRoleError(f"no account with email {email!r}")
            now = self._clock()
            if not self._roles.revoke(user.id, RoleName.ADMIN):
                return RoleChange(email, changed=False, sessions_revoked=0)
            revoked = self._sessions.revoke_all_for_user(
                user.id, SessionRevokeReason.ROLE_CHANGE, now
            )
            self._audit.record(
                AuthEventType.ROLE_REVOKED, user_id=user.id, details={"reason": RoleName.ADMIN}
            )
            return RoleChange(email, changed=True, sessions_revoked=len(revoked))
