"""Grocery operating settings, Super Admin only (GROCERY-1b; docs/backend/API_CONTRACT.md §18).

Classified in ``admin.ADMIN_AUTHORITY`` as ``super_admin_only``: the router default is
``require_super_admin``, so a Moderator — a ``grocery`` one included — is ``403``. The change also
passes a per-actor rate limit, and the service re-reads the role under lock.

HTTP only: parse, call the service, shape the response.
"""

from typing import Any

from fastapi import APIRouter, Depends

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import require_super_admin
from app.dependencies.grocery import GrocerySettingsServiceDep, GrocerySettingsWriter
from app.dependencies.write import NoStore
from app.schemas.grocery import GrocerySettingsEnvelope, GrocerySettingsPatch

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
    403: {"model": ErrorResponse, "description": "email_not_verified | forbidden | csrf_failed"},
    503: {"model": ErrorResponse, "description": "grocery_unavailable"},
}

router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_super_admin)],
    responses=_RESPONSES,
)


@router.get(
    "/grocery/settings",
    response_model=GrocerySettingsEnvelope,
    summary="Grocery operating settings",
)
def read_grocery_settings(service: GrocerySettingsServiceDep) -> GrocerySettingsEnvelope:
    return GrocerySettingsEnvelope(data=service.read())


@router.patch(
    "/grocery/settings",
    response_model=GrocerySettingsEnvelope,
    summary="Change the grocery operating settings",
    responses={
        409: {"model": ErrorResponse, "description": "conflict (stale_revision)"},
        422: {"model": ErrorResponse, "description": "validation_error"},
        429: {"model": ErrorResponse, "description": "rate_limited"},
    },
)
def update_grocery_settings(
    payload: GrocerySettingsPatch,
    actor: GrocerySettingsWriter,
    service: GrocerySettingsServiceDep,
) -> GrocerySettingsEnvelope:
    """``revision`` is the version you read. Omitted fields stay as they are; lists replace whole.
    Each real change creates a new, permanent version."""
    return GrocerySettingsEnvelope(data=service.update(actor, payload))
