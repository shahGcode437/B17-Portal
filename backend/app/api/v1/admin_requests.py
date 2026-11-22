"""Portal Service requests: the provider side, handled by staff (RBAC-D;
docs/backend/API_CONTRACT.md §16, ``AUTH_RBAC.md`` §31).

A Service / Professional listing is portal-managed and has no owner, so a Service request to it is a
PORTAL request — addressed to B-17 Portal, not to whoever authored the Provider. These routes are
how the portal answers it: a Super Admin, or a Moderator who holds the ``services`` scope right now,
queues, reads, accepts, starts, completes and cancels (declines) it. The resident keeps the
requester's own API (``/requests``): read, list, cancel.

The lifecycle is the existing one, unchanged (``request_rules``); the staff member acts in the
PROVIDER capacity and the history row carries their real user id. This router is in the same
authority class as Provider authoring (``services_staff`` in ``ADMIN_AUTHORITY``): the front door is
``require_staff`` (``require_services_staff``); the scope is proven by ``PortalRequestService`` —
for a write, under lock inside its transaction. A non-services staff member gets ``403`` on the
queue (a collection) and the same ``404`` as a missing request on an id.

HTTP only: parse, call the service, shape the response.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.providers import PortalRequestDep, ServicesStaff, require_services_staff
from app.dependencies.write import NoStore
from app.schemas.requests import (
    ActionRequest,
    LeadsEnvelope,
    RequestsQuery,
    ServiceRequestEnvelope,
)
from app.services.request_rules import RequestAction

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
    403: {
        "model": ErrorResponse,
        "description": (
            "email_not_verified | forbidden (not staff, a Moderator without the services scope "
            "on the queue, or a staff role lost since the request began) | csrf_failed"
        ),
    },
}
_BY_ID: dict[int | str, dict[str, Any]] = {
    404: {
        "model": ErrorResponse,
        "description": "Unknown or malformed id, or a request outside a Moderator's scope",
    },
}
_ACTION: dict[int | str, dict[str, Any]] = {
    **_BY_ID,
    409: {"model": ErrorResponse, "description": "invalid_state_transition"},
    422: {"model": ErrorResponse, "description": "Unknown field (not_allowed)"},
}

router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_services_staff)],
    responses=_RESPONSES,
)


@router.get(
    "/requests",
    response_model=LeadsEnvelope,
    summary="The portal's Service request queue (services staff)",
)
def portal_request_queue(
    staff: ServicesStaff, service: PortalRequestDep, query: Annotated[RequestsQuery, Query()]
) -> LeadsEnvelope:
    """Every Service request made to a Provider, newest first, optionally filtered by ``status``.
    ``403`` unless the actor is a Super Admin or holds the ``services`` scope."""
    items, meta = service.queue(staff, query)
    return LeadsEnvelope(data=items, meta=meta)


@router.get(
    "/requests/{request_id}",
    response_model=ServiceRequestEnvelope,
    summary="One Service request, as the portal sees it",
    responses=_BY_ID,
)
def portal_request_detail(
    request_id: str, staff: ServicesStaff, service: PortalRequestDep
) -> ServiceRequestEnvelope:
    """The request and its history, with ``viewerRole = provider``. A Moderator without the
    ``services`` scope gets the same ``404`` as for a missing id."""
    return ServiceRequestEnvelope(data=service.get(staff, request_id))


def _act(
    action: RequestAction, request_id: str, staff: ServicesStaff, service: PortalRequestDep
) -> ServiceRequestEnvelope:
    row = service.act(staff, request_id, action)
    return ServiceRequestEnvelope(data=service.present(row))


@router.post(
    "/requests/{request_id}/accept",
    response_model=ServiceRequestEnvelope,
    summary="Accept a Service request (services staff)",
    responses=_ACTION,
)
def portal_accept_request(
    request_id: str,
    staff: ServicesStaff,
    service: PortalRequestDep,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """``submitted -> accepted``, by the portal. The actor is recorded in the request history."""
    return _act(RequestAction.ACCEPT, request_id, staff, service)


@router.post(
    "/requests/{request_id}/start",
    response_model=ServiceRequestEnvelope,
    summary="Start work on a Service request (services staff)",
    responses=_ACTION,
)
def portal_start_request(
    request_id: str,
    staff: ServicesStaff,
    service: PortalRequestDep,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """``accepted -> in-progress``."""
    return _act(RequestAction.START, request_id, staff, service)


@router.post(
    "/requests/{request_id}/complete",
    response_model=ServiceRequestEnvelope,
    summary="Complete a Service request (services staff)",
    responses=_ACTION,
)
def portal_complete_request(
    request_id: str,
    staff: ServicesStaff,
    service: PortalRequestDep,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """``in-progress -> completed`` (terminal)."""
    return _act(RequestAction.COMPLETE, request_id, staff, service)


@router.post(
    "/requests/{request_id}/cancel",
    response_model=ServiceRequestEnvelope,
    summary="Cancel (decline) a Service request (services staff)",
    responses=_ACTION,
)
def portal_cancel_request(
    request_id: str,
    staff: ServicesStaff,
    service: PortalRequestDep,
    payload: ActionRequest | None = None,
) -> ServiceRequestEnvelope:
    """The portal's way to decline a request or stop one: ``submitted`` / ``accepted`` /
    ``in-progress`` -> ``cancelled`` (terminal)."""
    return _act(RequestAction.CANCEL, request_id, staff, service)
