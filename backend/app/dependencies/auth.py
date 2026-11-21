"""Authentication and authorization dependencies — the one place access is decided
(docs/backend/AUTH_RBAC.md §11.2).

Routers *declare* a dependency; no router contains ``if user.role == ...``. Frontend route guards
are UX only — these are the authority.

=========================  =========================================================================
``get_optional_user``      the principal, or ``None`` (never raises for a missing/invalid session)
``get_current_user``       the principal, else ``401 unauthenticated`` / ``401 session_expired``
``require_verified_user``  + ``403 email_not_verified``
``require_professional``   verified + a ``professional_profiles`` row, else
                           ``403 professional_profile_required``
``require_super_admin``    verified + the ``admin`` role (= Super Admin) + a recent session, else
                           403 / 401. ``require_admin`` is its unchanged compatibility alias.
``require_staff``          verified + (Super Admin, or a Moderator with >= 1 effective scope) + a
                           recent session. Attached only to the listing-moderation routes (RBAC-B).
``require_sensitive_super_admin``
                           ``require_super_admin`` + a session created within the staff sensitive
                           window (15 minutes), else ``403 sensitive_reauth_required``. Guards every
                           staff-management mutation (RBAC-C).
=========================  =========================================================================

Professional is a *capability* (a profile row), not a role. Resident is every account.
"""

from datetime import timedelta
from typing import Annotated, cast

from fastapi import Depends, Request, Response

from app.api.cookies import clear_cookie_header, clear_session_cookie, set_session_cookie
from app.core.clock import Clock
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.core.rate_limit import RateLimiter
from app.core.security.passwords import PasswordService
from app.dependencies.db import DbSession
from app.dependencies.settings import SettingsDep
from app.models.enums import AuthProvider
from app.services.auth import AuthService
from app.services.auth_audit import AuthAuditService
from app.services.auth_sessions import Authentication, Principal, SessionService
from app.services.email import EmailSender
from app.services.oauth.flow import OAuthService
from app.services.oauth.provider import OAuthProvider
from app.services.rate_limit import PostgresRateLimiter


def get_clock(request: Request) -> Clock:
    return cast(Clock, request.app.state.clock)


def get_password_service(request: Request) -> PasswordService:
    return cast(PasswordService, request.app.state.password_service)


def get_email_sender(request: Request) -> EmailSender:
    return cast(EmailSender, request.app.state.email_sender)


def get_oauth_providers(request: Request) -> dict[AuthProvider, OAuthProvider]:
    return cast(dict[AuthProvider, OAuthProvider], request.app.state.oauth_providers)


ClockDep = Annotated[Clock, Depends(get_clock)]
PasswordServiceDep = Annotated[PasswordService, Depends(get_password_service)]
EmailSenderDep = Annotated[EmailSender, Depends(get_email_sender)]


def get_auth_service(
    db: DbSession, settings: SettingsDep, passwords: PasswordServiceDep, clock: ClockDep
) -> AuthService:
    limiter: RateLimiter = PostgresRateLimiter(db, clock)
    return AuthService(db, settings, passwords, clock, limiter)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_oauth_service(
    db: DbSession,
    settings: SettingsDep,
    clock: ClockDep,
    providers: Annotated[dict[AuthProvider, OAuthProvider], Depends(get_oauth_providers)],
) -> OAuthService:
    return OAuthService(db, settings, clock, providers)


OAuthServiceDep = Annotated[OAuthService, Depends(get_oauth_service)]


def resolve_authentication(
    request: Request, response: Response, db: DbSession, settings: SettingsDep, clock: ClockDep
) -> Authentication:
    """Present the cookie, slide the session when due, and clear a dead cookie."""
    token = request.cookies.get(settings.auth_cookie_name)
    service = SessionService(db, settings, clock, AuthAuditService(db, clock))
    result = service.authenticate(token)
    if token is not None:
        if result.refreshed_max_age is not None:
            set_session_cookie(response, settings, token, result.refreshed_max_age)
        elif result.problem == "expired":
            clear_session_cookie(response, settings)
    return result


AuthenticationDep = Annotated[Authentication, Depends(resolve_authentication)]


def get_optional_user(result: AuthenticationDep) -> Principal | None:
    return result.principal


def get_current_user(result: AuthenticationDep, settings: SettingsDep) -> Principal:
    if result.principal is not None:
        return result.principal
    if result.problem == "expired":
        raise AppError(
            ErrorCode.SESSION_EXPIRED,
            status_code=401,
            headers={"Set-Cookie": clear_cookie_header(settings)},
        )
    raise AppError(ErrorCode.UNAUTHENTICATED, status_code=401)


CurrentUser = Annotated[Principal, Depends(get_current_user)]
OptionalUser = Annotated[Principal | None, Depends(get_optional_user)]


