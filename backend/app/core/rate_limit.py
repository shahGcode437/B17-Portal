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


class RateLimiter(Protocol):
    def blocked(self, identifier: str, policy: RatePolicy) -> RateDecision:
        """Is ``identifier`` already over ``policy`` (without counting this call)?"""
        ...

    def hit(self, identifier: str, policy: RatePolicy) -> RateDecision:
        """Count one event; ``allowed`` is false once the window's limit is exceeded."""
        ...
