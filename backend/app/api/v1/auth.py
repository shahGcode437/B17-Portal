"""Email/password authentication endpoints (Phase 11B; docs/backend/AUTH_RBAC.md §12).

HTTP only: parse, call ``AuthService`` (which owns the transactions), set/clear the session
cookie, schedule email delivery **after** the commit, and shape the response. Every response here
is ``Cache-Control: no-store`` (see ``AuthSecurityMiddleware``). The raw session token only ever
leaves in the ``Set-Cookie`` header; ``csrfToken`` (derived from it) is the only token in a body.
"""

from fastapi import APIRouter, BackgroundTasks, Request, Response

from app.api.cookies import clear_session_cookie, set_session_cookie
from app.api.routing import ContractRoute
from app.core.config import Settings
from app.core.errors import ErrorResponse
from app.core.security.tokens import csrf_token_for
from app.dependencies.auth import (
    AuthServiceDep,
    CurrentUser,
    EmailSenderDep,
)
from app.dependencies.settings import SettingsDep
from app.schemas.auth import (
    AcceptedStatus,
    AuthMethods,
    AuthUser,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ProfessionalSummary,
    RegisterRequest,
    ResetPasswordRequest,
    SessionInfo,
    VerifyEmailRequest,
)
from app.schemas.envelope import Envelope
from app.services.auth import AccountMethods, AuthService, IssuedSession
from app.services.auth_sessions import Principal
from app.services.email import EmailMessage, EmailSender, deliver

router = APIRouter(
    prefix="/auth",
    route_class=ContractRoute,
    tags=["auth"],
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated / session invalid"},
        403: {"model": ErrorResponse, "description": "Forbidden / CSRF failure"},
        429: {"model": ErrorResponse, "description": "Rate limited"},
    },
)


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _body(principal: Principal, methods: AccountMethods, session_token: str) -> AuthUser:
    return AuthUser(
        id=principal.user_id,
        display_name=principal.display_name,
        email=principal.email,
        email_verified=principal.email_verified,
        roles=sorted(principal.roles),
        professional=(
            ProfessionalSummary(plan_code=principal.plan_code)
            if principal.plan_code is not None
            else None
        ),
        auth_methods=AuthMethods(password=methods.password, providers=methods.providers),
        session=SessionInfo(expires_at=principal.session_expires_at),
        csrf_token=csrf_token_for(session_token),
    )


def _max_age(principal: Principal) -> int:
    """Cookie lifetime: from the moment this session was (re)issued until its idle expiry."""
    return max(
        1, int((principal.session_expires_at - principal.session_last_seen_at).total_seconds())
    )


def _schedule(
    background: BackgroundTasks, sender: EmailSender, messages: tuple[EmailMessage, ...]
) -> None:
    for message in messages:
        background.add_task(deliver, sender, message)


def _signed_in(
    issued: IssuedSession,
    *,
    service: AuthService,
    settings: Settings,
    response: Response,
) -> Envelope[AuthUser]:
    principal = issued.principal
    set_session_cookie(response, settings, issued.session_token, _max_age(principal))
    return Envelope(data=_body(principal, service.account_methods(principal), issued.session_token))


@router.post(
    "/register",
    status_code=201,
    response_model=Envelope[AuthUser],
    summary="Create a Resident account and sign in",
    responses={409: {"model": ErrorResponse, "description": "email_already_registered"}},
)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    service: AuthServiceDep,
    settings: SettingsDep,
    sender: EmailSenderDep,
) -> Envelope[AuthUser]:
    """Normalizes the email, enforces the password policy, hashes with Argon2id, creates the
    account, a verification token and the first session in one transaction, then sets the session
    cookie. The verification email is sent after the commit. An existing email is an explicit
    ``409 email_already_registered`` (a documented, rate-limited trade-off)."""
    issued = service.register(
        email=payload.email,
        password=payload.password.get_secret_value(),
        display_name=payload.display_name,
        user_agent=_user_agent(request),
    )
    _schedule(background, sender, issued.emails)
    return _signed_in(issued, service=service, settings=settings, response=response)


