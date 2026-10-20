"""The rate-limit seam and the initial auth policies (docs/backend/AUTH_RBAC.md §13.1).

Limits here are **identity-keyed** (a hash of the normalized email or account id) and stored in
PostgreSQL, so they are correct across any number of workers/processes. Per-IP limits are an edge
(reverse proxy / CDN / WAF) responsibility — the app does not trust ``X-Forwarded-For``, and an
in-process in-memory limiter is deliberately not provided (it is wrong with more than one worker).

The numbers below are the frozen Phase 11A values (tunable within the documented intent).
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RatePolicy:
    name: str
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class RateDecision:
    allowed: bool
    #: Seconds until the current fixed window ends (the value for ``Retry-After``).
    retry_after_seconds: int


#: Failed logins per normalized email per window; further attempts (even correct ones) get 429.
LOGIN_FAILURES = RatePolicy("login_failures", limit=10, window_seconds=15 * 60)
REGISTER = RatePolicy("register", limit=5, window_seconds=60 * 60)
FORGOT_PASSWORD = RatePolicy("forgot_password", limit=3, window_seconds=60 * 60)
RESEND_VERIFICATION_MINUTE = RatePolicy("resend_verification_minute", limit=1, window_seconds=60)
RESEND_VERIFICATION_DAY = RatePolicy(
    "resend_verification_day", limit=5, window_seconds=24 * 60 * 60
)
#: Listing creates per user (AUTH_RBAC.md §22.1: "listing create 10/hour/user, tunable"). Edits and
#: archives have no frozen number and are not throttled in Phase 12D.
LISTING_CREATE = RatePolicy("listing_create", limit=10, window_seconds=60 * 60)
#: Service-request creates (API_CONTRACT.md §10.8: "create 5 per hour per user and 1 per provider
#: per day", tunable). The second is keyed by requester + target listing ("the provider" of a
#: request IS the provider listing); both are counted only after a request was actually created.
REQUEST_CREATE = RatePolicy("request_create", limit=5, window_seconds=60 * 60)
REQUEST_PER_PROVIDER = RatePolicy("request_per_provider", limit=1, window_seconds=24 * 60 * 60)


class RateLimiter(Protocol):
    def blocked(self, identifier: str, policy: RatePolicy) -> RateDecision:
        """Is ``identifier`` already over ``policy`` (without counting this call)?"""
        ...

    def hit(self, identifier: str, policy: RatePolicy) -> RateDecision:
        """Count one event; ``allowed`` is false once the window's limit is exceeded."""
        ...

    def record(self, identifier: str, policy: RatePolicy) -> RateDecision:
        """Like ``hit`` but WITHOUT ending the transaction: the count commits or rolls back with
        the caller's own transaction (so an event is counted exactly when its work was done)."""
        ...
