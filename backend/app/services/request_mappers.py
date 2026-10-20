"""Service-request mappers (Phase 12F): one per audience, none shared with listing mappers.

The requester's e-mail, phone number and ids never appear: the provider sees the requester's
display name, the requester sees the snapshot of the provider's name.
"""

from app.models import ServiceRequest
from app.models.enums import RequestActorRole
from app.repositories.service_requests import HistoryRow
from app.schemas.requests import (
    LeadSummary,
    RequestHistoryEntry,
    ServiceRequestDetail,
    ServiceRequestSummary,
)


def _fields(request: ServiceRequest) -> dict[str, object]:
    return {
        "id": request.id,
        "provider_listing_id": request.provider_listing_id,
        "provider_name": request.provider_name_snapshot,
        "service": request.service,
        "details": request.details,
        "area": request.area,
        "preferred_date": request.preferred_date,
        "preferred_time": request.preferred_time,
        "notes": request.notes,
        "preferred_contact_channel": request.preferred_contact_channel,
        "status": request.status,
        "created_at": request.created_at,
        "updated_at": request.updated_at,
    }


def map_summary(request: ServiceRequest) -> ServiceRequestSummary:
    """The requester's own list row."""
    return ServiceRequestSummary.model_validate(_fields(request))


def map_lead(request: ServiceRequest, requester_name: str) -> LeadSummary:
    """The provider's inbox row."""
    return LeadSummary.model_validate({**_fields(request), "requester_name": requester_name})


def map_detail(
    request: ServiceRequest,
    requester_name: str,
    viewer_role: RequestActorRole,
    history: list[HistoryRow],
) -> ServiceRequestDetail:
    return ServiceRequestDetail.model_validate(
        {
            **_fields(request),
            "requester_name": requester_name,
            "viewer_role": viewer_role,
            "history": [
                RequestHistoryEntry(
                    from_status=h.from_status,
                    to_status=h.to_status,
                    actor_role=h.actor_role,
                    created_at=h.created_at,
                )
                for h in history
            ],
        }
    )