@router.post("/login", response_model=Envelope[AuthUser], summary="Sign in with email + password")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
) -> Envelope[AuthUser]:
    """Unknown email, wrong password and password-less accounts all answer one
    ``401 invalid_credentials``. A correct password on a suspended account is
    ``403 account_disabled``. Always issues a fresh session token."""
    issued = service.login(
        email=payload.email,
        password=payload.password.get_secret_value(),
        user_agent=_user_agent(request),
    )
    return _signed_in(issued, service=service, settings=settings, response=response)


@router.get("/me", response_model=Envelope[AuthUser], summary="The signed-in account")
def me(
    request: Request, principal: CurrentUser, service: AuthServiceDep, settings: SettingsDep
) -> Envelope[AuthUser]:
    """Identity, explicit roles, professional plan summary, sign-in methods, session expiry and
    the session-bound ``csrfToken`` (hold it in memory; send it as ``X-CSRF-Token``)."""
    token = request.cookies.get(settings.auth_cookie_name, "")
    return Envelope(data=_body(principal, service.account_methods(principal), token))


@router.post("/logout", status_code=204, summary="Sign out this device")
def logout(principal: CurrentUser, service: AuthServiceDep, settings: SettingsDep) -> Response:
    """Revokes the server-side session (not just the cookie) and clears the cookie."""
    service.logout(principal)
    response = Response(status_code=204)
    clear_session_cookie(response, settings)
    return response


@router.post("/logout-all", status_code=204, summary="Sign out every device")
def logout_all(principal: CurrentUser, service: AuthServiceDep, settings: SettingsDep) -> Response:
    service.logout_all(principal)
    response = Response(status_code=204)
    clear_session_cookie(response, settings)
    return response


@router.post(
    "/verify-email",
    status_code=204,
    summary="Redeem an email-verification token",
    responses={400: {"model": ErrorResponse, "description": "token_invalid | token_expired"}},
)
def verify_email(payload: VerifyEmailRequest, service: AuthServiceDep) -> Response:
    """The token arrives in the JSON body (the frontend read it from the URL fragment)."""
    service.verify_email(payload.token)
    return Response(status_code=204)


@router.post("/resend-verification", status_code=204, summary="Send a fresh verification email")
def resend_verification(
    principal: CurrentUser,
    background: BackgroundTasks,
    service: AuthServiceDep,
    sender: EmailSenderDep,
) -> Response:
    """Authenticated + CSRF. A no-op for an already-verified account. Throttled."""
    _schedule(background, sender, service.resend_verification(principal))
    return Response(status_code=204, background=background)


@router.post(
    "/forgot-password",
    status_code=202,
    response_model=Envelope[AcceptedStatus],
    summary="Request a password-reset email",
)
def forgot_password(
    payload: ForgotPasswordRequest,
    background: BackgroundTasks,
    service: AuthServiceDep,
    sender: EmailSenderDep,
) -> Envelope[AcceptedStatus]:
    """Always the same ``202`` body, whether or not the account exists."""
    _schedule(background, sender, service.forgot_password(email=payload.email))
    return Envelope(data=AcceptedStatus())


@router.post(
    "/reset-password",
    status_code=204,
    summary="Set a new password with a reset token",
    responses={400: {"model": ErrorResponse, "description": "token_invalid | token_expired"}},
)
def reset_password(
    payload: ResetPasswordRequest,
    background: BackgroundTasks,
    service: AuthServiceDep,
    sender: EmailSenderDep,
) -> Response:
    """Single-use token; revokes **all** of the user's sessions; does **not** sign anyone in."""
    messages = service.reset_password(
        raw_token=payload.token, new_password=payload.new_password.get_secret_value()
    )
    _schedule(background, sender, messages)
    return Response(status_code=204, background=background)


@router.post(
    "/change-password",
    response_model=Envelope[AuthUser],
    summary="Change the password of the signed-in account",
)
def change_password(
    payload: ChangePasswordRequest,
    principal: CurrentUser,
    response: Response,
    background: BackgroundTasks,
    service: AuthServiceDep,
    settings: SettingsDep,
    sender: EmailSenderDep,
) -> Envelope[AuthUser]:
    """Verifies the current password, revokes every other session and **rotates this one**: the
    response replaces the cookie and returns the new ``csrfToken``; the old token is dead."""
    issued = service.change_password(
        principal,
        current_password=payload.current_password.get_secret_value(),
        new_password=payload.new_password.get_secret_value(),
    )
    _schedule(background, sender, issued.emails)
    return _signed_in(issued, service=service, settings=settings, response=response)
