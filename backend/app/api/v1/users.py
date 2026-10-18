"""The signed-in user's own resources (Phase 12D; docs/backend/API_CONTRACT.md §10.2).

``PUT /users/me/professional-profile`` and the owner views of the user's listings. Every response
is ``Cache-Control: no-store``. HTTP only: parse, call a service, shape the response.
"""

import dataclasses
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from app.api.routing import ContractRoute
from app.api.v1.auth import auth_user_body
from app.core.errors import ErrorResponse
from app.dependencies.auth import AuthServiceDep, CurrentUser, VerifiedUser
from app.dependencies.db import DbSession
from app.dependencies.settings import SettingsDep
from app.dependencies.write import NoStore
from app.schemas.auth import AuthUser
from app.schemas.envelope import Envelope
from app.schemas.write import (
    OwnerListing,
    OwnerListingEnvelope,
    OwnerListingsEnvelope,
    OwnerListingsQuery,
    ProfessionalProfileRequest,
)
from app.services.owner_reads import OwnerListingService
from app.services.professional_profiles import ProfessionalProfileService

router = APIRouter(
    prefix="/users/me",
    route_class=ContractRoute,
    tags=["users"],
    dependencies=[NoStore],
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated / session invalid"},
        403: {"model": ErrorResponse, "description": "Forbidden / CSRF failure"},
    },
)


@router.put(
    "/professional-profile",
    response_model=Envelope[AuthUser],
    summary="Create (or confirm) the professional profile",
    responses={
        201: {"model": Envelope[AuthUser], "description": "The profile was created by this call"},
        403: {"model": ErrorResponse, "description": "email_not_verified | csrf_failed"},
        422: {"model": ErrorResponse, "description": "Unknown field (not_allowed)"},
    },
)
def put_professional_profile(
    request: Request,
    response: Response,
    principal: VerifiedUser,
    auth_service: AuthServiceDep,
    settings: SettingsDep,
    db: DbSession,
    payload: ProfessionalProfileRequest | None = None,
) -> Envelope[AuthUser]:
    """Idempotent: ``201`` the first time, ``200`` afterwards, always the ``/auth/me`` shape. The
    body is ``{}`` — the plan is server-owned (``free``), so no client may set anything.
    Professional is a capability, not a role: no role row is written, no Admin power is implied."""
    plan, created = ProfessionalProfileService(db).ensure(principal.user_id)
    if created:
        response.status_code = 201
    updated = dataclasses.replace(principal, plan_code=plan)
    token = request.cookies.get(settings.auth_cookie_name, "")
    return Envelope(data=auth_user_body(updated, auth_service.account_methods(updated), token))


@router.get(
    "/listings",
    response_model=OwnerListingsEnvelope,
    summary="My listings (every status)",
)
def list_my_listings(
    principal: CurrentUser, session: DbSession, query: Annotated[OwnerListingsQuery, Query()]
) -> OwnerListingsEnvelope:
    """Newest first, optionally filtered by ``status`` and ``kind``; ``meta.counts`` is per status
    over all of the caller's listings. Includes the private location and the moderation state."""
    items, meta = OwnerListingService(session).list(principal.user_id, query)
    return OwnerListingsEnvelope(data=items, meta=meta)


@router.get(
    "/listings/{listing_id}",
    response_model=OwnerListingEnvelope,
    summary="One of my listings",
    responses={404: {"model": ErrorResponse, "description": "Unknown or not yours"}},
)
def get_my_listing(
    listing_id: str, principal: CurrentUser, session: DbSession
) -> OwnerListingEnvelope:
    """The full owner shape (exact location, status, revision, current rejection reason). Another
    user's listing answers the same ``404`` as a missing one."""
    item: OwnerListing = OwnerListingService(session).get(principal.user_id, listing_id)
    return OwnerListingEnvelope(data=item)
