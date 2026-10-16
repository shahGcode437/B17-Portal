"""The application clock.

Auth code takes "now" from an injectable callable instead of calling ``datetime.now`` or the
database's ``now()`` (which is the *transaction* start time), so expiry, throttling and rate-limit
windows are deterministic and testable. The app stores its clock on ``app.state.clock``.
"""

from collections.abc import Callable
from datetime import UTC, datetime

Clock = Callable[[], datetime]


def utcnow() -> datetime:
    """The current time as a timezone-aware UTC ``datetime``."""
    return datetime.now(UTC)
