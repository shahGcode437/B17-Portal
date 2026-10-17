"""Safety-net cleanup of authentication data (docs/backend/AUTH_RBAC.md §13.5).

Run on a schedule by the host (``python -m app.cli.auth_maintenance purge``) — there is no
background-job system in the application. **Correctness never depends on this running**: sessions,
tokens and rate-limit windows are always validated against their own timestamps. Recent audit
events are never touched; only events older than the audit retention period are removed here.
Expired sessions have no retention guarantee: login already deletes the user's expired rows,
and this sweep only removes the ones that remain.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.db.session import transaction
from app.repositories.auth import AuthMaintenanceRepository

#: The sweep threshold: sessions/tokens expired, revoked or consumed longer ago than this are
#: deleted. Not a retention promise (the durable security record is ``auth_events``).
GRACE = timedelta(days=7)
#: Rate-limit windows are at most one day long; two days is safely past any live window.
RATE_LIMIT_RETENTION = timedelta(days=2)
EVENT_RETENTION = timedelta(days=400)
#: OAuth flows live 10 minutes; one expired for a day is garbage (never needed for correctness).
OAUTH_FLOW_SWEEP = timedelta(days=1)


@dataclass(frozen=True)
class PurgeCounts:
    sessions: int
    tokens: int
    rate_limits: int
    oauth_flows: int
    events: int


class AuthMaintenanceService:
    def __init__(self, session: Session, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._repository = AuthMaintenanceRepository(session)

    def purge(self) -> PurgeCounts:
        now = self._clock()
        with transaction(self._session):
            return PurgeCounts(
                sessions=self._repository.purge_sessions(now - GRACE),
                tokens=self._repository.purge_tokens(now - GRACE),
                rate_limits=self._repository.purge_rate_limits(now - RATE_LIMIT_RETENTION),
                oauth_flows=self._repository.purge_oauth_flows(now - OAUTH_FLOW_SWEEP),
                events=self._repository.purge_events(now - EVENT_RETENTION),
            )
