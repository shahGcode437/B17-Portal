"""The "new sign-in" notice (EMAIL-1; docs/backend/AUTH_RBAC.md §14.3).

Prepared **only** where a sign-in creates a session: the password login and a Google sign-in to an
existing account. Reading a session (``/auth/me``, a refresh, any authenticated request) never comes
here, and neither does registration, password-session rotation or *Connect Google*. A replayed
OAuth callback creates no session, so it creates no notice either.

Two rules protect other people and the sending quota:

* only a **verified** address is written to - otherwise anyone could register a stranger's address
  and then send them mail by signing in;
* at most ``LOGIN_NOTICE`` per account per window, so repeated sign-ins cannot use up the quota
  that verification and password-reset mail depend on. A suppressed notice is logged.

It runs **after** the sign-in committed and **never raises**: a login must not fail because a
notification could not be prepared.
"""

import logging
import uuid
from datetime import datetime

from app.core.config import Settings
from app.core.rate_limit import LOGIN_NOTICE, RateLimiter
from app.services.email import EmailMessage
from app.services.email_templates import LoginMethod, login_notice_email

logger = logging.getLogger("app.email")


def login_notices(
    settings: Settings,
    limiter: RateLimiter,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    email: str,
    email_verified: bool,
    method: LoginMethod,
    occurred_at: datetime,
) -> tuple[EmailMessage, ...]:
    """The messages (one or none) to send for a sign-in that has just been committed."""
    if not email_verified:
        return ()
    try:
        if not limiter.hit(str(user_id), LOGIN_NOTICE).allowed:  # its own small transaction
            logger.warning(
                "login notice suppressed", extra={"emailKind": "login_notice", "reason": "cap"}
            )
            return ()
        message = login_notice_email(
            settings,
            email,
            method=method,
            occurred_at=occurred_at,
            # One notice per session: the provider drops a repeat of the same event.
            idempotency_key=f"login-notice/{session_id}",
        )
    except Exception as error:  # deliberately broad: the sign-in has already succeeded
        logger.error(
            "login notice not prepared",
            extra={"emailKind": "login_notice", "errorType": type(error).__name__},
        )
        return ()
    return (message,)
