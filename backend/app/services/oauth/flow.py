"""Google sign-in orchestration (Phase 11C; frozen design: docs/backend/AUTH_RBAC.md §10).

This module owns the **B-17 side** of an OAuth round trip. The provider (``OAuthProvider``) only
proves *who* the person is; everything else — the temporary flow, the browser binding, single use,
account resolution, session creation — is decided here, on the existing 11B primitives:

* the flow row in ``oauth_flows`` (hashed ``state`` and browser-cookie secret, nonce, PKCE verifier,
  validated ``returnTo``, 10-minute expiry, single-use);
* ``SessionService.create`` for the session (same opaque PostgreSQL session, 10-session cap,
  cookie and CSRF model — no OAuth-specific session exists);
* ``AuthAuditService`` for events and ``AuthService``'s token issuer for verification emails.

Transaction ownership matches the rest of auth: the flow is consumed in its **own** small committed
transaction *before* any network call (so a replay can never succeed and no lock is held across
I/O); account resolution then runs in **one** transaction that either fully commits or leaves
nothing. A failure at any step becomes a fixed, safe code (``oauth_failed`` ...) — never provider
text, an authorization code, a token or an email.
"""

import hmac
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.security.identity import normalize_email
from app.core.security.redirects import InvalidReturnTo, resolve_return_to
from app.core.security.tokens import hash_token, is_well_formed_token, new_token
from app.db.session import transaction
from app.models import AuthIdentity, OAuthFlow, User
from app.models.enums import (
    AuthEventType,
    AuthProvider,
    AuthTokenPurpose,
    OAuthPurpose,
    SessionRevokeReason,
    UserStatus,
)
from app.repositories.auth import (
    IdentityRepository,
    OAuthFlowRepository,
    TokenRepository,
    UserAuthRepository,
)
from app.services.auth import VERIFICATION_TTL
from app.services.auth_audit import AuthAuditService
from app.services.auth_sessions import Principal, SessionService
from app.services.auth_tokens import issue_token
from app.services.email import EmailMessage, verification_email
from app.services.oauth.provider import (
    OAuthIdentity,
    OAuthProvider,
    OAuthProviderError,
    code_challenge_s256,
    new_code_verifier,
)

logger = logging.getLogger("app.oauth")

OAUTH_FLOW_TTL = timedelta(minutes=10)
MAX_CODE_LENGTH = 2048
MAX_STATE_LENGTH = 200

#: The complete set of codes a callback may report to the frontend (``/login?error=<code>``).
CALLBACK_ERROR_CODES = frozenset(
    {"oauth_denied", "oauth_failed", "identity_conflict", "email_not_verified", "account_disabled"}
)


class Rejected(Exception):
    """A deliberate, safe refusal inside a transaction (it rolls the transaction back)."""

    def __init__(self, code: str) -> None:
        assert code in CALLBACK_ERROR_CODES
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class StartedFlow:
    authorization_url: str
    #: The raw browser-binding secret for the flow cookie (only its hash is stored).
    flow_cookie: str


@dataclass(frozen=True)
class CallbackOutcome:
    #: The validated stored ``returnTo`` on success; ``None`` on failure.
    return_to: str | None = None
    error: str | None = None
    #: A new B-17 session (login/claim only — a successful *connect* keeps the current one).
    session_token: str | None = None
    session_max_age: int | None = None
    emails: tuple[EmailMessage, ...] = field(default_factory=tuple)
    #: True once this callback consumed its flow (so the single-use cookie is spent and cleared). A
    #: request that matched no flow (bad state, wrong browser) leaves the genuine flow untouched.
    flow_spent: bool = False


def _failure(code: str) -> CallbackOutcome:
    return CallbackOutcome(error=code)


