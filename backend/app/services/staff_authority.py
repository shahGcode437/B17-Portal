"""The ONE shared staff-authority service (RBAC-C; docs/backend/AUTH_RBAC.md §27.2, §27.6, §27.7).

Every change to who holds the ``admin`` (Super Admin) or ``moderator`` role, and to a Moderator's
scope assignments, goes through this class — the HTTP staff-management routes and the operator CLI
alike. Nothing else in ``app/`` writes ``user_roles`` or ``staff_scope_assignments`` (a test fails
if anything does), so the invariants below have exactly one place to hold.

One operation = ONE database transaction that contains every effect:

    advisory lock → (web) the actor and acting session → target row lock → re-read eligibility
    → role / scope change
    → revoke the target's sessions → auth timeline event (role changes) → durable staff audit
    → COMMIT

If any step fails nothing changes: no role, no scope, no revoked session, no audit row, no auth
event. An audit row is never written for a change that rolled back, and a change is never
committed without its audit row.

LOCK ORDER (binding; frozen in RBAC-B)::

    staff-authority advisory lock  →  [web: users (actor, SHARE)  →  auth_sessions (acting,
                                       SHARE)]
                                   →  users (target, FOR UPDATE)  →  user_roles
                                   →  staff_scope_assignments

A web change re-reads under those two locks that the acting session is still usable
(AUTH_RBAC.md §36). Only staff mutations hold two users' rows, and the advisory lock lets one
run at a time; when actor and target are one account the second lock upgrades the first.

A staff mutation NEVER locks a listing. A moderation decision takes ``listings → users (SHARE) →
auth_sessions → user_roles → staff_scope_assignments``; the two walk ``users → user_roles → scopes``
in the same direction and share no lock held while waiting for the other, so they cannot deadlock.
The advisory lock is taken FIRST and is exclusive, so staff mutations run one at a time: that is
what gives "is this the last usable Super Admin?" one consistent answer even for concurrent mutual
demotions.

WEB operations (a Super Admin; ``source = web``, with the actor) manage MODERATORS only. A Super
Admin target is refused (``super_admin_target_forbidden``); promotion and demotion exist only as
CLI operations here (``source = cli``, no actor, a mandatory reason) — there is no web path.

SESSIONS. Every authority change revokes ALL of the target's sessions with the existing
``role_change`` reason (the account's staff authority changed): an elevation must never silently
reach an old session, and a reduction is already enforced by the live per-request check, so the
revocation is defence in depth.

ENUMERATION. Appointment by e-mail answers ``target_not_eligible`` for an unknown address AND for
every ineligible state, so the endpoint is not an account-existence oracle; an id the Super Admin
got from the roster answers ``moderator_not_found`` for a non-Moderator and a nonexistent id alike.

Not covered (and reported rather than assumed): no application path currently suspends or
tombstones an account, so the last-usable-Super-Admin guard is wired into demotion only.
:meth:`guard_last_usable_super_admin` is the hook a future suspend / delete path MUST call.
"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import HOSTED_ENVIRONMENTS, Settings
from app.core.security.identity import canonical_email
from app.db.session import transaction
from app.models import User
from app.models.enums import (
    AuthEventType,
    AuthProvider,
    RoleName,
    SessionRevokeReason,
    StaffAuditAction,
    StaffAuditSource,
    StaffScope,
    UserStatus,
)
from app.repositories.auth import RoleRepository, SessionRepository
from app.repositories.staff import StaffAuthorityRepository, StaffManagementRepository
from app.services.auth_audit import AuthAuditService
from app.services.auth_sessions import hold_acting_session
from app.services.oauth import enabled_login_providers
from app.services.staff_audit import StaffAuditService
from app.services.staff_rules import (
    NORMAL_SUPER_ADMIN_TARGET,
    StaffAuthorityError,
    StaffCode,
    clean_reason,
    decide_promotion,
    is_reserved_identity,
    validate_scopes,
)


@dataclass(frozen=True)
class StaffPolicy:
    """The environment-dependent part of the rules, fixed at construction."""

    #: Staging / production: refuse fixture, demo and reserved-TLD identities for staff grants.
    hosted: bool
    #: The most usable Super Admins a promotion may create without break-glass.
    safety_ceiling: int
    #: The login providers that can authenticate RIGHT NOW (``enabled_login_providers``). A linked
    #: identity of any other provider is not a sign-in method, so it never makes a Super Admin
    #: "usable". Required (no default): a caller must decide, and the empty set is a real answer
    #: ("password only").
    login_providers: frozenset[AuthProvider]

    @classmethod
    def from_settings(cls, settings: Settings) -> "StaffPolicy":
        """The policy of THIS process's configuration. The CLI must therefore run with the same
        environment as the API: with Google sign-in off it judges a Google-only Super Admin
        unusable, which can only make it refuse a demotion, never allow an unsafe one."""
        return cls(
            hosted=settings.environment in HOSTED_ENVIRONMENTS,
            safety_ceiling=settings.super_admin_safety_ceiling,
            login_providers=enabled_login_providers(settings),
        )


@dataclass(frozen=True)
class StaffChange:
    """What an operation did. ``changed`` is ``False`` for a harmless no-op (nothing written)."""

    user_id: uuid.UUID
    email: str
    changed: bool
    sessions_revoked: int = 0
    #: An operator warning (the Super Admin count is above the normal target), or ``None``.
    warning: str | None = None


def _state(
    role: RoleName | None, scopes: Collection[StaffScope], **extra: object
) -> dict[str, object]:
    """An allow-listed audit payload for a role / scope state."""
    return {
        "role": role.value if role else None,
        "scopes": sorted(s.value for s in scopes),
        **extra,
    }


class StaffAuthorityService:
    def __init__(self, session: Session, clock: Clock, policy: StaffPolicy) -> None:
        self._session = session
        self._clock = clock
        self._policy = policy
        self._roles = RoleRepository(session)
        self._sessions = SessionRepository(session)
        self._staff = StaffManagementRepository(session, policy.login_providers)
        self._auth_audit = AuthAuditService(session, clock)
        self._audit = StaffAuditService(session, clock)

    # ==== web: manage Moderators ==================================================================

    def appoint_moderator(
        self,
        actor_id: uuid.UUID,
        email: str,
        scopes: Collection[StaffScope],
        *,
        session_id: uuid.UUID,
    ) -> StaffChange:
        """Make an existing, active, verified account a Moderator with ``scopes`` (at least one,
        assignable). A Professional profile is NOT required."""
        wanted = validate_scopes(scopes)
        with transaction(self._session):
            self._begin_web(actor_id, session_id)
            user = self._staff.lock_user_by_email(canonical_email(email))
            if user is None or not self._eligible(user):
                raise self._not_eligible()
            roles = self._staff.staff_roles_of(user.id)
            if RoleName.ADMIN in roles:
                raise self._super_admin_target()
            if RoleName.MODERATOR in roles:
                raise StaffAuthorityError(
                    StaffCode.ALREADY_MODERATOR,
                    "That account is already a Moderator. Change its scopes instead.",
                )
            now = self._clock()
            self._roles.grant(user.id, RoleName.MODERATOR, actor_id, now)
            self._staff.add_scopes(user.id, wanted, actor_id, now)
            revoked = self._revoke_sessions(user.id, now)
            self._auth_audit.record(
                AuthEventType.ROLE_GRANTED,
                user_id=user.id,
                actor_user_id=actor_id,
                details={"reason": RoleName.MODERATOR},
            )
            self._audit.record(
                StaffAuditAction.MODERATOR_APPOINTED,
                source=StaffAuditSource.WEB,
                actor_user_id=actor_id,
                target_user_id=user.id,
                before=_state(None, ()),
                after=_state(RoleName.MODERATOR, wanted, paused=False, sessions_revoked=revoked),
            )
            return StaffChange(user.id, user.email, True, revoked)

    def replace_scopes(
        self,
        actor_id: uuid.UUID,
        user_id: uuid.UUID,
        scopes: Collection[StaffScope],
        *,
        session_id: uuid.UUID,
    ) -> StaffChange:
        """Replace an ACTIVE Moderator's scope set (replace-set semantics, atomic). An identical
        set changes nothing (no session revocation, no audit). A paused Moderator is resumed, not
        updated, and an empty set is a pause: both have their own operation."""
        wanted = validate_scopes(scopes)
        with transaction(self._session):
            self._begin_web(actor_id, session_id)
            user, current = self._moderator_target(user_id)
            if not current:
                raise StaffAuthorityError(
                    StaffCode.MODERATOR_PAUSED,
                    "That Moderator is paused. Resume them with scopes instead.",
                )
            if wanted == current:
                return StaffChange(user.id, user.email, False)
            added, removed = wanted - current, current - wanted
            now = self._clock()
            self._staff.remove_scopes(user.id, removed)
            self._staff.add_scopes(user.id, added, actor_id, now)
            revoked = self._revoke_sessions(user.id, now)
            before = _state(RoleName.MODERATOR, current, paused=False)
            after = _state(RoleName.MODERATOR, wanted, paused=False, sessions_revoked=revoked)
            for action, happened in (
                (StaffAuditAction.SCOPE_GRANTED, added),
                (StaffAuditAction.SCOPE_REVOKED, removed),
            ):
                if happened:
                    self._audit.record(
                        action,
                        source=StaffAuditSource.WEB,
                        actor_user_id=actor_id,
                        target_user_id=user.id,
                        before=before,
                        after=after,
                    )
            return StaffChange(user.id, user.email, True, revoked)

    def pause_moderator(
        self, actor_id: uuid.UUID, user_id: uuid.UUID, *, session_id: uuid.UUID
    ) -> StaffChange:
        """Keep the ``moderator`` role, delete EVERY scope, revoke every session. A Moderator with
        zero scopes has zero staff authority (``require_staff`` refuses them)."""
        with transaction(self._session):
            self._begin_web(actor_id, session_id)
            user, current = self._moderator_target(user_id)
            if not current:
                raise StaffAuthorityError(
                    StaffCode.MODERATOR_ALREADY_PAUSED, "That Moderator is already paused."
                )
            self._staff.remove_scopes(user.id, current)
            revoked = self._revoke_sessions(user.id, self._clock())
            self._audit.record(
                StaffAuditAction.MODERATOR_PAUSED,
                source=StaffAuditSource.WEB,
                actor_user_id=actor_id,
                target_user_id=user.id,
                before=_state(RoleName.MODERATOR, current, paused=False),
                after=_state(RoleName.MODERATOR, (), paused=True, sessions_revoked=revoked),
            )
            return StaffChange(user.id, user.email, True, revoked)

    def resume_moderator(
        self,
        actor_id: uuid.UUID,
        user_id: uuid.UUID,
        scopes: Collection[StaffScope],
        *,
        session_id: uuid.UUID,
    ) -> StaffChange:
        """Give a PAUSED Moderator scopes again (at least one, assignable), after the same
        eligibility checks as an appointment. Recorded as ``scope_granted`` from a paused state:
        ``before.paused = true`` / ``after.paused = false`` makes it unambiguous in the audit."""
        wanted = validate_scopes(scopes)
        with transaction(self._session):
            self._begin_web(actor_id, session_id)
            user, current = self._moderator_target(user_id)
            if current:
                raise StaffAuthorityError(
                    StaffCode.MODERATOR_NOT_PAUSED, "That Moderator is not paused."
                )
            if not self._eligible(user):
                raise self._not_eligible()
            now = self._clock()
            self._staff.add_scopes(user.id, wanted, actor_id, now)
            revoked = self._revoke_sessions(user.id, now)
            self._audit.record(
                StaffAuditAction.SCOPE_GRANTED,
                source=StaffAuditSource.WEB,
                actor_user_id=actor_id,
                target_user_id=user.id,
                before=_state(RoleName.MODERATOR, (), paused=True),
                after=_state(RoleName.MODERATOR, wanted, paused=False, sessions_revoked=revoked),
            )
            return StaffChange(user.id, user.email, True, revoked)

    def remove_moderator(
        self, actor_id: uuid.UUID, user_id: uuid.UUID, *, session_id: uuid.UUID
    ) -> StaffChange:
        """Delete the ``moderator`` role (its scopes cascade) and revoke every session. The account
        itself is untouched: never a user deletion."""
        with transaction(self._session):
            self._begin_web(actor_id, session_id)
            user, current = self._moderator_target(user_id)
            self._roles.revoke(user.id, RoleName.MODERATOR)
            revoked = self._revoke_sessions(user.id, self._clock())
            self._auth_audit.record(
                AuthEventType.ROLE_REVOKED,
                user_id=user.id,
                actor_user_id=actor_id,
                details={"reason": RoleName.MODERATOR},
            )
            self._audit.record(
                StaffAuditAction.MODERATOR_REMOVED,
                source=StaffAuditSource.WEB,
                actor_user_id=actor_id,
                target_user_id=user.id,
                before=_state(RoleName.MODERATOR, current, paused=not current),
                after=_state(None, (), sessions_revoked=revoked),
            )
            return StaffChange(user.id, user.email, True, revoked)

    # ==== operator CLI: Super Admin promotion / demotion ==========================================

    def promote_super_admin(
        self,
        email: str,
        reason: str,
        *,
        override_policy: bool = False,
        break_glass: bool = False,
    ) -> StaffChange:
        """Grant ``admin``. Needs an explicit reason; the target must be active, verified, able to
        sign in and (hosted) not a fixture / demo / reserved identity. A Moderator target loses the
        role and every scope in the same transaction. The count policy (``decide_promotion``)
        applies; a recovery from zero is never refused. Already a Super Admin: a no-op."""
        why = clean_reason(reason)
        with transaction(self._session):
            self._staff.lock_staff_authority()
            user = self._staff.lock_user_by_email(canonical_email(email))
            if user is None:
                raise StaffAuthorityError(
                    StaffCode.ACCOUNT_NOT_FOUND, f"no account with email {email!r}"
                )
            roles = self._staff.staff_roles_of(user.id)
            if RoleName.ADMIN in roles:
                return StaffChange(user.id, user.email, False)
            self._require_promotable(user)
            decision = decide_promotion(
                self._staff.usable_super_admin_count(),
                ceiling=self._policy.safety_ceiling,
                override_policy=override_policy,
                break_glass=break_glass,
            )
            now = self._clock()
            cleared = self._staff.scopes_of(user.id) if RoleName.MODERATOR in roles else frozenset()
            if RoleName.MODERATOR in roles:
                self._roles.revoke(user.id, RoleName.MODERATOR)  # scopes cascade; BEFORE the grant
                self._auth_audit.record(
                    AuthEventType.ROLE_REVOKED, user_id=user.id, details={"reason": "moderator"}
                )
            self._roles.grant(user.id, RoleName.ADMIN, None, now)
            revoked = self._revoke_sessions(user.id, now)
            self._auth_audit.record(
                AuthEventType.ROLE_GRANTED, user_id=user.id, details={"reason": RoleName.ADMIN}
            )
            self._audit.record(
                StaffAuditAction.SUPER_ADMIN_PROMOTED,
                source=StaffAuditSource.CLI,
                target_user_id=user.id,
                before=_state(RoleName.MODERATOR if RoleName.MODERATOR in roles else None, cleared),
                after=_state(
                    RoleName.ADMIN,
                    (),
                    super_admin_count=decision.new_count,
                    policy_override=decision.policy_override_used,
                    break_glass=decision.break_glass_used,
                    sessions_revoked=revoked,
                ),
                reason=why,
            )
            warning = (
                f"{decision.new_count} usable Super Admins now exist; the normal target is "
                f"{NORMAL_SUPER_ADMIN_TARGET}. Demote the extra account when the rotation is done."
                if decision.above_target
                else None
            )
            return StaffChange(user.id, user.email, True, revoked, warning)

    def demote_super_admin(self, email: str, reason: str) -> StaffChange:
        """Remove ``admin``. Needs an explicit reason and is REFUSED when the target is the last
        usable Super Admin — no flag, break-glass included, can demote the final authority. Not a
        Super Admin: a no-op. The account does not become a Moderator."""
        why = clean_reason(reason)
        with transaction(self._session):
            self._staff.lock_staff_authority()
            user = self._staff.lock_user_by_email(canonical_email(email))
            if user is None:
                raise StaffAuthorityError(
                    StaffCode.ACCOUNT_NOT_FOUND, f"no account with email {email!r}"
                )
            if RoleName.ADMIN not in self._staff.staff_roles_of(user.id):
                return StaffChange(user.id, user.email, False)
            self.guard_last_usable_super_admin(user.id)
            self._roles.revoke(user.id, RoleName.ADMIN)
            revoked = self._revoke_sessions(user.id, self._clock())
            self._auth_audit.record(
                AuthEventType.ROLE_REVOKED, user_id=user.id, details={"reason": RoleName.ADMIN}
            )
            self._audit.record(
                StaffAuditAction.SUPER_ADMIN_DEMOTED,
                source=StaffAuditSource.CLI,
                target_user_id=user.id,
                before=_state(RoleName.ADMIN, ()),
                after=_state(
                    None,
                    (),
                    super_admin_count=self._staff.usable_super_admin_count(),
                    sessions_revoked=revoked,
                ),
                reason=why,
            )
            return StaffChange(user.id, user.email, True, revoked)

    # ==== the invariant ===========================================================================

    def guard_last_usable_super_admin(self, user_id: uuid.UUID) -> None:
        """Refuse (``last_super_admin``) if removing ``user_id``'s privilege or usability would
        leave ZERO usable Super Admins. Only a usable target matters: demoting an account that was
        never usable (unverified, suspended, no CURRENTLY usable way to sign in) cannot reduce
        the count.

        PRECONDITION: the caller is inside its transaction and has taken
        ``lock_staff_authority()`` — the check and the change must be serialised. Demotion calls
        it; a future suspend / tombstone path MUST call it too (none exists today)."""
        if self._staff.is_usable_super_admin(user_id) and not self._staff.usable_super_admin_count(
            excluding=user_id
        ):
            raise StaffAuthorityError(
                StaffCode.LAST_SUPER_ADMIN,
                "That account is the last usable Super Admin. Promote another account first.",
            )

    # ==== internals ===============================================================================

    def _begin_web(self, actor_id: uuid.UUID, session_id: uuid.UUID) -> None:
        """Serialise, lock the actor and the acting session, then re-read that the ACTING Super
        Admin still is one (``403``) and that the session may still act (``401``): a demotion,
        reset or sign-out that committed after the request began, or while this waited, is seen
        here; one that has not committed waits for this change."""
        self._staff.lock_staff_authority()
        acting = hold_acting_session(
            StaffAuthorityRepository(self._session), actor_id, session_id, self._clock
        )
        if not self._staff.is_live_super_admin(actor_id):
            raise StaffAuthorityError(
                StaffCode.ACTOR_NOT_AUTHORISED, "You do not have permission to do this."
            )
        acting.require()

    def _moderator_target(self, user_id: uuid.UUID) -> tuple[User, frozenset[StaffScope]]:
        """Lock the target and return it with its CURRENT scopes. Not a Moderator (or no such
        account): ``moderator_not_found``, one answer for both. A Super Admin: refused."""
        user = self._staff.lock_user(user_id)
        if user is None:
            raise self._moderator_not_found()
        roles = self._staff.staff_roles_of(user.id)
        if RoleName.ADMIN in roles:
            raise self._super_admin_target()
        if RoleName.MODERATOR not in roles:
            raise self._moderator_not_found()
        return user, self._staff.scopes_of(user.id)

    def _eligible(self, user: User) -> bool:
        """Active, e-mail verified and, in a hosted environment, not a fixture / demo / reserved
        identity. (A Professional profile is neither required nor considered.)"""
        if user.status != UserStatus.ACTIVE or user.email_verified_at is None:
            return False
        return not (self._policy.hosted and is_reserved_identity(user.email))

    def _require_promotable(self, user: User) -> None:
        """The stricter bar for a Super Admin, with SPECIFIC messages: only the operator CLI reaches
        it, and an operator with database access learns nothing from them."""
        if user.status != UserStatus.ACTIVE:
            raise self._cannot_promote("the account is not active")
        if user.email_verified_at is None:
            raise self._cannot_promote("the account's email is not verified")
        if self._policy.hosted and is_reserved_identity(user.email):
            raise self._cannot_promote(
                "fixture, demo and reserved-domain addresses cannot hold staff roles in a "
                "hosted environment"
            )
        if not self._staff.has_sign_in_method(user.id):
            raise self._cannot_promote(
                "the account has no way to sign in right now (no password, and no linked "
                "identity whose provider is enabled)"
            )

    def _revoke_sessions(self, user_id: uuid.UUID, now: datetime) -> int:
        return len(
            self._sessions.revoke_all_for_user(user_id, SessionRevokeReason.ROLE_CHANGE, now)
        )

    @staticmethod
    def _cannot_promote(message: str) -> StaffAuthorityError:
        return StaffAuthorityError(StaffCode.TARGET_NOT_ELIGIBLE, message)

    @staticmethod
    def _not_eligible() -> StaffAuthorityError:
        return StaffAuthorityError(
            StaffCode.TARGET_NOT_ELIGIBLE,
            "That account cannot be given a staff role. Check the address and that the person "
            "has a verified, active account.",
            field="email",
        )

    @staticmethod
    def _moderator_not_found() -> StaffAuthorityError:
        return StaffAuthorityError(StaffCode.MODERATOR_NOT_FOUND, "No such moderator.")

    @staticmethod
    def _super_admin_target() -> StaffAuthorityError:
        return StaffAuthorityError(
            StaffCode.SUPER_ADMIN_TARGET_FORBIDDEN,
            "A Super Admin cannot be changed through moderator management.",
        )
