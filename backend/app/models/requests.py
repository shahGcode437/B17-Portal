"""Service requests and their append-only status history (Phase 12F; DATA_MODEL.md §16).

A request is an in-app record: ``submitted -> accepted -> in-progress -> completed`` or
``cancelled``. The provider is *derived* — the owner of ``provider_listing_id`` — never stored as a
user id, so there is no second copy of ownership to drift. ``provider_name_snapshot`` keeps the
request intelligible after the listing is renamed, taken down or archived; the FK is ``SET NULL``
so a hard-deleted listing never destroys a requester's history. The requester FK is ``RESTRICT``:
users are tombstoned, never deleted, so a request always keeps a valid requester.

The service rule "the target is an approved provider listing, not the requester's own" is not a
database constraint (it is checked at creation only; an existing request outlives the listing's
later status). Allowed transitions and who may drive them are the service's state machine
(``services/request_rules.py``); the database guards the vocabulary and the shape of the history.
"""

import datetime
import uuid

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import ContactChannel, RequestActorRole, RequestStatus


class ServiceRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_requests"

    requester_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    provider_listing_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("listings.id", ondelete="SET NULL")
    )
    provider_name_snapshot: Mapped[str] = mapped_column(String(100), nullable=False)
    service: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[str] = mapped_column(String(500), nullable=False)
    area: Mapped[str] = mapped_column(String(80), nullable=False)
    preferred_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    preferred_time: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(500))
    preferred_contact_channel: Mapped[ContactChannel] = mapped_column(
        str_enum(ContactChannel), nullable=False, server_default=ContactChannel.IN_APP.value
    )
    status: Mapped[RequestStatus] = mapped_column(
        str_enum(RequestStatus), nullable=False, server_default=RequestStatus.SUBMITTED.value
    )

    __table_args__ = (
        in_values("status", RequestStatus, name="status_valid"),
        in_values("preferred_contact_channel", ContactChannel, name="contact_channel_valid"),
        CheckConstraint("char_length(btrim(details)) >= 10", name="details_min_length"),
        CheckConstraint("char_length(btrim(service)) >= 1", name="service_not_blank"),
        CheckConstraint("char_length(btrim(area)) >= 2", name="area_min_length"),
        CheckConstraint(
            "char_length(btrim(provider_name_snapshot)) >= 1", name="provider_name_not_blank"
        ),
        Index("ix_service_requests_provider_listing_id_status", "provider_listing_id", "status"),
    )


# The requester's own list: newest first.
Index(
    "ix_service_requests_requester_id_created_at",
    ServiceRequest.requester_id,
    ServiceRequest.created_at.desc(),
)


class ServiceRequestStatusHistory(UUIDPrimaryKeyMixin, Base):
    """Append-only: one row per creation or transition, written in the same transaction as the
    status change. The actor is the signed-in user; ``actor_role`` says in which capacity they
    acted. There is no ``updated_at`` on purpose."""

    __tablename__ = "service_request_status_history"

    request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("service_requests.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[RequestStatus | None] = mapped_column(str_enum(RequestStatus))
    to_status: Mapped[RequestStatus] = mapped_column(str_enum(RequestStatus), nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    actor_role: Mapped[RequestActorRole] = mapped_column(str_enum(RequestActorRole), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        in_values("from_status", RequestStatus, name="from_status_valid", nullable=True),
        in_values("to_status", RequestStatus, name="to_status_valid"),
        in_values("actor_role", RequestActorRole, name="actor_role_valid"),
        # Creation is the only event with no previous status, and the only one that lands on
        # ``submitted`` (nothing transitions back to it).
        CheckConstraint(
            "(from_status IS NULL) = (to_status = 'submitted')", name="from_status_iff_submitted"
        ),
        Index(
            "ix_service_request_status_history_request_id_created_at", "request_id", "created_at"
        ),
    )
