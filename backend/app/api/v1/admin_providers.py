"""Staff Provider authoring: create, edit, archive (RBAC-D; docs/backend/API_CONTRACT.md §16).

A Service / Professional ("provider") listing is a PORTAL-MANAGED resource: it has no personal
owner, so authority never comes from owning one — it comes from the live staff role and scope that
``ProviderAuthoringService`` reads and LOCKS inside its own transaction (a Super Admin, or a
Moderator holding the ``services`` scope). The route's purpose fixes the kind: there is no ``kind``,
``vertical``, ``ownerId``, ``status``, actor, role or scope in any request body, and any such key is
``422 not_allowed``.

This router is its own, deliberate authority class (``services_staff`` in ``ADMIN_AUTHORITY``): the
front door is ``require_staff`` plus the provider-write rate limit (``require_provider_authoring``),
which is neither the Super Admin-only default nor the moderation-only ``staff_router``. A
Moderator's answers: no staff role now → ``403``; no ``services`` scope → ``403`` on create and
``404`` for an existing id (same body as a missing one); a non-Provider id is ``404`` for
everyone.

HTTP only: parse, call the service (which owns the transaction and the live-authority re-check),
shape the response with the staff listing detail (a Moderator's location is the public projection).
"""

from typing import Any

from fastapi import APIRouter, Depends, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.db import DbSession
from app.dependencies.providers import (
    ProviderAuthor,
    ProviderAuthoringDep,
    require_provider_authoring,
)
from app.dependencies.write import NoStore
from app.schemas.admin import AdminListingEnvelope
from app.schemas.provider_admin import (
    ProviderArchiveRequest,
    ProviderCreateRequest,
    ProviderPatchRequest,
)
from app.services.admin_reads import AdminListingReadService

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
    403: {
        "model": ErrorResponse,
        "description": (
            "email_not_verified | forbidden (not staff, or a Moderator without the services scope "
            "on create) | csrf_failed"
        ),
    },
    422: {"model": ErrorResponse, "description": "validation_error"},
    429: {"model": ErrorResponse, "description": "rate_limited"},
}
_EXISTING: dict[int | str, dict[str, Any]] = {
    404: {
        "model": ErrorResponse,
        "description": "Unknown id, not a Provider, or a Provider outside a Moderator's scope",
    },
    409: {"model": ErrorResponse, "description": "listing_conflict | invalid_state_transition"},
}

router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_provider_authoring)],
    responses=_RESPONSES,
)


@router.post(
    "/providers",
    status_code=201,
    response_model=AdminListingEnvelope,
    summary="Create a Service / Professional provider (portal-managed)",
)
def create_provider(
    payload: ProviderCreateRequest,
    response: Response,
    staff: ProviderAuthor,
    service: ProviderAuthoringDep,
    session: DbSession,
) -> AdminListingEnvelope:
    """A new Provider with NO owner: ``pending`` at ``revision 1``, authored by the signed-in staff
    member (recorded in the staff audit and in the listing history, never as an owner). The
    category must be an ACTIVE ``services`` category. ``Location`` points at the staff listing
    detail."""
    listing = service.create(staff, payload)
    response.headers["Location"] = f"/api/v1/admin/listings/{listing.id}"
    return AdminListingEnvelope(data=AdminListingReadService(session, staff).present(listing))


@router.patch(
    "/providers/{provider_id}",
    response_model=AdminListingEnvelope,
    summary="Edit one Provider (a material edit returns it to pending)",
    responses=_EXISTING,
)
def edit_provider(
    provider_id: str,
    payload: ProviderPatchRequest,
    staff: ProviderAuthor,
    service: ProviderAuthoringDep,
    session: DbSession,
) -> AdminListingEnvelope:
    """Send the ``revision`` you read. Omitted = unchanged, ``null`` clears only ``image``, arrays
    and ``location`` replace whole. A no-op changes nothing; a pure visibility narrowing keeps the
    status; any other effective change returns the Provider to ``pending`` for moderation."""
    listing = service.edit(staff, provider_id, payload)
    return AdminListingEnvelope(data=AdminListingReadService(session, staff).present(listing))


@router.post(
    "/providers/{provider_id}/archive",
    response_model=AdminListingEnvelope,
    summary="Archive one Provider",
    responses=_EXISTING,
)
def archive_provider(
    provider_id: str,
    payload: ProviderArchiveRequest,
    staff: ProviderAuthor,
    service: ProviderAuthoringDep,
    session: DbSession,
) -> AdminListingEnvelope:
    """Terminal (there is no restore). The row is kept; it leaves public discovery."""
    listing = service.archive(staff, provider_id, payload.revision)
    return AdminListingEnvelope(data=AdminListingReadService(session, staff).present(listing))
