"""Service-request writes: create and the four lifecycle actions (Phase 12F;
docs/backend/API_CONTRACT.md §10.8, §13).

Layering: the service owns the transaction; the repository only queries / adds / flushes.

Create: ONE transaction: the requester's advisory lock -> rate-limit checks -> date check -> the
target listing locked ``FOR SHARE`` -> eligibility -> request + history ``submitted`` -> the
rate limits counted (``record``: no separate commit). The requester is the session user and the
provider is the listing's owner; neither is ever read from the body.

Transition (accept / start / complete / cancel): one transaction that locks the REQUEST row only
(``FOR UPDATE``), then, in this order: ``404`` for anyone who is not a party (concealment) ->
``403`` when the caller's role has no authority over the action at all ->
``409 invalid_state_transition`` when the current status does not allow it -> a guarded
``UPDATE … WHERE status = :from`` and one history row. The lock plus the guard mean two
incompatible concurrent actions cannot both win.

Lock order (BACKEND_ARCHITECTURE.md §5.1): create takes the requester's advisory lock, then the
listing row ``FOR SHARE``, and nothing else before inserting; a transition takes only its request
row. Nothing here waits on the taxonomy lock, the profile or any other row, and nothing else waits
on the requester lock, so none of these can take part in a cycle with listing or moderation writes.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.core.rate_limit import REQUEST_CREATE, REQUEST_PER_PROVIDER, RateLimiter
from app.db.session import transaction
from app.models import ServiceRequest
from app.models.enums import ListingKind, ListingStatus, RequestActorRole, RequestStatus
from app.repositories.service_requests import RequestRow, ServiceRequestRepository
from app.schemas.requests import ServiceRequestCreate
from app.services.request_rules import (
    RequestAction,
    can_transition,
    clean_optional,
    date_problem,
    has_authority,
    target_status,
)


def not_found() -> AppError:
    return AppError(ErrorCode.NOT_FOUND, status_code=404)


def parse_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise not_found() from None  # a malformed id cannot exist: same answer as an unknown one


def invalid_transition() -> AppError:
    return AppError(ErrorCode.INVALID_STATE_TRANSITION, status_code=409)


def _validation(problem: ErrorDetail) -> AppError:
    return AppError(ErrorCode.VALIDATION_ERROR, status_code=422, details=[problem])


def _rate_limited(retry_after: int) -> AppError:
    return AppError(
        ErrorCode.RATE_LIMITED, status_code=429, headers={"Retry-After": str(retry_after)}
    )


class ServiceRequestService:
    def __init__(self, session: Session, *, clock: Clock, limiter: RateLimiter) -> None:
        self._session = session
        self._clock = clock
        self._limiter = limiter
        self._requests = ServiceRequestRepository(session)

    # -- create ----------------------------------------------------------------------------------

    def create(self, requester_id: uuid.UUID, payload: ServiceRequestCreate) -> ServiceRequest:
        per_provider = f"{requester_id}:{payload.provider_listing_id}"
        with transaction(self._session):
            # First lock of the transaction: one requester's creates run one at a time, and the
            # limit checks, the insert and the limit counts all commit together, so the frozen
            # limits hold even when the same user sends several requests at once, and a request
            # that fails is never counted.
            self._requests.lock_requester(requester_id)
            for identifier, policy in (
                (str(requester_id), REQUEST_CREATE),
                (per_provider, REQUEST_PER_PROVIDER),
            ):
                decision = self._limiter.blocked(identifier, policy)
                if not decision.allowed:
                    raise _rate_limited(decision.retry_after_seconds)
            problem = date_problem(payload.preferred_date, self._clock())
            if problem is not None:
                raise _validation(problem)
            target = self._requests.target_listing(payload.provider_listing_id)
            # Not there, or not public: the same answer as the public detail route gives.
            if target is None or target.status is not ListingStatus.APPROVED:
                raise not_found()
            if target.kind is not ListingKind.PROVIDER:
                raise _validation(
                    ErrorDetail(
                        field="providerListingId",
                        code="not_requestable",
                        message="Service requests can only be sent to service providers.",
                    )
                )
            if target.owner_id == requester_id:
                raise _validation(
                    ErrorDetail(
                        field="providerListingId",
                        code="own_listing",
                        message="You cannot send a request to your own listing.",
                    )
                )
            request = self._requests.add(
                ServiceRequest(
                    requester_id=requester_id,
                    provider_listing_id=target.id,
                    provider_name_snapshot=target.title,
                    service=payload.service,
                    details=payload.details,
                    area=payload.area,
                    preferred_date=payload.preferred_date,
                    preferred_time=clean_optional(payload.preferred_time),
                    notes=clean_optional(payload.notes),
                    preferred_contact_channel=payload.preferred_contact_channel,
                    status=RequestStatus.SUBMITTED,
                )
            )
            self._requests.record_history(
                request.id,
                from_status=None,
                to_status=RequestStatus.SUBMITTED,
                actor_user_id=requester_id,
                actor_role=RequestActorRole.REQUESTER,
            )
            self._limiter.record(str(requester_id), REQUEST_CREATE)
            self._limiter.record(per_provider, REQUEST_PER_PROVIDER)
        self._session.expire(request)  # server-generated columns (timestamps) are re-read
        return request

    # -- lifecycle -------------------------------------------------------------------------------

    def act(self, user_id: uuid.UUID, raw_id: str, action: RequestAction) -> RequestRow:
        """Apply ``action`` as ``user_id`` and return the request as it now stands."""
        request_id = parse_id(raw_id)
        with transaction(self._session):
            row = self._requests.get(request_id, lock=True)
            if row is None:
                raise not_found()
            role = party_role(row, user_id)
            if role is None:
                raise not_found()  # not a party: indistinguishable from "no such request"
            if not has_authority(action, role):
                raise AppError(ErrorCode.FORBIDDEN, status_code=403)
            current = row.request.status
            if not can_transition(action, role, current):
                raise invalid_transition()
            target = target_status(action)
            if not self._requests.guarded_status_update(
                request_id, from_status=current, to_status=target
            ):  # pragma: no cover - the row lock makes this unreachable; kept as the safety net
                raise invalid_transition()
            self._requests.record_history(
                request_id,
                from_status=current,
                to_status=target,
                actor_user_id=user_id,
                actor_role=role,
            )
        refreshed = self._requests.get(request_id)
        assert refreshed is not None
        return refreshed


def party_role(row: RequestRow, user_id: uuid.UUID) -> RequestActorRole | None:
    """Which side of this request ``user_id`` is, or ``None`` for anyone else. The provider is
    whoever owns the target listing right now (``None`` if the listing was hard-deleted)."""
    if row.request.requester_id == user_id:
        return RequestActorRole.REQUESTER
    if row.provider_owner_id is not None and row.provider_owner_id == user_id:
        return RequestActorRole.PROVIDER
    return None
