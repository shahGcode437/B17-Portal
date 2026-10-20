"""The service-request state machine and input rules (Phase 12F; API_CONTRACT.md §13).

Pure: no database, no clock of its own (callers pass ``now``), no HTTP. The frozen design
(API_CONTRACT.md §10.8, the frontend's ``REQUEST_TRANSITIONS``)::

    submitted -> accepted -> in-progress -> completed          (provider)
    submitted | accepted | in-progress -> cancelled            (provider)
    submitted | accepted -> cancelled                          (requester)

``completed`` and ``cancelled`` are terminal. The requester may never accept, start or complete.
"""

import datetime
import enum

from app.core.errors import ErrorDetail
from app.models.enums import RequestActorRole, RequestStatus

#: Bounds that are abuse limits, not product rules (documented in API_CONTRACT.md §13).
MAX_DAYS_AHEAD = 365

#: B-17 is in Pakistan: a fixed UTC+05:00 (no daylight saving). "Not in the past" means not before
#: *today in B-17*, so a requester late in the evening can still pick "today".
LOCAL_UTC_OFFSET = datetime.timedelta(hours=5)


class RequestAction(enum.StrEnum):
    ACCEPT = "accept"
    START = "start"
    COMPLETE = "complete"
    CANCEL = "cancel"


TARGET: dict[RequestAction, RequestStatus] = {
    RequestAction.ACCEPT: RequestStatus.ACCEPTED,
    RequestAction.START: RequestStatus.IN_PROGRESS,
    RequestAction.COMPLETE: RequestStatus.COMPLETED,
    RequestAction.CANCEL: RequestStatus.CANCELLED,
}

#: ``action -> role -> the statuses it may be applied FROM``. A role absent from an action's map
#: has no authority over it at all (``403``), whatever the status.
SOURCES: dict[RequestAction, dict[RequestActorRole, frozenset[RequestStatus]]] = {
    RequestAction.ACCEPT: {RequestActorRole.PROVIDER: frozenset({RequestStatus.SUBMITTED})},
    RequestAction.START: {RequestActorRole.PROVIDER: frozenset({RequestStatus.ACCEPTED})},
    RequestAction.COMPLETE: {RequestActorRole.PROVIDER: frozenset({RequestStatus.IN_PROGRESS})},
    RequestAction.CANCEL: {
        RequestActorRole.PROVIDER: frozenset(
            {RequestStatus.SUBMITTED, RequestStatus.ACCEPTED, RequestStatus.IN_PROGRESS}
        ),
        RequestActorRole.REQUESTER: frozenset({RequestStatus.SUBMITTED, RequestStatus.ACCEPTED}),
    },
}

TERMINAL = frozenset({RequestStatus.COMPLETED, RequestStatus.CANCELLED})


def has_authority(action: RequestAction, role: RequestActorRole) -> bool:
    """May this party ever perform ``action`` (before looking at the status)?"""
    return role in SOURCES[action]


def can_transition(action: RequestAction, role: RequestActorRole, status: RequestStatus) -> bool:
    """May ``role`` apply ``action`` to a request that is currently ``status``?"""
    return status in SOURCES[action].get(role, frozenset())


def target_status(action: RequestAction) -> RequestStatus:
    return TARGET[action]


# -- creation input -----------------------------------------------------------------------------


def local_today(now: datetime.datetime) -> datetime.date:
    """Today's date in B-17 (``now`` must be timezone-aware)."""
    return (now.astimezone(datetime.UTC) + LOCAL_UTC_OFFSET).date()


def date_problem(preferred: datetime.date, now: datetime.datetime) -> ErrorDetail | None:
    """``preferredDate``: today or later (in B-17), at most ``MAX_DAYS_AHEAD`` days out."""
    today = local_today(now)
    if preferred < today:
        return ErrorDetail(
            field="preferredDate", code="in_the_past", message="Choose today or a later date."
        )
    if preferred > today + datetime.timedelta(days=MAX_DAYS_AHEAD):
        return ErrorDetail(
            field="preferredDate",
            code="too_far_ahead",
            message=f"Choose a date within the next {MAX_DAYS_AHEAD} days.",
        )
    return None


def clean_optional(value: str | None) -> str | None:
    """Trim; blank means absent (the database stores no empty optional text)."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None
