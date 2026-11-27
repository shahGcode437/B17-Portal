"""Grocery order handling, STAFF side (GROCERY-2; docs/backend/API_CONTRACT.md §19).

Every route is classified ``grocery_staff`` in ``admin.ADMIN_AUTHORITY``: a Super Admin, or a
Moderator holding the ``grocery`` scope (``require_grocery_staff``). Every change also passes the
per-actor staff write limit and is decided AGAIN, under lock, by the service. Everything is
``Cache-Control: no-store``. The queue carries no customer identity, phone, address or item text.

HTTP only: parse, call the service, shape the response.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import GroceryStaffUser, require_grocery_staff
from app.dependencies.grocery import GroceryStaffOrderServiceDep, GroceryStaffWriter
from app.dependencies.write import NoStore
from app.schemas.grocery_staff import (
    GroceryAgreementRequest,
    GroceryCompleteRequest,
    GroceryDeliveryFailedRequest,
    GroceryDispatchRequest,
    GroceryIssueRequest,
    GroceryQueueQuery,
    GroceryReagreementRequest,
    GroceryReduceAmountRequest,
    GroceryRevisionRequest,
    GroceryStaffCancelRequest,
    GroceryStaffOrderEnvelope,
    GroceryStaffOrdersEnvelope,
)

_AUTH: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
    403: {
        "model": ErrorResponse,
        "description": "email_not_verified | forbidden (own_order, super_admin_required) | "
        "csrf_failed",
    },
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Unknown or malformed order id"}
}
_CHANGE: dict[int | str, dict[str, Any]] = {
    **_NOT_FOUND,
    409: {
        "model": ErrorResponse,
        "description": "order_already_claimed | order_not_claimed | invalid_state_transition | "
        "order_conflict",
    },
    422: {"model": ErrorResponse, "description": "validation_error"},
    429: {"model": ErrorResponse, "description": "rate_limited"},
}

router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_grocery_staff)],
    responses=_AUTH,
)

_ORDER = "/grocery/orders/{order_id}"


@router.get(
    "/grocery/orders",
    response_model=GroceryStaffOrdersEnvelope,
    summary="The grocery order queue",
    responses={422: {"model": ErrorResponse, "description": "validation_error"}},
)
def grocery_order_queue(
    staff: GroceryStaffUser,
    service: GroceryStaffOrderServiceDep,
    query: Annotated[GroceryQueueQuery, Query()],
) -> GroceryStaffOrdersEnvelope:
    """Oldest first unless ``sort=newest``. Filters: ``status``, ``reference`` (or its beginning),
    ``submittedOn`` (Karachi day), ``assigned`` (``me``, ``unassigned`` or a staff id).
    ``meta.counts`` is per status under the other filters. No customer details. The caller's own
    orders are never listed or counted."""
    items, meta = service.queue(staff, query)
    return GroceryStaffOrdersEnvelope(data=items, meta=meta)


@router.get(
    _ORDER,
    response_model=GroceryStaffOrderEnvelope,
    summary="One grocery order, with what is needed to handle it",
    responses=_NOT_FOUND,
)
def grocery_order_detail(
    order_id: str, staff: GroceryStaffUser, service: GroceryStaffOrderServiceDep
) -> GroceryStaffOrderEnvelope:
    return GroceryStaffOrderEnvelope(data=service.detail(staff, order_id))


@router.post(
    f"{_ORDER}/claim",
    response_model=GroceryStaffOrderEnvelope,
    summary="Take an unassigned order",
    responses=_CHANGE,
)
def claim_grocery_order(
    order_id: str, staff: GroceryStaffWriter, service: GroceryStaffOrderServiceDep
) -> GroceryStaffOrderEnvelope:
    changed = service.claim(staff, order_id)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/release",
    response_model=GroceryStaffOrderEnvelope,
    summary="Give an order back",
    responses=_CHANGE,
)
def release_grocery_order(
    order_id: str, staff: GroceryStaffWriter, service: GroceryStaffOrderServiceDep
) -> GroceryStaffOrderEnvelope:
    changed = service.release(staff, order_id)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/confirm",
    response_model=GroceryStaffOrderEnvelope,
    summary="Record the customer's agreement and confirm the order",
    responses=_CHANGE,
)
def confirm_grocery_order(
    order_id: str,
    payload: GroceryAgreementRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    """The STAFF MEMBER records that the customer agreed (``customerAgreed: true``), how, and the
    total, which must equal the items plus fees. It is not an approval given by the customer in the
    application."""
    changed = service.confirm(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/reconfirm",
    response_model=GroceryStaffOrderEnvelope,
    summary="Record a new customer agreement (changed price or substitution)",
    responses=_CHANGE,
)
def reconfirm_grocery_order(
    order_id: str,
    payload: GroceryReagreementRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    """As for ``confirm``, and ``consentNote`` is required: it records what the customer newly
    agreed to (for example which substitute, in place of what)."""
    changed = service.reconfirm(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/reduce-amount",
    response_model=GroceryStaffOrderEnvelope,
    summary="Lower the amount due, with a reason",
    responses=_CHANGE,
)
def reduce_grocery_order_amount(
    order_id: str,
    payload: GroceryReduceAmountRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    changed = service.reduce_amount(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/start-preparing",
    response_model=GroceryStaffOrderEnvelope,
    summary="Start buying and preparing a confirmed order",
    responses=_CHANGE,
)
def start_preparing_grocery_order(
    order_id: str,
    payload: GroceryRevisionRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    changed = service.start_preparing(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/dispatch",
    response_model=GroceryStaffOrderEnvelope,
    summary="Send the order out for delivery",
    responses=_CHANGE,
)
def dispatch_grocery_order(
    order_id: str,
    payload: GroceryDispatchRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    changed = service.dispatch(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/delivery-failed",
    response_model=GroceryStaffOrderEnvelope,
    summary="Record a failed delivery attempt",
    responses=_CHANGE,
)
def record_failed_grocery_delivery(
    order_id: str,
    payload: GroceryDeliveryFailedRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    """Back to ``preparing``, ready for another attempt. Nothing is delivered or paid."""
    changed = service.delivery_failed(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/complete",
    response_model=GroceryStaffOrderEnvelope,
    summary="Record delivery and the cash collected",
    responses=_CHANGE,
)
def complete_grocery_order(
    order_id: str,
    payload: GroceryCompleteRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    """``amountCollectedPaisa`` must equal the amount due. Delivery and payment are recorded
    together, once."""
    changed = service.complete(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/cancel",
    response_model=GroceryStaffOrderEnvelope,
    summary="Cancel an order, with a reason",
    responses=_CHANGE,
)
def cancel_grocery_order_as_staff(
    order_id: str,
    payload: GroceryStaffCancelRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    """From ``submitted`` or ``confirmed``. From ``preparing``: Super Admin only, with
    ``procurementAcknowledged``; an issue is left for manual resolution. No refund is created."""
    changed = service.cancel(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))


@router.post(
    f"{_ORDER}/issues",
    response_model=GroceryStaffOrderEnvelope,
    summary="Record an issue for a person to resolve",
    responses=_CHANGE,
)
def record_grocery_order_issue(
    order_id: str,
    payload: GroceryIssueRequest,
    staff: GroceryStaffWriter,
    service: GroceryStaffOrderServiceDep,
) -> GroceryStaffOrderEnvelope:
    changed = service.record_issue(staff, order_id, payload)
    return GroceryStaffOrderEnvelope(data=service.detail(staff, str(changed)))
