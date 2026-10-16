"""Transactional email seam (docs/backend/AUTH_RBAC.md §14).

``EmailSender`` is the one interface the application depends on; no vendor is chosen. Backends:

* ``MemoryEmailSender`` — tests: collects messages in ``outbox`` (never any network I/O);
* ``ConsoleEmailSender`` — development only: prints the message, links (and their tokens) included;
* ``DisabledEmailSender`` — staging/production until a provider exists: refuses to send, and the
  caller logs an *event* (never the message) so an operator can see delivery is unavailable.

Messages are sent **after the database transaction commits**, outside it, in a background task;
:func:`deliver` swallows (and logs, without any token) a delivery failure so a committed account is
never rolled back or answered with an error because mail was down — the user can resend.

Links carry the one-time token in the URL **fragment** (never the query string) of a *configured*
frontend base URL, never one supplied by a client (AUTH_RBAC.md §8).
"""

import logging
from dataclasses import dataclass, field
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger("app.email")


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    body: str
    #: Which template produced it (assertable in tests; safe to log).
    kind: str = ""
    #: The action link, kept separately so tests can assert on it without parsing the body.
    link: str | None = None


class EmailDeliveryUnavailable(RuntimeError):
    """No delivery backend is configured for this environment."""


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None: ...


@dataclass
class MemoryEmailSender:
    outbox: list[EmailMessage] = field(default_factory=list)

    def send(self, message: EmailMessage) -> None:
        self.outbox.append(message)

    def last(self, kind: str | None = None) -> EmailMessage | None:
        matches = [m for m in self.outbox if kind is None or m.kind == kind]
        return matches[-1] if matches else None


class ConsoleEmailSender:
    """Development only (Settings refuses it in staging/production)."""

    def send(self, message: EmailMessage) -> None:
        print(  # noqa: T201 - the console backend exists to print
            f"\n--- email (development console backend) ---\nTo: {message.to}\n"
            f"Subject: {message.subject}\n\n{message.body}\n-------------------------------------\n"
        )


class DisabledEmailSender:
    def send(self, message: EmailMessage) -> None:
        raise EmailDeliveryUnavailable("no email delivery backend is configured")


def create_email_sender(settings: Settings) -> EmailSender:
    if settings.email_backend == "memory":
        return MemoryEmailSender()
    if settings.email_backend == "console":
        return ConsoleEmailSender()
    return DisabledEmailSender()


def deliver(sender: EmailSender, message: EmailMessage) -> None:
    """Send one message; never raises, never logs the body or link."""
    try:
        sender.send(message)
    except EmailDeliveryUnavailable:
        logger.warning("email delivery unavailable", extra={"emailKind": message.kind})
    except Exception:
        logger.exception("email delivery failed", extra={"emailKind": message.kind})


# -- templates --------------------------------------------------------------------------------


def _link(settings: Settings, path: str, token: str) -> str:
    if settings.frontend_base_url is None:
        raise RuntimeError("FRONTEND_BASE_URL is not configured")
    return f"{settings.frontend_base_url}/{path}#token={token}"


def verification_email(settings: Settings, to: str, token: str) -> EmailMessage:
    link = _link(settings, "verify-email", token)
    return EmailMessage(
        to=to,
        subject="Verify your B-17 Portal email",
        body=f"Welcome to B-17 Portal.\n\nConfirm your email address:\n{link}\n\n"
        "The link works once and expires in 24 hours. If you did not create an account, ignore "
        "this message.",
        kind="email_verification",
        link=link,
    )


def password_reset_email(settings: Settings, to: str, token: str) -> EmailMessage:
    link = _link(settings, "reset-password", token)
    return EmailMessage(
        to=to,
        subject="Reset your B-17 Portal password",
        body=f"Choose a new password:\n{link}\n\nThe link works once and expires in 60 minutes. "
        "If you did not ask for this, ignore this message — your password has not changed.",
        kind="password_reset",
        link=link,
    )


def password_changed_notice(to: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Your B-17 Portal password was changed",
        body="Your password was just changed and you were signed out of your other devices. "
        "If this was not you, reset your password immediately.",
        kind="password_changed",
    )
