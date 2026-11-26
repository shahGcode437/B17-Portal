"""Transactional email seam (docs/backend/AUTH_RBAC.md §14).

``EmailSender`` is the one interface the application depends on. Backends:

* ``MemoryEmailSender`` - tests: collects messages in ``outbox`` (never any network I/O);
* ``ConsoleEmailSender`` - development only: prints the message, links (and their tokens) included;
* ``ResendEmailSender`` (``email_resend.py``) - the real provider, when ``EMAIL_BACKEND=resend``;
* ``DisabledEmailSender`` - the staging/production default: refuses to send, and the caller logs an
  *event* (never the message) so an operator can see delivery is unavailable.

The messages themselves are built in ``email_templates.py``. They are handed to the dispatcher
(``email_dispatch.py``) **after the database transaction commits** and sent outside it, so a mail
outage never rolls back an account or fails a request. :func:`deliver` never raises, and what it
logs is a fixed set of safe fields: never a recipient, subject, body, link, token, key or provider
text.
"""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.core.config import Settings

logger = logging.getLogger("app.email")


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    #: The plain-text body (always present).
    body: str
    #: Which template produced it (assertable in tests; safe to log).
    kind: str = ""
    #: The one-time action link, kept separately so tests can assert on it without parsing.
    link: str | None = None
    #: The HTML alternative of ``body``.
    html: str | None = None
    #: One value per logical message, reused by every retry of it, so a provider can drop a repeat.
    idempotency_key: str = field(default_factory=lambda: uuid.uuid4().hex)


class EmailDeliveryUnavailable(RuntimeError):
    """No delivery backend is configured for this environment."""


class EmailDeliveryError(RuntimeError):
    """The provider did not accept the message, or never answered. Carries only safe fields."""

    def __init__(
        self,
        *,
        outcome: Literal["refused", "unconfirmed"],
        provider_status: int | None = None,
        provider_error: str | None = None,
        error_type: str | None = None,
        attempts: int = 1,
    ) -> None:
        self.outcome = outcome
        self.provider_status = provider_status
        self.provider_error = provider_error
        self.error_type = error_type
        self.attempts = attempts
        super().__init__(f"email {outcome}")

    def log_fields(self) -> dict[str, object]:
        return {
            "outcome": self.outcome,
            "providerStatus": self.provider_status,
            "providerError": self.provider_error,
            "errorType": self.error_type,
            "attempts": self.attempts,
        }


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None:
        """Hand the message to the backend. Returning means *accepted*, never *delivered*."""
        ...


@dataclass
class MemoryEmailSender:
    outbox: list[EmailMessage] = field(default_factory=list)

    def send(self, message: EmailMessage) -> None:
        self.outbox.append(message)

    def last(self, kind: str | None = None) -> EmailMessage | None:
        matches = [m for m in self.outbox if kind is None or m.kind == kind]
        return matches[-1] if matches else None


class ConsoleEmailSender:
    """Development only (Settings refuses it in staging/production). Prints the plain-text body."""

    def send(self, message: EmailMessage) -> None:
        print(  # noqa: T201 - the console backend exists to print
            f"\n--- email (development console backend) ---\nTo: {message.to}\n"
            f"Subject: {message.subject}\n\n{message.body}\n"
            "-------------------------------------\n",
            # A redirected stdout is block-buffered: without this the link never reaches a log file.
            flush=True,
        )


class DisabledEmailSender:
    def send(self, message: EmailMessage) -> None:
        raise EmailDeliveryUnavailable("no email delivery backend is configured")


def create_email_sender(settings: Settings) -> EmailSender:
    if settings.email_backend == "memory":
        return MemoryEmailSender()
    if settings.email_backend == "console":
        return ConsoleEmailSender()
    if settings.email_backend == "resend":
        from app.services.email_resend import ResendEmailSender  # the only provider import

        assert settings.resend_api_key is not None  # enforced by the settings validator
        return ResendEmailSender(
            api_key=settings.resend_api_key,
            sender=settings.email_from,
            reply_to=settings.email_support_address,
            timeout_seconds=settings.email_timeout_seconds,
            user_agent=f"b17-portal-api/{settings.app_version}",
        )
    return DisabledEmailSender()


def deliver(sender: EmailSender, message: EmailMessage) -> None:
    """Send one message; never raises, and never logs anything from the message but its kind."""
    try:
        sender.send(message)
    except EmailDeliveryUnavailable:
        logger.warning("email delivery unavailable", extra={"emailKind": message.kind})
    except EmailDeliveryError as error:
        logger.error(
            "email delivery unconfirmed" if error.outcome == "unconfirmed" else "email refused",
            extra={"emailKind": message.kind, **error.log_fields()},
        )
    except Exception as error:  # no traceback: an exception message could quote the e-mail
        logger.error(
            "email delivery failed",
            extra={"emailKind": message.kind, "errorType": type(error).__name__},
        )
