"""Service-request reads (Phase 12F; docs/backend/API_CONTRACT.md §13).

Three audiences, three mappers: the requester's own list, the provider's inbox (``leads``), and a
single request that either party may open. A non-party gets the same ``404`` as a missing or
malformed id — no response ever says "that exists but is not yours". Reads never depend on the
target listing's current status, so a request survives the listing being edited, archived or taken
down.
"""

import uuid

from sqlalchemy.orm import Session

from app.repositories.service_requests import RequestRow, ServiceRequestRepository
from app.schemas.envelope import PageMeta
from app.schemas.requests import (
    LeadSummary,
    RequestsQuery,
    ServiceRequestDetail,
    ServiceRequestSummary,
)
from app.services.request_mappers import map_detail, map_lead, map_summary
from app.services.service_requests import not_found, parse_id, party_role


class ServiceRequestReadService:
    def __init__(self, session: Session) -> None:
        self._requests = ServiceRequestRepository(session)

    def mine(
        self, requester_id: uuid.UUID, query: RequestsQuery
    ) -> tuple[list[ServiceRequestSummary], PageMeta]:
        total, rows = self._requests.requester_page(
            requester_id, query.status, query.limit, query.offset
        )
        meta = PageMeta(total=total, limit=query.limit, offset=query.offset)
        return [map_summary(row) for row in rows], meta

    def leads(
        self, owner_id: uuid.UUID, query: RequestsQuery
    ) -> tuple[list[LeadSummary], PageMeta]:
        total, rows = self._requests.lead_page(owner_id, query.status, query.limit, query.offset)
        meta = PageMeta(total=total, limit=query.limit, offset=query.offset)
        return [map_lead(request, name) for request, name in rows], meta

    def get(self, user_id: uuid.UUID, raw_id: str) -> ServiceRequestDetail:
        row = self._requests.get(parse_id(raw_id))
        if row is None:
            raise not_found()
        return self.present(row, user_id)

    def present(self, row: RequestRow, user_id: uuid.UUID) -> ServiceRequestDetail:
        role = party_role(row, user_id)
        if role is None:
            raise not_found()
        return map_detail(
            row.request, row.requester_name, role, self._requests.history(row.request.id)
        )