def require_verified_user(principal: CurrentUser) -> Principal:
    if not principal.email_verified:
        raise AppError(ErrorCode.EMAIL_NOT_VERIFIED, status_code=403)
    return principal


VerifiedUser = Annotated[Principal, Depends(require_verified_user)]


def require_professional(principal: VerifiedUser) -> Principal:
    if not principal.is_professional:
        # Phase 12D: the stable code the SPA routes to onboarding (API_CONTRACT §10.10).
        raise AppError(ErrorCode.PROFESSIONAL_PROFILE_REQUIRED, status_code=403)
    return principal


ProfessionalUser = Annotated[Principal, Depends(require_professional)]


def admin_session_is_fresh(principal: Principal, settings: Settings, clock: Clock) -> bool:
    """Admin actions need a recently *used* (2 h) and recently *created* (12 h) session."""
    now = clock()
    idle = timedelta(minutes=settings.admin_session_idle_minutes)
    maximum = timedelta(hours=settings.admin_session_max_hours)
    return (
        now - principal.session_last_seen_at <= idle
        and now - principal.session_created_at <= maximum
    )


def _require_fresh_staff_session(
    principal: Principal,
    authentication: Authentication,
    db: DbSession,
    settings: Settings,
    clock: Clock,
) -> None:
    """The one staff freshness rule (idle <= 2 h, age <= 12 h). A refused request must not count as
    activity, so the touch it already made is undone and a retry is refused too."""
    if admin_session_is_fresh(principal, settings, clock):
        return
    if authentication.refreshed_max_age is not None:
        SessionService(db, settings, clock, AuthAuditService(db, clock)).restore_activity(principal)
    raise AppError(ErrorCode.SESSION_EXPIRED, status_code=401)


def require_super_admin(
    principal: VerifiedUser,
    authentication: AuthenticationDep,
    db: DbSession,
    settings: SettingsDep,
    clock: ClockDep,
) -> Principal:
    """A verified, active Super Admin (the ``admin`` role, read live) with a fresh session."""
    if not principal.is_super_admin:
        raise AppError(ErrorCode.FORBIDDEN, status_code=403)
    _require_fresh_staff_session(principal, authentication, db, settings, clock)
    return principal


#: Compatibility alias: every existing caller (the whole ``/admin`` router, ``AdminUser``) keeps
#: exactly its current Super Admin-only behaviour. Do not repoint it at ``require_staff``.
require_admin = require_super_admin


def require_staff(
    principal: VerifiedUser,
    authentication: AuthenticationDep,
    db: DbSession,
    settings: SettingsDep,
    clock: ClockDep,
) -> Principal:
    """A verified, active Super Admin, or a Moderator who holds at least one effective scope, with
    a fresh session. A Moderator with zero scopes is refused. RBAC-A defines it; no route uses it
    until RBAC-B scopes every read and write (docs/backend/AUTH_RBAC.md §27.4, §27.16)."""
    if not principal.is_staff:
        raise AppError(ErrorCode.FORBIDDEN, status_code=403)
    _require_fresh_staff_session(principal, authentication, db, settings, clock)
    return principal


def require_sensitive_super_admin(
    principal: Annotated[Principal, Depends(require_super_admin)],
    settings: SettingsDep,
    clock: ClockDep,
) -> Principal:
    """A Super Admin whose SESSION is recent enough for a staff-management change.

    Runs after ``require_super_admin`` (so a non-admin is ``403``, an idle / over-age session is
    ``401 session_expired``, exactly as before) and then also requires that the session was CREATED
    no more than ``staff_sensitive_window_minutes`` ago (15 by default, boundary inclusive).

    This is an INTERIM approximation of recent authentication (``AUTH_RBAC.md §27.7``): it measures
    when the session was established, not when the person last proved their identity. Once explicit
    re-authentication / MFA step-up exists, this is the one place that switches to the dedicated
    timestamp. The answer is a stable ``403`` detail code and carries no session metadata (no age,
    no timestamp); the SPA treats it as "sign in again", not as a lost session."""
    window = timedelta(minutes=settings.staff_sensitive_window_minutes)
    if clock() - principal.session_created_at > window:
        raise AppError(
            ErrorCode.FORBIDDEN,
            status_code=403,
            details=[
                ErrorDetail(
                    field="session",
                    code="sensitive_reauth_required",
                    message="Sign in again to manage staff.",
                )
            ],
        )
    return principal


SuperAdminUser = Annotated[Principal, Depends(require_super_admin)]
AdminUser = SuperAdminUser
StaffUser = Annotated[Principal, Depends(require_staff)]
SensitiveSuperAdminUser = Annotated[Principal, Depends(require_sensitive_super_admin)]
