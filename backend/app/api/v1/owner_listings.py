"""Listing writes by their owner: create, edit / resubmit, archive (Phase 12D;
docs/backend/API_CONTRACT.md §10.2-§10.4). Guard: a verified user with a professional profile
(``ProfessionalUser``); ownership is enforced in the service (non-owner = ``404``).
"""

from fastapi import APIRouter, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import ProfessionalUser
from app.dependencies.db import DbSession
from app.dependencies.write import ListingWriteServiceDep, NoStore
from app.schemas.write import (
    ArchiveRequest,
    ListingCreate,
    ListingPatch,
    OwnerListingEnvelope,
)
from app.services.owner_reads import OwnerListingService

router = APIRouter(
    route_class=ContractRoute,
    tags=["listings"],
    dependencies=[NoStore],
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated / session invalid"},
        403: {
            "model": ErrorResponse,
            "description": (
                "email_not_verified | professional_profile_required | plan_limit_reached"
                " | csrf_failed"
            ),
        },
        422: {"model": ErrorResponse, "description": "validation_error"},
    },
)


@router.post(
    "/listings",
    status_code=201,
    response_model=OwnerListingEnvelope,
    summary="Submit a new listing for review",
    responses={429: {"model": ErrorResponse, "description": "rate_limited"}},
)
def create_listing(
    payload: ListingCreate,
    response: Response,
    principal: ProfessionalUser,
    service: ListingWriteServiceDep,
    session: DbSession,
) -> OwnerListingEnvelope:
    """A discriminated union on ``kind`` (provider, business — General or Food —, tutor,
    property). The owner is the signed-in user; the listing starts ``pending`` at ``revision 1``.
    ``Location`` points at the owner detail (the public page stays 404 until approval)."""
    listing = service.create(principal.user_id, payload)
    response.headers["Location"] = f"/api/v1/users/me/listings/{listing.id}"
    return OwnerListingEnvelope(data=OwnerListingService(session).present(listing))


@router.patch(
    "/listings/{listing_id}",
    response_model=OwnerListingEnvelope,
    summary="Edit (and, if needed, resubmit) one of my listings",
    responses={
        404: {"model": ErrorResponse, "description": "Unknown or not yours"},
        409: {"model": ErrorResponse, "description": "listing_conflict | invalid_state_transition"},
    },
)
def edit_listing(
    listing_id: str,
    payload: ListingPatch,
    principal: ProfessionalUser,
    service: ListingWriteServiceDep,
    session: DbSession,
) -> OwnerListingEnvelope:
    """Send the ``revision`` you read. Omitted = unchanged, ``null`` clears only declared-clearable
    fields, arrays and ``location`` replace whole. A no-op changes nothing; a pure visibility
    narrowing keeps the status; any other effective change returns the listing to ``pending``."""
    listing = service.edit(principal.user_id, listing_id, payload)
    return OwnerListingEnvelope(data=OwnerListingService(session).present(listing))


@router.post(
    "/listings/{listing_id}/archive",
    response_model=OwnerListingEnvelope,
    summary="Archive one of my listings",
    responses={
        404: {"model": ErrorResponse, "description": "Unknown or not yours"},
        409: {"model": ErrorResponse, "description": "listing_conflict | invalid_state_transition"},
    },
)
def archive_listing(
    listing_id: str,
    payload: ArchiveRequest,
    principal: ProfessionalUser,
    service: ListingWriteServiceDep,
    session: DbSession,
) -> OwnerListingEnvelope:
    """Terminal in V1 (no unarchive). The row is kept; it leaves public discovery and frees the
    plan's quota slot."""
    listing = service.archive(principal.user_id, listing_id, payload.revision)
    return OwnerListingEnvelope(data=OwnerListingService(session).present(listing))
