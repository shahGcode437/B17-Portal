"""Service requests (Phase 12F; docs/backend/API_CONTRACT.md §13).

Query / add / guarded-update only — the service owns the transaction and the state machine. The
provider is never stored: it is the owner of ``provider_listing_id`` and is joined in when needed.
"""

import dataclasses
import datetime
import uuid

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.orm import Session

from app.models import Listing, ServiceRequest, ServiceRequestStatusHistory, User
from app.models.enums import ListingKind, ListingStatus, RequestActorRole, RequestStatus


@dataclasses.dataclass(frozen=True)
class TargetListing:
    """The few columns of a listing a request needs; nothing private is ever loaded."""

    id: uuid.UUID
    kind: ListingKind
    status: ListingStatus
    owner_id: uuid.UUID | None
    title: str


@dataclasses.dataclass(frozen=True)
class RequestRow:
    """A request with its derived provider and the requester's display name."""

    request: ServiceRequest
    provider_owner_id: uuid.UUID | None
    requester_name: str


@dataclasses.dataclass(frozen=True)
class HistoryRow:
    from_status: RequestStatus | None
    to_status: RequestStatus
    actor_role: RequestActorRole
    created_at: datetime.datetime


def _requester_key(requester_id: uuid.UUID) -> ColumnElement[int]:
    """A stable 64-bit advisory-lock key for one requester's creates."""
    return func.hashtextextended(f"b17:request_create:{requester_id}", 0)


class ServiceRequestRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # -- serialising one requester's creates -------------------------------------------------------

    def lock_requester(self, requester_id: uuid.UUID) -> None:
        """Take a TRANSACTION-scoped advisory lock keyed by the requester, waiting while another
        create of theirs is in flight; the commit / rollback releases it. With the rate-limit
        checks and the counts inside the same transaction, parallel creates by one user run one at
        a time, so the frozen limits cannot be overshot."""
        self._session.execute(select(func.pg_advisory_xact_lock(_requester_key(requester_id))))

    # -- the target of a new request -------------------------------------------------------------

    def target_listing(self, listing_id: uuid.UUID) -> TargetListing | None:
        """The listing, locked ``FOR SHARE``: a concurrent moderation decision (``FOR UPDATE``) and
        this create serialise, so a request is never created against a listing in a state the
        decision has already left. Takes no other lock, so it cannot take part in a cycle."""
        row = self._session.execute(
            select(Listing.id, Listing.kind, Listing.status, Listing.owner_id, Listing.title)
            .where(Listing.id == listing_id)
            .with_for_update(read=True, of=Listing)
        ).one_or_none()
        if row is None:
            return None
        return TargetListing(row[0], row[1], row[2], row[3], row[4])

    # -- writes ----------------------------------------------------------------------------------

    def add(self, request: ServiceRequest) -> ServiceRequest:
        self._session.add(request)
        self._session.flush()
        return request

    def record_history(
        self,
        request_id: uuid.UUID,
        *,
        from_status: RequestStatus | None,
        to_status: RequestStatus,
        actor_user_id: uuid.UUID,
        actor_role: RequestActorRole,
    ) -> None:
        self._session.add(
            ServiceRequestStatusHistory(
                request_id=request_id,
                from_status=from_status,
                to_status=to_status,
                actor_user_id=actor_user_id,
                actor_role=actor_role,
                # ``clock_timestamp()`` is the wall clock at THIS write, i.e. after the request
                # row was locked; ``now()`` is the transaction's START, which under contention
                # can be earlier than the previous transition's and would order the story wrongly.
                created_at=func.clock_timestamp(),
            )
        )
        self._session.flush()

    def guarded_status_update(
        self, request_id: uuid.UUID, *, from_status: RequestStatus, to_status: RequestStatus
    ) -> bool:
        """``UPDATE … WHERE id AND status = :from``: ``True`` iff exactly that transition applied.
        Two concurrent incompatible transitions cannot both succeed — the loser matches no row."""
        result = self._session.execute(
            update(ServiceRequest)
            .where(ServiceRequest.id == request_id, ServiceRequest.status == from_status)
            .values(status=to_status, updated_at=func.clock_timestamp())
            .returning(ServiceRequest.id)
        )
        return result.first() is not None

    # -- single-request reads --------------------------------------------------------------------

    def get(self, request_id: uuid.UUID, *, lock: bool = False) -> RequestRow | None:
        """The request, its provider (the listing's owner, if the listing still exists) and the
        requester's display name. ``lock`` takes ``FOR UPDATE`` on the request row ONLY."""
        statement = (
            select(ServiceRequest, Listing.owner_id, User.display_name)
            .outerjoin(Listing, Listing.id == ServiceRequest.provider_listing_id)
            .join(User, User.id == ServiceRequest.requester_id)
            .where(ServiceRequest.id == request_id)
            .execution_options(populate_existing=True)
        )
        if lock:
            statement = statement.with_for_update(of=ServiceRequest)
        row = self._session.execute(statement).one_or_none()
        if row is None:
            return None
        return RequestRow(request=row[0], provider_owner_id=row[1], requester_name=row[2])

    def history(self, request_id: uuid.UUID) -> list[HistoryRow]:
        rows = self._session.execute(
            select(
                ServiceRequestStatusHistory.from_status,
                ServiceRequestStatusHistory.to_status,
                ServiceRequestStatusHistory.actor_role,
                ServiceRequestStatusHistory.created_at,
            )
            .where(ServiceRequestStatusHistory.request_id == request_id)
            .order_by(ServiceRequestStatusHistory.created_at, ServiceRequestStatusHistory.id)
        ).all()
        return [HistoryRow(r[0], r[1], r[2], r[3]) for r in rows]

    # -- lists -----------------------------------------------------------------------------------

    def requester_page(
        self, requester_id: uuid.UUID, status: RequestStatus | None, limit: int, offset: int
    ) -> tuple[int, list[ServiceRequest]]:
        """The requester's own requests, newest first."""
        conditions = [ServiceRequest.requester_id == requester_id]
        if status is not None:
            conditions.append(ServiceRequest.status == status)
        total = self._session.scalar(
            select(func.count()).select_from(ServiceRequest).where(*conditions)
        )
        rows = self._session.scalars(
            select(ServiceRequest)
            .where(*conditions)
            .order_by(ServiceRequest.created_at.desc(), ServiceRequest.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return int(total or 0), list(rows)

    def lead_page(
        self, owner_id: uuid.UUID, status: RequestStatus | None, limit: int, offset: int
    ) -> tuple[int, list[tuple[ServiceRequest, str]]]:
        """Requests made to listings the caller OWNS (whatever the listing's status now is),
        newest first, with the requester's display name — one query, however many rows."""
        conditions = [Listing.owner_id == owner_id]
        if status is not None:
            conditions.append(ServiceRequest.status == status)
        total = self._session.scalar(
            select(func.count())
            .select_from(ServiceRequest)
            .join(Listing, Listing.id == ServiceRequest.provider_listing_id)
            .where(*conditions)
        )
        rows = self._session.execute(
            select(ServiceRequest, User.display_name)
            .join(Listing, Listing.id == ServiceRequest.provider_listing_id)
            .join(User, User.id == ServiceRequest.requester_id)
            .where(*conditions)
            .order_by(ServiceRequest.created_at.desc(), ServiceRequest.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return int(total or 0), [(row[0], row[1]) for row in rows]
