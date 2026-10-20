"""Service requests and the provider inbox (Phase 12F; docs/backend/API_CONTRACT.md §10.2, §13).

Guards (AUTH_RBAC.md §22.1): create = ``VerifiedUser``; reads and the four actions = ``CurrentUser``
(the service enforces that the caller is a party: the requester, or the owner of the target
listing, with ``404`` for everyone else); the inbox = ``ProfessionalUser``. The requester and the
provider are never taken from a body or a path. Every response is ``Cache-Control: no-store``.
HTTP only: parse, call a service, shape the response.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import CurrentUser, ProfessionalUser, VerifiedUser
from app.dependencies.db import DbSession
from app.dependencies.write import NoStore, ServiceRequestServiceDep
from app.schemas.requests import (
    ActionRequest,
    LeadsEnvelope,
    RequestsQuery,
    ServiceRequestCreate,
    ServiceRequestEnvelope,
    ServiceRequestsEnvelope,
)
from app.services.request_reads import ServiceRequestReadService
from app.services.request_rules import RequestAction

router = APIRouter(
    route_class=ContractRoute,
    tags=["requests"],
    dependencies=[NoStore],
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated / session invalid"},
        403: {
            "model": ErrorResponse,
            "description": "email_not_verified | forbidden | csrf_failed",
        },
    },
)

_ACTION_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse, "description": "Unknown, malformed, or not a party"},
    409: {"model": ErrorResponse, "description": "invalid_state_transition"},
    422: {"model": ErrorResponse, "description": "Unknown field (not_allowed)"},
}


@router.post(
    "/requests",
    status_code=201,
    response_model=ServiceRequestEnvelope,
    summary="Send a service request to a provider",
    responses={
        404: {"model": ErrorResponse, "description": "Unknown or not an approved listing"},
        422: {"model": ErrorResponse, "description": "validation_error"},
        429: {"model": ErrorResponse, "description": "rate_limited"},
    },
)
def create_request(
    payload: ServiceRequestCreate,
    response: Response,
    principal: VerifiedUser,
    service: ServiceRequestServiceDep,
    session: DbSession,
) -> ServiceRequestEnvelope:
    """The requester is the signed-in user; the provider is the target listing's owner; the status
    starts ``submitted``. ``preferredContactChannel`` is a preference only — nothing is sent."""
    request = service.create(principal.user_id, payload)
    response.headers["Location"] = f"/api/v1/requests/{request.id}"
    detail = ServiceRequestReadService(session).get(principal.user_id, str(request.id))
    return ServiceRequestEnvelope(data=detail)


@router.get("/requests", response_model=ServiceRequestsEnvelope, summary="My service requests")
def list_my_requests(
    principal: CurrentUser, session: DbSession, query: Annotated[RequestsQuery, Query()]
) -> ServiceRequestsEnvelope:
    """The requests I sent, newest first, optionally filtered by ``status``."""
    items, meta = ServiceRequestReadService(session).mine(principal.user_id, query)
    return ServiceRequestsEnvelope(data=items, meta=meta)


@router.get(
    "/users/me/leads",
    response_model=LeadsEnvelope,
    summary="Requests sent to my listings",
)
def list_my_leads(
    principal: ProfessionalUser, session: DbSession, query: Annotated[RequestsQuery, Query()]
) -> LeadsEnvelope:
    """The provider inbox: requests made to listings I own (whatever the listing's status is
    now), newest first, optionally filtered by ``status``."""
    items, meta = ServiceRequestReadService(session).leads(principal.user_id, query)
    return LeadsEnvelope(data=items, meta=meta)


@router.get(
    "/requests/{request_id}",
    response_model=ServiceRequestEnvelope,
    summary="One service request",
    responses={404: {"model": ErrorResponse, "description": "Unknown, malformed, or not a party"}},
)
def get_request(
    request_id: str, principal: CurrentUser, session: DbSession
) -> ServiceRequestEnvelope:
    """Readable by the requester and by the owner of the target listing; anyone else gets the same
    ``404`` as for a missing request."""
    return ServiceRequestEnvelope(
        data=ServiceRequestReadService(session).get(principal.user_id, request_id)
    )


def _act(
    action: RequestAction,
    request_id: str,
    principal: CurrentUser,
    service: ServiceRequestServiceDep,
    session: DbSession,
) -> ServiceRequestEnvelope:
    row = service.act(principal.user_id, request_id, action)
    return ServiceRequestEnvelope(
        data=ServiceRequestReadService(session).present(row, principal.user_id)
    )


@router.post(
    "/requests/{request_id}/accept",
    response_model=ServiceRequestEnvelope,
    summary="Accept a request (provider)",
    responses=_ACTION_RESPONSES,
)
def accept_request(
    request_id: str,
    principal: CurrentUser,
    service: ServiceRequestServiceDep,
    session: DbSession,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """Provider only: ``submitted -> accepted``."""
    return _act(RequestAction.ACCEPT, request_id, principal, service, session)


@router.post(
    "/requests/{request_id}/start",
    response_model=ServiceRequestEnvelope,
    summary="Start work on a request (provider)",
    responses=_ACTION_RESPONSES,
)
def start_request(
    request_id: str,
    principal: CurrentUser,
    service: ServiceRequestServiceDep,
    session: DbSession,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """Provider only: ``accepted -> in-progress``."""
    return _act(RequestAction.START, request_id, principal, service, session)


@router.post(
    "/requests/{request_id}/complete",
    response_model=ServiceRequestEnvelope,
    summary="Complete a request (provider)",
    responses=_ACTION_RESPONSES,
)
def complete_request(
    request_id: str,
    principal: CurrentUser,
    service: ServiceRequestServiceDep,
    session: DbSession,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """Provider only: ``in-progress -> completed`` (terminal)."""
    return _act(RequestAction.COMPLETE, request_id, principal, service, session)


@router.post(
    "/requests/{request_id}/cancel",
    response_model=ServiceRequestEnvelope,
    summary="Cancel a request",
    responses=_ACTION_RESPONSES,
)
def cancel_request(
    request_id: str,
    principal: CurrentUser,
    service: ServiceRequestServiceDep,
    session: DbSession,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """The requester while ``submitted`` or ``accepted``; the provider in any non-terminal state
    (``submitted``, ``accepted``, ``in-progress``). ``completed`` and ``cancelled`` are final."""
    return _act(RequestAction.CANCEL, request_id, principal, service, session)
