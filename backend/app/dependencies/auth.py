"""Authentication and authorization dependencies — the one place access is decided
(docs/backend/AUTH_RBAC.md §11.2).

Routers *declare* a dependency; no router contains ``if user.role == ...``. Frontend route guards
are UX only — these are the authority.

=========================  =========================================================================
``get_optional_user``      the principal, or ``None`` (never raises for a missing/invalid session)
``get_current_user``       the principal, else ``401 unauthenticated`` / ``401 session_expired``
``require_verified_user``  + ``403 email_not_verified``
``require_professional``   verified + a ``professional_profiles`` row, else ``403 forbidden``
``require_admin``          verified + the ``admin`` role + a recent session, else 403 / 401
=========================  =========================================================================

Professional is a *capability* (a profile row), not a role. Resident is every account.
"""

from datetime import timedelta
from typing import Annotated, cast

from fastapi import Depends, Request, Response

from app.api.cookies import clear_cookie_header, clear_session_cookie, set_session_cookie
from app.core.clock import Clock
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import RateLimiter
from app.core.security.passwords import PasswordService
from app.dependencies.db import DbSession
from app.dependencies.settings import SettingsDep
from app.services.auth import AuthService
from app.services.auth_audit import AuthAuditService
from app.services.auth_sessions import Authentication, Principal, SessionService
from app.services.email import EmailSender
from app.services.rate_limit import PostgresRateLimiter


def get_clock(request: Request) -> Clock:
    return cast(Clock, request.app.state.clock)


def get_password_service(request: Request) -> PasswordService:
    return cast(PasswordService, request.app.state.password_service)


def get_email_sender(request: Request) -> EmailSender:
    return cast(EmailSender, request.app.state.email_sender)


ClockDep = Annotated[Clock, Depends(get_clock)]
PasswordServiceDep = Annotated[PasswordService, Depends(get_password_service)]
EmailSenderDep = Annotated[EmailSender, Depends(get_email_sender)]


def get_auth_service(
    db: DbSession, settings: SettingsDep, passwords: PasswordServiceDep, clock: ClockDep
) -> AuthService:
    limiter: RateLimiter = PostgresRateLimiter(db, clock)
    return AuthService(db, settings, passwords, clock, limiter)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


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
        raise AppError(ErrorCode.FORBIDDEN, status_code=403)
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


def require_admin(
    principal: VerifiedUser,
    authentication: AuthenticationDep,
    db: DbSession,
    settings: SettingsDep,
    clock: ClockDep,
) -> Principal:
    if not principal.is_admin:
        raise AppError(ErrorCode.FORBIDDEN, status_code=403)
    if not admin_session_is_fresh(principal, settings, clock):
        if authentication.refreshed_max_age is not None:
            # this refused request already slid last_seen: undo it, so a retry is refused too
            SessionService(db, settings, clock, AuthAuditService(db, clock)).restore_activity(
                principal
            )
        raise AppError(ErrorCode.SESSION_EXPIRED, status_code=401)
    return principal


AdminUser = Annotated[Principal, Depends(require_admin)]
