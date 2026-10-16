"""PostgreSQL fixed-window rate limiter (no Redis, no in-process state).

Each call is its own tiny transaction: a counter must persist even when the request that caused it
later fails or rolls back (a failed login must still count). Identifiers are hashed before they
are stored, so the table never contains an email address.
"""

import hashlib
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.rate_limit import RateDecision, RatePolicy
from app.db.session import transaction
from app.repositories.auth import RateLimitRepository


def _key_hash(identifier: str) -> bytes:
    return hashlib.sha256(identifier.encode("utf-8")).digest()


def _window_start(now: datetime, policy: RatePolicy) -> datetime:
    seconds = int(now.timestamp())
    return datetime.fromtimestamp(seconds - seconds % policy.window_seconds, tz=UTC)


class PostgresRateLimiter:
    def __init__(self, session: Session, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._repository = RateLimitRepository(session)

    def _retry_after(self, now: datetime, window_start: datetime, policy: RatePolicy) -> int:
        remaining = window_start.timestamp() + policy.window_seconds - now.timestamp()
        return max(1, int(remaining) + 1)

    def blocked(self, identifier: str, policy: RatePolicy) -> RateDecision:
        now = self._clock()
        start = _window_start(now, policy)
        count = self._repository.current(_key_hash(identifier), policy.name, start)
        allowed = count < policy.limit
        return RateDecision(allowed, 0 if allowed else self._retry_after(now, start, policy))

    def hit(self, identifier: str, policy: RatePolicy) -> RateDecision:
        now = self._clock()
        start = _window_start(now, policy)
        with transaction(self._session):
            count = self._repository.increment(_key_hash(identifier), policy.name, start)
        allowed = count <= policy.limit
        return RateDecision(allowed, 0 if allowed else self._retry_after(now, start, policy))
