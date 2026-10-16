"""Email/password authentication (Phase 11B; frozen design: docs/backend/AUTH_RBAC.md).

``AuthService`` is the one place where an authentication operation is orchestrated. It **owns the
transaction** of each operation (``with transaction(session)``): register, login (with the
session-cap revocations), logout, logout-all, token redemption, password reset and change each
commit exactly once, atomically, or not at all. Repositories only query/add/flush.

Email is deliberately *not* sent here: operations return the ``EmailMessage`` objects to send and
the router dispatches them **after** the commit (a mail outage must never undo an account).

Enumeration safety: ``login`` gives one failure for unknown email / wrong password / password-less
account (with a dummy Argon2 verification so the work is comparable); ``forgot_password`` never
reveals whether the account exists; ``register`` reveals an existing email explicitly — the
documented, rate-limited trade-off (AUTH_RBAC.md §13.1).
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.core.rate_limit import (
    FORGOT_PASSWORD,
    LOGIN_FAILURES,
    REGISTER,
    RESEND_VERIFICATION_DAY,
    RESEND_VERIFICATION_MINUTE,
    RateDecision,
    RateLimiter,
    RatePolicy,
)
from app.core.security.identity import canonical_email
from app.core.security.passwords import PasswordService, validate_password
from app.core.security.tokens import hash_token, is_well_formed_token, new_token
from app.db.session import transaction
from app.models import AuthToken, User
from app.models.enums import (
    AuthEventType,
    AuthTokenPurpose,
    SessionRevokeReason,
    UserStatus,
)
from app.repositories.auth import TokenRepository, UserAuthRepository
from app.services.auth_audit import AuthAuditService
from app.services.auth_sessions import Principal, SessionService
from app.services.email import (
    EmailMessage,
    password_changed_notice,
    password_reset_email,
    verification_email,
)

VERIFICATION_TTL = timedelta(hours=24)
PASSWORD_RESET_TTL = timedelta(minutes=60)


@dataclass(frozen=True)
class IssuedSession:
    """A signed-in result: the principal, the raw cookie secret, and mail to send after commit."""

    principal: Principal
    session_token: str
    emails: tuple[EmailMessage, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class AccountMethods:
    password: bool
    providers: list[str]


def _rate_limited(decision: RateDecision) -> AppError:
    return AppError(
        ErrorCode.RATE_LIMITED,
        status_code=429,
        headers={"Retry-After": str(decision.retry_after_seconds)},
    )


def _invalid_credentials() -> AppError:
    return AppError(ErrorCode.INVALID_CREDENTIALS, status_code=401)


class AuthService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        passwords: PasswordService,
        clock: Clock,
        limiter: RateLimiter,
    ) -> None:
        self._session = session
        self._settings = settings
        self._passwords = passwords
        self._clock = clock
        self._limiter = limiter
        self._users = UserAuthRepository(session)
        self._tokens = TokenRepository(session)
        self._audit = AuthAuditService(session, clock)
        self._sessions = SessionService(session, settings, clock, self._audit)

    # -- helpers -----------------------------------------------------------------------------

    def _check_password(self, password: str, *, email: str, display_name: str) -> None:
        problems = validate_password(password, email=email, display_name=display_name)
        if problems:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                status_code=422,
                details=[
                    ErrorDetail(field="password", code=p.code, message=p.message) for p in problems
                ],
            )

    def _count(self, identifier: str, *policies: RatePolicy) -> None:
        """Count one event under each policy; any exceeded window answers 429."""
        for policy in policies:
            decision = self._limiter.hit(identifier, policy)
            if not decision.allowed:
                raise _rate_limited(decision)

    def _issue_token(
        self, user: User, purpose: AuthTokenPurpose, ttl: timedelta, now: datetime
    ) -> str:
        """A new one-time token (caller's transaction). Older ones of the purpose are retired."""
        self._tokens.invalidate_unconsumed(user.id, [purpose], now)
        raw = new_token()
        self._tokens.add(
            AuthToken(
                user_id=user.id,
                purpose=purpose,
                token_hash=hash_token(raw),
                email=user.email,
                expires_at=now + ttl,
                created_at=now,
            )
        )
        return raw

    def account_methods(self, principal: Principal) -> AccountMethods:
        user = self._users.get_by_id(principal.user_id)
        return AccountMethods(
            password=bool(user and user.password_hash),
            providers=self._users.provider_names(principal.user_id),
        )

    # -- register ----------------------------------------------------------------------------

    def register(
        self, *, email: str, password: str, display_name: str, user_agent: str | None
    ) -> IssuedSession:
        """Create a Resident account, its verification token and its first session atomically."""
        self._count(email, REGISTER)
        self._check_password(password, email=email, display_name=display_name)
        if self._users.get_by_email(email) is not None:
            raise AppError(ErrorCode.EMAIL_ALREADY_REGISTERED, status_code=409)
        password_hash = self._passwords.hash_password(password)
        now = self._clock()
        try:
            with transaction(self._session):
                user = User(
                    email=email,
                    display_name=display_name,
                    password_hash=password_hash,
                    status=UserStatus.ACTIVE,
                    last_login_at=now,
                )
                self._users.add(user)
                token = self._issue_token(
                    user, AuthTokenPurpose.EMAIL_VERIFICATION, VERIFICATION_TTL, now
                )
                raw_session, auth_session = self._sessions.create(user.id, user_agent)
                self._audit.record(AuthEventType.REGISTER, user_id=user.id)
                self._audit.record(AuthEventType.EMAIL_VERIFICATION_SENT, user_id=user.id)
                principal = self._sessions.principal_for_new(auth_session, user)
        except IntegrityError as error:  # a concurrent registration of the same address won
            raise AppError(ErrorCode.EMAIL_ALREADY_REGISTERED, status_code=409) from error
        return IssuedSession(
            principal, raw_session, (verification_email(self._settings, user.email, token),)
        )

    # -- login -------------------------------------------------------------------------------

    def login(self, *, email: str, password: str, user_agent: str | None) -> IssuedSession:
        key = canonical_email(email)
        decision = self._limiter.blocked(key, LOGIN_FAILURES)
        if not decision.allowed:
            raise _rate_limited(decision)

        user = self._users.get_by_email(key) if key else None
        stored_hash = user.password_hash if user is not None else None
        if stored_hash is None:
            self._passwords.dummy_verify(password)  # comparable work for unknown/password-less
            verified = False
        else:
            verified = self._passwords.verify_password(stored_hash, password)

        if not verified or user is None or user.status == UserStatus.DELETED:
            self._record_login_failure(key, user)
            raise _invalid_credentials()
        if user.status == UserStatus.SUSPENDED:
            raise AppError(ErrorCode.ACCOUNT_DISABLED, status_code=403)

        upgraded_hash: str | None = None
        if stored_hash is not None and self._passwords.needs_rehash(stored_hash):
            upgraded_hash = self._passwords.hash_password(password)
        now = self._clock()
        with transaction(self._session):
            if upgraded_hash is not None:
                user.password_hash = upgraded_hash
            user.last_login_at = now
            raw_session, auth_session = self._sessions.create(user.id, user_agent)
            self._audit.record(AuthEventType.LOGIN_SUCCESS, user_id=user.id)
            principal = self._sessions.principal_for_new(auth_session, user)
        return IssuedSession(principal, raw_session)

    def _record_login_failure(self, key: str, user: User | None) -> None:
        self._limiter.hit(key, LOGIN_FAILURES)  # its own transaction: failures always count
        if user is not None:
            with transaction(self._session):
                self._audit.record(AuthEventType.LOGIN_FAILURE, user_id=user.id)

    # -- logout ------------------------------------------------------------------------------

    def logout(self, principal: Principal) -> None:
        with transaction(self._session):
            self._sessions.revoke(principal.session_id, SessionRevokeReason.LOGOUT)
            self._audit.record(AuthEventType.LOGOUT, user_id=principal.user_id)

    def logout_all(self, principal: Principal) -> None:
        with transaction(self._session):
            self._sessions.revoke_all(principal.user_id, SessionRevokeReason.LOGOUT_ALL)
            self._audit.record(AuthEventType.LOGOUT_ALL, user_id=principal.user_id)

    # -- email verification ------------------------------------------------------------------

    def verify_email(self, raw_token: str) -> None:
        digest = self._digest_or_invalid(raw_token)
        now = self._clock()
        with transaction(self._session):
            token = self._redeemable_token(digest, AuthTokenPurpose.EMAIL_VERIFICATION, now)
            user = self._users.lock(token.user_id)
            if user is None or user.email != token.email:
                raise AppError(ErrorCode.TOKEN_INVALID, status_code=400)
            self._consume(token, now)
            if user.email_verified_at is None:
                user.email_verified_at = now
                self._audit.record(AuthEventType.EMAIL_VERIFIED, user_id=user.id)

    def resend_verification(self, principal: Principal) -> tuple[EmailMessage, ...]:
        self._count(str(principal.user_id), RESEND_VERIFICATION_MINUTE, RESEND_VERIFICATION_DAY)
        if principal.email_verified:
            return ()
        now = self._clock()
        with transaction(self._session):
            user = self._users.lock(principal.user_id)
            if user is None or user.email_verified_at is not None:
                return ()
            token = self._issue_token(
                user, AuthTokenPurpose.EMAIL_VERIFICATION, VERIFICATION_TTL, now
            )
            self._audit.record(AuthEventType.EMAIL_VERIFICATION_SENT, user_id=user.id)
        return (verification_email(self._settings, user.email, token),)

    # -- password reset ----------------------------------------------------------------------

    def forgot_password(self, *, email: str) -> tuple[EmailMessage, ...]:
        """Always succeeds publicly; returns the mail to send (none for unknown accounts)."""
        key = canonical_email(email)
        self._count(key, FORGOT_PASSWORD)
        user = self._users.get_by_email(key) if key else None
        if user is None or user.status != UserStatus.ACTIVE:
            return ()
        now = self._clock()
        with transaction(self._session):
            token = self._issue_token(
                user, AuthTokenPurpose.PASSWORD_RESET, PASSWORD_RESET_TTL, now
            )
            self._audit.record(AuthEventType.PASSWORD_RESET_REQUESTED, user_id=user.id)
        return (password_reset_email(self._settings, user.email, token),)

    def reset_password(self, *, raw_token: str, new_password: str) -> tuple[EmailMessage, ...]:
        digest = self._digest_or_invalid(raw_token)
        now = self._clock()
        with transaction(self._session):
            token = self._redeemable_token(digest, AuthTokenPurpose.PASSWORD_RESET, now)
            user = self._users.lock(token.user_id)
            if user is None or user.status == UserStatus.DELETED:
                raise AppError(ErrorCode.TOKEN_INVALID, status_code=400)
            # Policy first: a weak password must not burn the one-time token (the error rolls back).
            self._check_password(new_password, email=user.email, display_name=user.display_name)
            new_hash = self._passwords.hash_password(new_password)
            self._consume(token, now)
            user.password_hash = new_hash
            self._tokens.invalidate_unconsumed(
                user.id,
                [AuthTokenPurpose.PASSWORD_RESET, AuthTokenPurpose.EMAIL_VERIFICATION]
                if token.email == user.email
                else [AuthTokenPurpose.PASSWORD_RESET],
                now,
            )
            if user.email_verified_at is None and token.email == user.email:
                user.email_verified_at = now  # the reset link proved control of the mailbox
                self._audit.record(AuthEventType.EMAIL_VERIFIED, user_id=user.id)
            self._sessions.revoke_all(user.id, SessionRevokeReason.PASSWORD_RESET)
            self._audit.record(AuthEventType.PASSWORD_RESET_COMPLETED, user_id=user.id)
            to = user.email
        return (password_changed_notice(to),)  # no session is created: the user logs in afresh

    # -- change password ---------------------------------------------------------------------

    def change_password(
        self, principal: Principal, *, current_password: str, new_password: str
    ) -> IssuedSession:
        """Verify the current password, set the new one, revoke other sessions, rotate this one."""
        decision = self._limiter.blocked(principal.email, LOGIN_FAILURES)
        if not decision.allowed:
            raise _rate_limited(decision)
        user = self._users.get_by_id(principal.user_id)
        if user is None:
            raise AppError(ErrorCode.UNAUTHENTICATED, status_code=401)
        if user.password_hash is None or not self._passwords.verify_password(
            user.password_hash, current_password
        ):
            if user.password_hash is None:
                self._passwords.dummy_verify(current_password)
            self._limiter.hit(principal.email, LOGIN_FAILURES)  # a stolen session cannot guess
            raise _invalid_credentials()
        self._check_password(new_password, email=user.email, display_name=user.display_name)
        new_hash = self._passwords.hash_password(new_password)
        with transaction(self._session):
            locked = self._users.lock(user.id)
            assert locked is not None
            locked.password_hash = new_hash
            self._sessions.revoke_all(
                user.id,
                SessionRevokeReason.PASSWORD_CHANGE,
                except_session_id=principal.session_id,
            )
            raw_session, expires_at = self._sessions.rotate(principal.session_id)
            self._audit.record(AuthEventType.PASSWORD_CHANGED, user_id=user.id)
        rotated = Principal(
            user_id=principal.user_id,
            display_name=principal.display_name,
            email=principal.email,
            email_verified=principal.email_verified,
            roles=principal.roles,
            plan_code=principal.plan_code,
            session_id=principal.session_id,
            session_created_at=principal.session_created_at,
            session_last_seen_at=self._clock(),
            session_expires_at=expires_at,
        )
        return IssuedSession(rotated, raw_session, (password_changed_notice(user.email),))

    # -- token redemption internals ----------------------------------------------------------

    @staticmethod
    def _digest_or_invalid(raw_token: str) -> bytes:
        if not is_well_formed_token(raw_token):
            raise AppError(ErrorCode.TOKEN_INVALID, status_code=400)
        return hash_token(raw_token)

    def _redeemable_token(
        self, digest: bytes, purpose: AuthTokenPurpose, now: datetime
    ) -> AuthToken:
        """The locked token row if it can still be redeemed; otherwise the stable token errors.

        ``token_invalid`` covers unknown, already-used and wrong-purpose tokens alike (they must
        not be distinguishable); ``token_expired`` is only for a known, unused, right-purpose
        token past its expiry — possession of the secret already proves the caller owns it.
        """
        token = self._tokens.lock_by_hash(digest)
        if token is None or token.purpose is not purpose or token.consumed_at is not None:
            raise AppError(ErrorCode.TOKEN_INVALID, status_code=400)
        if token.expires_at <= now:
            raise AppError(ErrorCode.TOKEN_EXPIRED, status_code=400)
        return token

    def _consume(self, token: AuthToken, now: datetime) -> None:
        """Atomic single use: the guarded UPDATE succeeds for exactly one caller."""
        if not self._tokens.consume(token.token_hash, token.purpose, now):
            raise AppError(ErrorCode.TOKEN_INVALID, status_code=400)
