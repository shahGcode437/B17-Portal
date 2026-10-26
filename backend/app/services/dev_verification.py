"""Development-only: a fresh e-mail verification link for a LOCAL account.

In development the e-mail backend is ``console``: nothing is sent and the link scrolls past in the
API terminal. This helper lets a developer (or a real-browser test) get the link for a known account
without hunting through logs, **without bypassing verification**: it issues a genuine one-time token
through the normal token service (only its SHA-256 is stored, the older unconsumed ones are retired,
it expires in 24 h, it works once) and returns the same URL the verification e-mail would carry. The
account is verified only when that link is opened in a browser and the real
``POST /auth/verify-email`` runs.

It is deliberately hard to misuse:

* it refuses unless ``ENVIRONMENT`` is ``development`` or ``test`` (so ``staging`` / ``production``
  can never use it, whatever else is configured);
* it refuses unless the database host is local (a developer's shell pointed at a shared database
  fails closed);
* there is no HTTP endpoint and no setting that auto-verifies anyone - it is an operator command
  (``python -m app.cli.dev_verify``), like ``app.cli.admin``;
* the link's origin must be one of the configured frontend origins;
* the raw token is returned to the caller once and never logged.
"""

from dataclasses import dataclass

from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.security.identity import canonical_email
from app.db.session import transaction
from app.models.enums import AuthEventType, AuthTokenPurpose, UserStatus
from app.repositories.auth import TokenRepository, UserAuthRepository
from app.services.auth import VERIFICATION_TTL
from app.services.auth_audit import AuthAuditService
from app.services.auth_tokens import issue_token

#: The only environments in which this helper works.
DEV_ENVIRONMENTS = frozenset({"development", "test"})
#: Database hosts a developer machine may legitimately use (``db`` is the Compose service name).
LOCAL_DATABASE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "db"})


class DevVerificationRefused(Exception):
    """An operator-facing refusal; the message is safe to print."""


@dataclass(frozen=True)
class DevVerificationLink:
    email: str
    url: str


def ensure_development_only(settings: Settings) -> None:
    """Raise ``DevVerificationRefused`` unless this is a dev / test setup on a local database."""
    if settings.environment not in DEV_ENVIRONMENTS:
        raise DevVerificationRefused(
            f"this command only works in development (ENVIRONMENT={settings.environment!r}); "
            "production and staging use real e-mail delivery"
        )
    if settings.database_url is None:
        raise DevVerificationRefused("DATABASE_URL is not set")
    host = make_url(settings.database_url.get_secret_value()).host
    if host not in LOCAL_DATABASE_HOSTS:
        raise DevVerificationRefused(
            f"refusing to run against a non-local database host ({host!r}); "
            "this command is for a developer's own machine"
        )


def issue_dev_verification_link(
    session: Session,
    settings: Settings,
    clock: Clock,
    email: str,
    *,
    origin: str | None = None,
) -> DevVerificationLink:
    """A fresh verification URL for ``email``; ``DevVerificationRefused`` for anything unsafe."""
    ensure_development_only(settings)
    base = (origin or settings.frontend_base_url or "").rstrip("/")
    allowed = {o.rstrip("/") for o in settings.frontend_origins}
    if settings.frontend_base_url:
        allowed.add(settings.frontend_base_url.rstrip("/"))
    if not base or base not in allowed:
        raise DevVerificationRefused(
            f"the link origin {base!r} is not a configured frontend origin "
            f"(allowed: {', '.join(sorted(allowed)) or 'none'})"
        )
    key = canonical_email(email)
    users = UserAuthRepository(session)
    with transaction(session):
        user = users.lock_by_email(key)
        if user is None:
            raise DevVerificationRefused(f"no account with email {key!r}")
        if user.status != UserStatus.ACTIVE:
            raise DevVerificationRefused("the account is not active")
        if user.email_verified_at is not None:
            raise DevVerificationRefused(f"{key} is already verified - nothing to do")
        now = clock()
        token = issue_token(
            TokenRepository(session),
            user,
            AuthTokenPurpose.EMAIL_VERIFICATION,
            VERIFICATION_TTL,
            now,
        )
        AuthAuditService(session, clock).record(
            AuthEventType.EMAIL_VERIFICATION_SENT,
            user_id=user.id,
            details={"reason": "dev_verify_cli"},
        )
    return DevVerificationLink(email=key, url=f"{base}/verify-email#token={token}")
