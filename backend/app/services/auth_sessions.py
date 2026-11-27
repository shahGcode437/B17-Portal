"""Server-side sessions (docs/backend/AUTH_RBAC.md §4).

A session is an opaque 256-bit secret in an HttpOnly cookie; the database holds only its SHA-256.
This service creates, validates, slides, rotates and revokes sessions.

Transaction ownership: the *mutating* methods (``create``, ``revoke_*``, ``rotate``) run inside the
caller's transaction — the auth service commits once, atomically with the rest of the operation
(register + token + session, login + cap revocations + audit, ...). The one exception is
:meth:`authenticate`, which owns a deliberately tiny transaction for the throttled ``last_seen``
write: it happens at most once per :data:`LAST_SEEN_INTERVAL` per session, and only when a request
is authenticated, so authenticated GETs do not write on every call.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.security.tokens import hash_token, is_well_formed_token, new_token
from app.db.session import transaction
from app.models import AuthSession, User
from app.models.enums import (
    AuthEventType,
    PlanCode,
    RoleName,
    SessionRevokeReason,
    StaffScope,
    UserStatus,
)
from app.repositories.auth import SessionRepository, UserAuthRepository
from app.services.auth_audit import AuthAuditService
from app.services.staff_scopes import (
    GROCERY_SCOPE,
    LISTING_STAFF_SCOPES,
    effective_staff_scopes,
)

#: ``last_seen_at`` (and the sliding idle expiry) is written at most this often per session.
LAST_SEEN_INTERVAL = timedelta(minutes=5)
_USER_AGENT_LENGTH = 200


def _is_usable(auth_session: AuthSession, user: User, now: datetime) -> bool:
    """The one definition of a session that may still act: not revoked, not expired, and its
    account active."""
    return (
        auth_session.revoked_at is None
        and now < auth_session.expires_at
        and now < auth_session.absolute_expires_at
        and user.status == UserStatus.ACTIVE
    )


@dataclass(frozen=True)
class Principal:
    """The authenticated caller: one session lookup; no secret and no ORM object."""

    user_id: uuid.UUID
    display_name: str
    email: str
    email_verified: bool
    roles: frozenset[RoleName]
    plan_code: PlanCode | None  # set iff a professional_profiles row exists
    session_id: uuid.UUID
    session_created_at: datetime
    #: The value *before* this request touched it (admin recency must not see its own touch).
    session_last_seen_at: datetime
    session_expires_at: datetime
    #: The Moderator's LIVE, effective scope assignments (docs/backend/AUTH_RBAC.md §27.3), read
    #: from the database with the session on every request — never from a cookie or a client claim.
    #: Empty for everyone else, a Super Admin included: a Super Admin's authority is the ``admin``
    #: role itself and is never encoded as "all scopes" rows.
    staff_scopes: frozenset[StaffScope] = frozenset()

    @property
    def is_professional(self) -> bool:
        return self.plan_code is not None

    @property
    def is_super_admin(self) -> bool:
        """Holds the ``admin`` role — the stored value of the Super Admin role (not renamed)."""
        return RoleName.ADMIN in self.roles

    @property
    def is_admin(self) -> bool:
        """Compatibility alias of :attr:`is_super_admin` for existing callers."""
        return self.is_super_admin

    @property
    def is_moderator(self) -> bool:
        """Holds the ``moderator`` role. Not authority by itself: see
        :attr:`has_listing_authority` and :attr:`has_grocery_authority`."""
        return RoleName.MODERATOR in self.roles and not self.is_super_admin

    # There is deliberately no "is staff at all" property: Moderators of unrelated domains share
    # the role, so a guard must name the authority it needs (AUTH_RBAC.md §32).

    @property
    def has_listing_authority(self) -> bool:
        """Super Admin, or a Moderator with at least one LISTING scope: the front door of listing
        moderation, Provider management and portal Service Requests (the last two also require
        ``services``, proven by their services). ``grocery`` and reserved ``news`` do not count."""
        return self.is_super_admin or (
            self.is_moderator and bool(self.staff_scopes & LISTING_STAFF_SCOPES)
        )

    @property
    def has_grocery_authority(self) -> bool:
        """Super Admin, or a Moderator holding the explicit ``grocery`` scope. No other scope,
        and no number of them, implies it."""
        return self.is_super_admin or (self.is_moderator and GROCERY_SCOPE in self.staff_scopes)


@dataclass(frozen=True)
class Authentication:
    """The outcome of presenting a session token."""

    principal: Principal | None
    #: ``unknown``: no such session (or a malformed token); ``expired``: it existed but is no longer
    #: valid (expired, revoked, or its account is not active) — the caller clears the cookie.
    problem: Literal["unknown", "expired"] | None = None
    #: When the idle expiry slid forward: the new cookie ``Max-Age`` to re-issue.
    refreshed_max_age: int | None = None


class SessionService:
    def __init__(
        self, session: Session, settings: Settings, clock: Clock, audit: AuthAuditService
    ) -> None:
        self._session = session
        self._settings = settings
        self._clock = clock
        self._audit = audit
        self._sessions = SessionRepository(session)
        self._users = UserAuthRepository(session)

    # -- lifetimes -------------------------------------------------------------------------

    def _idle_expiry(self, now: datetime, absolute: datetime) -> datetime:
        return min(now + timedelta(days=self._settings.session_idle_days), absolute)

    # -- creation (caller's transaction) ----------------------------------------------------

    def create(self, user_id: uuid.UUID, user_agent: str | None) -> tuple[str, AuthSession]:
        """A fresh session with a fresh server-issued token — never a reused identifier.

        Enforces the active-session cap atomically: the user row is locked (serializing concurrent
        logins of the same user), and if the user already has the maximum number of active
        sessions the **oldest** ones are revoked (``session_cap``, one audit event each) until room
        is made. A valid login is never rejected because the cap was reached.
        """
        now = self._clock()
        self._users.lock(user_id)
        self._sessions.delete_expired_for_user(user_id, now)
        active = self._sessions.active_for_user(user_id, now)
        overflow = len(active) - (self._settings.max_sessions_per_user - 1)
        if overflow > 0:
            victims = active[:overflow]
            self._sessions.revoke([v.id for v in victims], SessionRevokeReason.SESSION_CAP, now)
            for victim in victims:
                self._audit.record(
                    AuthEventType.SESSION_REVOKED,
                    user_id=user_id,
                    details={"reason": SessionRevokeReason.SESSION_CAP, "session_id": victim.id},
                )
        raw = new_token()
        absolute = now + timedelta(days=self._settings.session_absolute_days)
        auth_session = AuthSession(
            user_id=user_id,
            token_hash=hash_token(raw),
            created_at=now,
            last_seen_at=now,
            expires_at=self._idle_expiry(now, absolute),
            absolute_expires_at=absolute,
            user_agent=user_agent[:_USER_AGENT_LENGTH] if user_agent else None,
        )
        self._sessions.add(auth_session)
        return raw, auth_session

    # -- re-validation (caller's transaction) -----------------------------------------------

    def require_live(self, user: User | None, session_id: uuid.UUID) -> None:
        """For a change to how an account signs in, decided INSIDE its transaction.

        Authentication happened before this transaction, so the session may have been revoked
        since. The caller has just locked and re-read ``user`` (``FOR UPDATE``); this locks the
        requesting session too and insists it is still usable now, else ``401
        session_expired``."""
        found = None if user is None else self._sessions.lock_one(session_id, user.id)
        if user is None or found is None or not _is_usable(found, user, self._clock()):
            raise AppError(ErrorCode.SESSION_EXPIRED, status_code=401)

    # -- revocation (caller's transaction) ---------------------------------------------------

    def revoke(self, session_id: uuid.UUID, reason: SessionRevokeReason) -> None:
        self._sessions.revoke([session_id], reason, self._clock())

    def revoke_all(
        self,
        user_id: uuid.UUID,
        reason: SessionRevokeReason,
        *,
        except_session_id: uuid.UUID | None = None,
    ) -> list[uuid.UUID]:
        return self._sessions.revoke_all_for_user(
            user_id, reason, self._clock(), except_session_id=except_session_id
        )

    def rotate(self, session_id: uuid.UUID) -> tuple[str, datetime]:
        """New token for the same session (same row, same absolute lifetime). Old token dies."""
        now = self._clock()
        auth_session = self._session.get(AuthSession, session_id)
        assert auth_session is not None
        raw = new_token()
        expires = self._idle_expiry(now, auth_session.absolute_expires_at)
        self._sessions.rotate(session_id, hash_token(raw), now, expires)
        return raw, expires

    def restore_activity(self, principal: "Principal") -> None:
        """Undo this request's ``last_seen`` slide (used when an admin request is refused as stale).

        A refused request must not count as activity, otherwise one rejected attempt would make the
        very next one pass the idle check. Runs in its own tiny transaction like the touch it
        reverses.
        """
        previous = principal.session_last_seen_at
        absolute = principal.session_created_at + timedelta(
            days=self._settings.session_absolute_days
        )
        with transaction(self._session):
            self._sessions.touch(
                principal.session_id, previous, self._idle_expiry(previous, absolute)
            )

    # -- authentication ------------------------------------------------------------------------

    def principal_for_new(self, auth_session: AuthSession, user: User) -> Principal:
        """The principal of a session this request just created (roles/plan are looked up)."""
        roles, plan_code = self._sessions.roles_and_plan(user.id)
        return self.principal_for(
            auth_session, user, plan_code, roles, staff_scopes=self._staff_scopes(user.id, roles)
        )

    def _staff_scopes(self, user_id: uuid.UUID, roles: list[RoleName]) -> frozenset[StaffScope]:
        """Live scopes of a Moderator; no query at all for anyone who is not one. A Super Admin has
        none by definition (the roles are mutually exclusive, and ``admin`` wins if a corrupt state
        ever held both)."""
        if RoleName.MODERATOR not in roles or RoleName.ADMIN in roles:
            return frozenset()
        return effective_staff_scopes(self._sessions.moderator_scopes(user_id))

    def principal_for(
        self,
        auth_session: AuthSession,
        user: User,
        plan_code: PlanCode | None,
        roles: list[RoleName],
        *,
        staff_scopes: frozenset[StaffScope] = frozenset(),
        last_seen_before: datetime | None = None,
        expires_at: datetime | None = None,
    ) -> Principal:
        return Principal(
            user_id=user.id,
            display_name=user.display_name,
            email=user.email,
            email_verified=user.email_verified_at is not None,
            roles=frozenset(roles),
            plan_code=plan_code,
            session_id=auth_session.id,
            session_created_at=auth_session.created_at,
            session_last_seen_at=last_seen_before or auth_session.last_seen_at,
            session_expires_at=expires_at or auth_session.expires_at,
            staff_scopes=staff_scopes,
        )

    def authenticate(self, raw_token: str | None) -> Authentication:
        """Resolve a cookie token to a principal, sliding the idle expiry at most every 5 min."""
        if raw_token is None or not is_well_formed_token(raw_token):
            return Authentication(None, "unknown" if raw_token is not None else None)
        found = self._sessions.get_with_account(hash_token(raw_token))
        if found is None:
            return Authentication(None, "unknown")
        auth_session, user, plan_code, roles = found
        now = self._clock()
        if not _is_usable(auth_session, user, now):
            return Authentication(None, "expired")

        last_seen_before = auth_session.last_seen_at
        expires_at = auth_session.expires_at
        refreshed: int | None = None
        if now - last_seen_before >= LAST_SEEN_INTERVAL:
            expires_at = self._idle_expiry(now, auth_session.absolute_expires_at)
            with transaction(self._session):  # the one small, explicit authentication transaction
                self._sessions.touch(auth_session.id, now, expires_at)
            refreshed = max(1, int((expires_at - now).total_seconds()))
        principal = self.principal_for(
            auth_session,
            user,
            plan_code,
            roles,
            staff_scopes=self._staff_scopes(user.id, roles),
            last_seen_before=last_seen_before,
            expires_at=expires_at,
        )
        return Authentication(principal, None, refreshed)
