"""Grocery order intake, customer side (GROCERY-1b; docs/backend/API_CONTRACT.md §18).

``GET /grocery/availability`` is public and carries nothing personal. Everything else needs a
verified, active account (``VerifiedUser``) and answers only about the caller's own orders: another
customer's order is the same ``404`` as a missing one, for a Super Admin and for any staff member
too. Every response is ``Cache-Control: no-store`` (the central middleware covers errors).

HTTP only: parse, call a service, shape the response.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import VerifiedUser
from app.dependencies.grocery import GroceryOrderServiceDep
from app.dependencies.write import NoStore
from app.schemas.grocery import (
    GroceryAvailabilityEnvelope,
    GroceryCancelRequest,
    GroceryOrderCreate,
    GroceryOrderEnvelope,
    GroceryOrdersEnvelope,
    GroceryOrdersQuery,
)

_AUTH_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "unauthenticated | session_expired"},
    403: {"model": ErrorResponse, "description": "email_not_verified | csrf_failed"},
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Unknown, malformed, or not your order"}
}

router = APIRouter(route_class=ContractRoute, tags=["grocery"], dependencies=[NoStore])


@router.get(
    "/grocery/availability",
    response_model=GroceryAvailabilityEnvelope,
    summary="Whether grocery orders are being accepted, and what an order may contain",
    responses={503: {"model": ErrorResponse, "description": "grocery_unavailable"}},
)
def grocery_availability(service: GroceryOrderServiceDep) -> GroceryAvailabilityEnvelope:
    return GroceryAvailabilityEnvelope(data=service.availability())


@router.post(
    "/grocery/orders",
    status_code=201,
    response_model=GroceryOrderEnvelope,
    summary="Submit a grocery order",
    responses={
        **_AUTH_RESPONSES,
        200: {"model": GroceryOrderEnvelope, "description": "The order this key already created"},
        400: {
            "model": ErrorResponse,
            "description": "idempotency_key_required | idempotency_key_invalid",
        },
        409: {
            "model": ErrorResponse,
            "description": (
                "grocery_closed | grocery_active_order_limit | grocery_capacity_reached | "
                "idempotency_key_reused"
            ),
        },
        422: {"model": ErrorResponse, "description": "validation_error"},
        429: {"model": ErrorResponse, "description": "rate_limited"},
        503: {"model": ErrorResponse, "description": "grocery_unavailable"},
    },
)
def submit_grocery_order(
    payload: GroceryOrderCreate,
    response: Response,
    principal: VerifiedUser,
    service: GroceryOrderServiceDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GroceryOrderEnvelope:
    """``Idempotency-Key`` (8 to 128 characters of ``A-Z a-z 0-9 . _ : -``) is required. A new
    order answers ``201`` with ``Location``; repeating the same key with the same order answers
    ``200`` with that order as it is now. The customer, status, reference and times are the
    server's."""
    order_id, replayed = service.submit(principal, idempotency_key, payload)
    if replayed:
        response.status_code = 200
    else:
        response.headers["Location"] = f"/api/v1/grocery/orders/{order_id}"
    return GroceryOrderEnvelope(data=service.detail(principal, str(order_id)))


@router.get(
    "/grocery/orders",
    response_model=GroceryOrdersEnvelope,
    summary="My grocery orders",
    responses=_AUTH_RESPONSES,
)
def list_my_grocery_orders(
    principal: VerifiedUser,
    service: GroceryOrderServiceDep,
    query: Annotated[GroceryOrdersQuery, Query()],
) -> GroceryOrdersEnvelope:
    """Newest first, optionally by ``status``. A summary: no address, phone or item text."""
    items, meta = service.list_own(principal, query)
    return GroceryOrdersEnvelope(data=items, meta=meta)


@router.get(
    "/grocery/orders/{order_id}",
    response_model=GroceryOrderEnvelope,
    summary="One of my grocery orders",
    responses={**_AUTH_RESPONSES, **_NOT_FOUND},
)
def get_my_grocery_order(
    order_id: str, principal: VerifiedUser, service: GroceryOrderServiceDep
) -> GroceryOrderEnvelope:
    return GroceryOrderEnvelope(data=service.detail(principal, order_id))


@router.post(
    "/grocery/orders/{order_id}/cancel",
    response_model=GroceryOrderEnvelope,
    summary="Cancel my grocery order",
    responses={
        **_AUTH_RESPONSES,
        **_NOT_FOUND,
        409: {"model": ErrorResponse, "description": "invalid_state_transition | order_conflict"},
        422: {"model": ErrorResponse, "description": "validation_error"},
    },
)
def cancel_my_grocery_order(
    order_id: str,
    payload: GroceryCancelRequest,
    principal: VerifiedUser,
    service: GroceryOrderServiceDep,
) -> GroceryOrderEnvelope:
    """``{"revision": n, "reason"?: "…"}``. The order keeps its place in the day's capacity."""
    return GroceryOrderEnvelope(data=service.cancel(principal, order_id, payload))
