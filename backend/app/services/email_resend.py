"""The Resend adapter (EMAIL-1) - the only module that knows a provider exists.

``POST https://api.resend.com/emails`` over ``httpx`` (already a dependency; no SDK).

* **Bounded.** Every network operation has a timeout (``EMAIL_TIMEOUT_SECONDS``) and there are at
  most :data:`MAX_ATTEMPTS` attempts.
* **A retry cannot duplicate a message.** Every attempt carries the same ``Idempotency-Key`` (the
  message's own key; Resend keeps it for 24 hours), so even a request that was accepted before the
  connection timed out is not sent twice.
* **Only what can succeed is retried:** a network error, a ``5xx``, the per-second rate limit and
  "the same key is still being processed". A refusal (bad key, unverified domain, invalid address,
  exhausted daily / monthly quota) is final.
* **Honest outcome.** A success means the provider **accepted** the message, never that it was
  delivered. When no answer arrived, the outcome is *unconfirmed*, not "failed".
* **Nothing sensitive leaves this module** for a log or an exception: not the key, the recipient,
  the body, the link or any provider free text - only the HTTP status, an error name from the
  closed set :data:`_KNOWN_ERRORS`, an exception class name and the provider's message id.

Open and click tracking must stay **off** for the sending domain (Resend's default): click tracking
rewrites links through the provider's tracking domain, which would carry the one-time tokens there.
"""

import logging
import re
import time
from collections.abc import Callable

import httpx
from pydantic import SecretStr

from app.services.email import EmailDeliveryError, EmailMessage

logger = logging.getLogger("app.email")

ENDPOINT = "https://api.resend.com/emails"
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 0.5
MAX_RETRY_AFTER_SECONDS = 2.0

#: Error names from Resend's error reference. Anything else is reported as ``None``.
_KNOWN_ERRORS = frozenset(
    {
        "application_error",
        "concurrent_idempotent_requests",
        "daily_quota_exceeded",
        "dns_lookup_failed",
        "invalid_attachment",
        "invalid_idempotency_key",
        "invalid_idempotent_request",
        "method_not_allowed",
        "missing_api_key",
        "missing_required_field",
        "missing_required_parameter",
        "monthly_quota_exceeded",
        "not_found",
        "rate_limit_exceeded",
        "resource_locked",
        "restricted_api_key",
        "service_unavailable",
        "suspended_api_key",
        "validation_error",
    }
)
_QUOTA_ERRORS = frozenset({"daily_quota_exceeded", "monthly_quota_exceeded"})
_MESSAGE_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def _body(response: httpx.Response) -> dict[str, object]:
    try:
        parsed = response.json()
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _is_retryable(status: int, name: str | None) -> bool:
    if status >= 500:
        return True
    if status == 429:
        return name not in _QUOTA_ERRORS
    return status == 409 and name == "concurrent_idempotent_requests"


def _retry_delay(response: httpx.Response | None) -> float:
    if response is not None:
        try:
            asked = float(response.headers.get("retry-after", ""))
        except ValueError:
            pass
        else:
            return min(max(asked, 0.0), MAX_RETRY_AFTER_SECONDS)
    return RETRY_DELAY_SECONDS


class ResendEmailSender:
    def __init__(
        self,
        *,
        api_key: SecretStr,
        sender: str,
        reply_to: str | None = None,
        timeout_seconds: float = 10.0,
        user_agent: str = "b17-portal-api",
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._api_key = api_key
        self._sender = sender
        self._reply_to = reply_to
        self._user_agent = user_agent
        self._http = http or httpx.Client(timeout=timeout_seconds)
        self._sleep = sleep

    def _payload(self, message: EmailMessage) -> dict[str, object]:
        payload: dict[str, object] = {
            "from": self._sender,
            "to": [message.to],
            "subject": message.subject,
            "text": message.body,
        }
        if message.html:
            payload["html"] = message.html
        if self._reply_to:
            payload["reply_to"] = self._reply_to
        if message.kind:
            payload["tags"] = [{"name": "kind", "value": message.kind}]
        return payload

    def send(self, message: EmailMessage) -> None:
        """Returns once the provider accepted the message; raises :class:`EmailDeliveryError`."""
        headers = {
            "Authorization": f"Bearer {self._api_key.get_secret_value()}",
            "Idempotency-Key": message.idempotency_key,
            "User-Agent": self._user_agent,
        }
        payload = self._payload(message)
        for attempt in range(1, MAX_ATTEMPTS + 1):
            last = attempt == MAX_ATTEMPTS
            try:
                response = self._http.post(ENDPOINT, json=payload, headers=headers)
            except httpx.HTTPError as error:
                if last:
                    # The request may or may not have arrived: neither "sent" nor "not sent".
                    raise EmailDeliveryError(
                        outcome="unconfirmed", error_type=type(error).__name__, attempts=attempt
                    ) from None
                self._sleep(RETRY_DELAY_SECONDS)
                continue

            body = _body(response)
            if response.is_success:
                message_id = body.get("id")
                if not isinstance(message_id, str) or not _MESSAGE_ID.fullmatch(message_id):
                    raise EmailDeliveryError(
                        outcome="unconfirmed",
                        provider_status=response.status_code,
                        attempts=attempt,
                    )
                logger.info(
                    "email accepted by provider",
                    extra={
                        "emailKind": message.kind,
                        "providerMessageId": message_id,
                        "attempts": attempt,
                    },
                )
                return

            raw_name = body.get("name")
            name = raw_name if isinstance(raw_name, str) and raw_name in _KNOWN_ERRORS else None
            if last or not _is_retryable(response.status_code, name):
                raise EmailDeliveryError(
                    outcome="refused" if response.status_code < 500 else "unconfirmed",
                    provider_status=response.status_code,
                    provider_error=name,
                    attempts=attempt,
                )
            self._sleep(_retry_delay(response))