class OAuthService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        clock: Clock,
        providers: Mapping[AuthProvider, OAuthProvider],
    ) -> None:
        self._session = session
        self._settings = settings
        self._clock = clock
        self._providers = providers
        self._flows = OAuthFlowRepository(session)
        self._users = UserAuthRepository(session)
        self._identities = IdentityRepository(session)
        self._tokens = TokenRepository(session)
        self._audit = AuthAuditService(session, clock)
        self._sessions = SessionService(session, settings, clock, self._audit)

    def _provider(self, provider: AuthProvider) -> OAuthProvider:
        configured = self._providers.get(provider)
        if configured is None:
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, status_code=503)
        return configured

    # -- start ---------------------------------------------------------------------------------

    def start(
        self,
        provider_name: AuthProvider,
        purpose: OAuthPurpose,
        return_to: str | None,
        principal: Principal | None,
    ) -> StartedFlow:
        """Create the temporary flow and the provider URL (the SPA then navigates to it)."""
        provider = self._provider(provider_name)
        if purpose is OAuthPurpose.LINK and principal is None:
            raise AppError(ErrorCode.UNAUTHENTICATED, status_code=401)
        try:  # defence in depth: the request schema already refused it; nothing is created first
            destination = resolve_return_to(return_to)
        except InvalidReturnTo:
            raise AppError(ErrorCode.VALIDATION_ERROR, status_code=422) from None
        now = self._clock()
        state, flow_cookie, nonce = new_token(), new_token(), new_token()
        verifier = new_code_verifier()
        url = provider.authorization_url(
            state=state,
            nonce=nonce,
            code_challenge=code_challenge_s256(verifier),
            redirect_uri=self._settings.google_redirect_uri,
        )
        with transaction(self._session):
            self._flows.add(
                OAuthFlow(
                    provider=provider_name,
                    purpose=purpose,
                    state_hash=hash_token(state),
                    flow_cookie_hash=hash_token(flow_cookie),
                    nonce=nonce,
                    code_verifier=verifier,
                    user_id=principal.user_id
                    if purpose is OAuthPurpose.LINK and principal
                    else None,
                    return_to=destination,
                    created_at=now,
                    expires_at=now + OAUTH_FLOW_TTL,
                )
            )
        return StartedFlow(url, flow_cookie)

    # -- callback ------------------------------------------------------------------------------

    def callback(
        self,
        provider_name: AuthProvider,
        *,
        code: str | None,
        state: str | None,
        provider_error: str | None,
        flow_cookie: str | None,
        session_token: str | None,
        user_agent: str | None,
    ) -> CallbackOutcome:
        """Never raises for a bad request: every failure is a fixed ``CallbackOutcome.error``."""
        provider = self._providers.get(provider_name)
        if (
            provider is None
            or not state
            or not flow_cookie
            or len(state) > MAX_STATE_LENGTH
            or not is_well_formed_token(state)
            or not is_well_formed_token(flow_cookie)
        ):
            return _failure("oauth_failed")

        # Single use, bound to this browser, unexpired — one guarded UPDATE, committed on its own
        # *before* any provider call, so a replay or a concurrent twin can never also succeed.
        with transaction(self._session):
            flow = self._flows.consume(
                state_hash=hash_token(state),
                flow_cookie_hash=hash_token(flow_cookie),
                provider=provider_name,
                now=self._clock(),
            )
        if flow is None:
            return _failure("oauth_failed")
        return replace(
            self._complete(
                flow,
                provider,
                code=code,
                provider_error=provider_error,
                session_token=session_token,
                user_agent=user_agent,
            ),
            flow_spent=True,
        )

    def _complete(
        self,
        flow: OAuthFlow,
        provider: OAuthProvider,
        *,
        code: str | None,
        provider_error: str | None,
        session_token: str | None,
        user_agent: str | None,
    ) -> CallbackOutcome:
        """Everything after the flow was consumed: exchange, verify, resolve."""
        if provider_error:
            return _failure("oauth_denied" if provider_error == "access_denied" else "oauth_failed")
        if not code or len(code) > MAX_CODE_LENGTH:
            return _failure("oauth_failed")
        try:
            identity = provider.exchange(
                code=code,
                code_verifier=flow.code_verifier,
                redirect_uri=self._settings.google_redirect_uri,
                nonce=flow.nonce,
            )
        except OAuthProviderError as error:
            return _failure(error.kind)
        except Exception:  # an adapter bug must never leak or 500 a browser navigation
            logger.exception("oauth provider adapter failed")
            return _failure("oauth_failed")
        if identity.provider != flow.provider or not self._nonce_matches(identity, flow):
            return _failure("oauth_failed")

        if flow.purpose is OAuthPurpose.LINK:
            return self._connect(flow, identity, session_token)
        return self._sign_in(flow, identity, user_agent)

    @staticmethod
    def _nonce_matches(identity: OAuthIdentity, flow: OAuthFlow) -> bool:
        """Defence in depth: the orchestrator re-checks the nonce even though the adapter did."""
        return identity.nonce is not None and hmac.compare_digest(
            identity.nonce.encode(), flow.nonce.encode()
        )

    # -- sign in (login flows) -----------------------------------------------------------------

    def _sign_in(
        self, flow: OAuthFlow, identity: OAuthIdentity, user_agent: str | None
    ) -> CallbackOutcome:
        for _attempt in range(2):
            try:
                with transaction(self._session):
                    return self._resolve_login(flow, identity, user_agent)
            except Rejected as rejected:
                return _failure(rejected.code)
            except IntegrityError:
                # Lost a race on (provider, subject) or the email: re-resolve with the winner.
                continue
        return _failure("oauth_failed")

    def _identity_email(self, identity: OAuthIdentity) -> str:
        if identity.email is None:
            raise Rejected("oauth_failed")
        try:
            return normalize_email(identity.email)
        except ValueError:
            raise Rejected("oauth_failed") from None

    def _resolve_login(
        self, flow: OAuthFlow, identity: OAuthIdentity, user_agent: str | None
    ) -> CallbackOutcome:
        """Cases A, B, C1-C4 and the C2 claim (AUTH_RBAC.md §10.4). Runs in ONE transaction."""
        now = self._clock()
        email = self._identity_email(identity)
        existing = self._identities.get_by_subject(identity.provider, identity.subject)

        if existing is not None:  # Case B — the subject is authoritative, whatever the email says
            user = self._users.lock(existing.user_id)
            if user is None:
                raise Rejected("oauth_failed")
            if user.status != UserStatus.ACTIVE:
                raise Rejected("account_disabled")
            existing.provider_email = email  # informational only; never moves ownership
            user.last_login_at = now
            return self._finish_login(
                flow, user, identity, now, user_agent, AuthEventType.LOGIN_SUCCESS
            )

        owner = self._users.lock_by_email(email)
        if owner is None:  # Case A — a brand-new Resident
            return self._create_user(flow, identity, email, now, user_agent)
        return self._collide(flow, owner, identity, email, now, user_agent)

    def _collide(
        self,
        flow: OAuthFlow,
        owner: User,
        identity: OAuthIdentity,
        email: str,
        now: datetime,
        user_agent: str | None,
    ) -> CallbackOutcome:
        """The Google identity is new but an account already has this email. ``owner`` is locked."""
        if owner.status != UserStatus.ACTIVE:  # C4 — a suspended account is never claimed
            raise Rejected("account_disabled")
        if self._identities.get_for_user(owner.id, identity.provider) is not None:
            raise Rejected("identity_conflict")  # C4 — it already holds a different Google identity
        if not identity.email_verified:  # C3 — never act on an unverified provider email
            raise Rejected("email_not_verified")
        if owner.email_verified_at is not None:  # C1 — NO automatic linking by email
            raise Rejected("identity_conflict")
        return self._claim(flow, owner, identity, email, now, user_agent)  # C2

    def _claim(
        self,
        flow: OAuthFlow,
        user: User,
        identity: OAuthIdentity,
        email: str,
        now: datetime,
        user_agent: str | None,
    ) -> CallbackOutcome:
        """The ONLY email-match exception (AUTH_RBAC.md §10.4): reclaim a never-verified account.

        Reached only with the user row locked and every condition just re-checked under that lock:
        active, ``email_verified_at IS NULL``, Google asserts the same email as verified, and no
        conflicting provider identity. A password set by the unverified party is cleared, every
        existing session is revoked, outstanding one-time tokens are retired, and the person who
        proved the mailbox through Google gets one fresh session.
        """
        self._identities.add(
            AuthIdentity(
                user_id=user.id,
                provider=identity.provider,
                provider_subject=identity.subject,
                provider_email=email,
            )
        )
        user.email_verified_at = now
        user.password_hash = None
        revoked = self._sessions.revoke_all(user.id, SessionRevokeReason.ACCOUNT_CLAIMED)
        self._tokens.invalidate_unconsumed(
            user.id, [AuthTokenPurpose.EMAIL_VERIFICATION, AuthTokenPurpose.PASSWORD_RESET], now
        )
        details = {"provider": identity.provider}
        self._audit.record(AuthEventType.ACCOUNT_CLAIMED, user_id=user.id, details=details)
        for session_id in revoked:
            self._audit.record(
                AuthEventType.SESSION_REVOKED,
                user_id=user.id,
                details={"reason": SessionRevokeReason.ACCOUNT_CLAIMED, "session_id": session_id},
            )
        self._audit.record(AuthEventType.IDENTITY_LINKED, user_id=user.id, details=details)
        user.last_login_at = now
        return self._finish_login(
            flow, user, identity, now, user_agent, AuthEventType.LOGIN_SUCCESS
        )

    def _create_user(
        self,
        flow: OAuthFlow,
        identity: OAuthIdentity,
        email: str,
        now: datetime,
        user_agent: str | None,
    ) -> CallbackOutcome:
        """Case A: a normal Resident — no password, no roles, no professional profile."""
        user = User(
            email=email,
            display_name=_display_name(identity.name, email),
            password_hash=None,
            status=UserStatus.ACTIVE,
            # Verified only because the provider explicitly asserted it; never inferred.
            email_verified_at=now if identity.email_verified else None,
            last_login_at=now,
        )
        self._users.add(user)
        self._identities.add(
            AuthIdentity(
                user_id=user.id,
                provider=identity.provider,
                provider_subject=identity.subject,
                provider_email=email,
            )
        )
        emails: tuple[EmailMessage, ...] = ()
        if user.email_verified_at is None:  # frozen §9: created unverified + a verification email
            raw = issue_token(
                self._tokens, user, AuthTokenPurpose.EMAIL_VERIFICATION, VERIFICATION_TTL, now
            )
            emails = (verification_email(self._settings, user.email, raw),)
            self._audit.record(AuthEventType.EMAIL_VERIFICATION_SENT, user_id=user.id)
        details = {"provider": identity.provider}
        self._audit.record(AuthEventType.REGISTER, user_id=user.id, details=details)
        self._audit.record(AuthEventType.IDENTITY_LINKED, user_id=user.id, details=details)
        outcome = self._finish_login(flow, user, identity, now, user_agent, None)
        return CallbackOutcome(
            outcome.return_to, None, outcome.session_token, outcome.session_max_age, emails
        )

    def _finish_login(
        self,
        flow: OAuthFlow,
        user: User,
        identity: OAuthIdentity,
        now: datetime,
        user_agent: str | None,
        event: AuthEventType | None,
    ) -> CallbackOutcome:
        """A fresh session through the existing ``SessionService`` (cap, hashing, lifetimes)."""
        raw, auth_session = self._sessions.create(user.id, user_agent)
        if event is not None:
            self._audit.record(event, user_id=user.id, details={"provider": identity.provider})
        max_age = max(1, int((auth_session.expires_at - now).total_seconds()))
        return CallbackOutcome(return_to=flow.return_to, session_token=raw, session_max_age=max_age)

    # -- connect (link flows) ------------------------------------------------------------------

    def _connect(
        self, flow: OAuthFlow, identity: OAuthIdentity, session_token: str | None
    ) -> CallbackOutcome:
        """Case D: link the verified Google identity to the account that started the flow."""
        authentication = self._sessions.authenticate(session_token)
        principal = authentication.principal
        if principal is None or flow.user_id is None or principal.user_id != flow.user_id:
            return _failure("oauth_failed")  # a different (or no) B-17 session than the initiator
        for _attempt in range(2):
            try:
                with transaction(self._session):
                    return self._link(flow, identity)
            except Rejected as rejected:
                return _failure(rejected.code)
            except IntegrityError:
                continue  # raced with another link of the same identity: re-evaluate ownership
        return _failure("identity_conflict")

    def _link(self, flow: OAuthFlow, identity: OAuthIdentity) -> CallbackOutcome:
        assert flow.user_id is not None
        user = self._users.lock(flow.user_id)
        if user is None:
            raise Rejected("oauth_failed")
        if user.status != UserStatus.ACTIVE:
            raise Rejected("account_disabled")
        owner = self._identities.get_by_subject(identity.provider, identity.subject)
        if owner is not None:
            if owner.user_id == user.id:  # already connected to this very account: idempotent
                return CallbackOutcome(return_to=flow.return_to)
            raise Rejected("identity_conflict")  # belongs to someone else: never transferred
        if self._identities.get_for_user(user.id, identity.provider) is not None:
            raise Rejected("identity_conflict")  # one identity per provider per user
        email: str | None
        try:
            email = normalize_email(identity.email) if identity.email else None
        except ValueError:
            email = None
        # The account's own email and password are untouched, whatever email Google reports.
        self._identities.add(
            AuthIdentity(
                user_id=user.id,
                provider=identity.provider,
                provider_subject=identity.subject,
                provider_email=email,
            )
        )
        self._audit.record(
            AuthEventType.IDENTITY_LINKED, user_id=user.id, details={"provider": identity.provider}
        )
        return CallbackOutcome(return_to=flow.return_to)

    # -- disconnect ----------------------------------------------------------------------------

    def disconnect(self, principal: Principal, provider: AuthProvider) -> None:
        """Remove the signed-in user's own identity — never the user's last way to sign in."""
        with transaction(self._session):
            user = self._users.lock(principal.user_id)
            if user is None:
                raise AppError(ErrorCode.UNAUTHENTICATED, status_code=401)
            identity = self._identities.get_for_user(user.id, provider)
            if identity is None:
                raise AppError(ErrorCode.NOT_FOUND, status_code=404)
            methods = (1 if user.password_hash else 0) + self._identities.count_for_user(user.id)
            if methods <= 1:
                raise AppError(
                    ErrorCode.CONFLICT,
                    "Add a password or another sign-in method before disconnecting this one.",
                    status_code=409,
                )
            self._identities.delete(identity)
            self._audit.record(
                AuthEventType.IDENTITY_UNLINKED, user_id=user.id, details={"provider": provider}
            )


def _display_name(name: str | None, email: str) -> str:
    """2-60 printable characters from the profile name, else the email's local part."""
    candidate = " ".join((name or "").split())[:60]
    if len(candidate) < 2 or not candidate.isprintable():
        candidate = email.split("@", 1)[0][:60]
    if len(candidate) < 2 or not candidate.isprintable():
        candidate = "Google user"
    return candidate
