"""The Admin surface: moderation and taxonomy writes (Phase 12E; docs/backend/API_CONTRACT.md
§10.2-§10.4, §10.7).

Authorization is by PREFIX and DEPENDENCY: the router declares ``require_admin`` once, so no admin
route can forget it (verified account + the ``admin`` role from ``user_roles`` + a recent session —
a session idle > 2 h or older than 12 h is ``401 session_expired`` and does not count as activity).
A non-admin gets ``403 forbidden`` before any body is validated or any row is read, whatever the id.
Every response is ``Cache-Control: no-store`` (the middleware covers errors too).

HTTP only: parse, call a service (which owns the transaction), shape the response.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import AdminUser, require_admin
from app.dependencies.db import DbSession
from app.dependencies.write import NoStore
from app.schemas.admin import (
    AdminCategoriesEnvelope,
    AdminCategory,
    AdminCategoryEnvelope,
    AdminListingEnvelope,
    AdminListingsEnvelope,
    AdminListingsQuery,
    ApproveRequest,
    CategoriesQuery,
    CategoryCreate,
    CategoryPatch,
    CategoryReorder,
    RejectRequest,
)
from app.services.admin_reads import AdminListingReadService
from app.services.moderation import ModerationService
from app.services.moderation_rules import ModerationAction
from app.services.taxonomy_admin import TaxonomyAdminService

router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_admin)],
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
        403: {
            "model": ErrorResponse,
            "description": "email_not_verified | forbidden (not an admin) | csrf_failed",
        },
    },
)

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Unknown listing / category"}
}
_MODERATION_ERRORS: dict[int | str, dict[str, Any]] = {
    **_NOT_FOUND,
    409: {"model": ErrorResponse, "description": "listing_conflict | invalid_state_transition"},
    422: {"model": ErrorResponse, "description": "validation_error"},
}


def _category(category: object) -> AdminCategory:
    return AdminCategory.model_validate(category, from_attributes=True)


# -- moderation ------------------------------------------------------------------------------------


@router.get("/listings", response_model=AdminListingsEnvelope, summary="The moderation queue")
def moderation_queue(
    session: DbSession, query: Annotated[AdminListingsQuery, Query()]
) -> AdminListingsEnvelope:
    """Lightweight summaries of every listing, optionally filtered by ``status`` and ``kind``;
    ``meta.counts`` is per status over ALL listings. A ``pending`` queue is oldest-first; every
    other view is newest-first. The exact location and the history are in the detail."""
    items, meta = AdminListingReadService(session).queue(query)
    return AdminListingsEnvelope(data=items, meta=meta)


@router.get(
    "/listings/{listing_id}",
    response_model=AdminListingEnvelope,
    summary="Everything a moderator needs to review one listing",
    responses=_NOT_FOUND,
)
def moderation_detail(listing_id: str, session: DbSession) -> AdminListingEnvelope:
    """The full content, the PRIVATE stored location (and what the public would see), the
    ``revision`` to send back, the current rejection reason, the submitter's display name and the
    moderation history. Admin only — no public or owner route ever returns this shape."""
    return AdminListingEnvelope(data=AdminListingReadService(session).get(listing_id))


@router.post(
    "/listings/{listing_id}/approve",
    response_model=AdminListingEnvelope,
    summary="Approve a pending listing",
    responses=_MODERATION_ERRORS,
)
def approve_listing(
    listing_id: str, payload: ApproveRequest, admin: AdminUser, session: DbSession
) -> AdminListingEnvelope:
    """``pending -> approved`` at the ``revision`` the admin reviewed. The revision is unchanged;
    a stale one (the owner edited meanwhile) is ``409 listing_conflict``, any other status
    ``409 invalid_state_transition``. The listing is public as soon as this commits."""
    listing = ModerationService(session).decide(
        admin.user_id, listing_id, ModerationAction.APPROVE, payload.revision
    )
    return AdminListingEnvelope(data=AdminListingReadService(session).present(listing))


@router.post(
    "/listings/{listing_id}/reject",
    response_model=AdminListingEnvelope,
    summary="Reject a pending listing, or take an approved one down",
    responses=_MODERATION_ERRORS,
)
def reject_listing(
    listing_id: str, payload: RejectRequest, admin: AdminUser, session: DbSession
) -> AdminListingEnvelope:
    """``pending -> rejected`` and the takedown ``approved -> rejected``, with a ``reason`` of at
    least 10 characters shown to the owner (who must edit and resubmit). A taken-down listing leaves
    public discovery as soon as this commits."""
    listing = ModerationService(session).decide(
        admin.user_id, listing_id, ModerationAction.REJECT, payload.revision, payload.reason
    )
    return AdminListingEnvelope(data=AdminListingReadService(session).present(listing))


# -- taxonomy --------------------------------------------------------------------------------------


@router.get(
    "/categories",
    response_model=AdminCategoriesEnvelope,
    summary="Every category, inactive included",
)
def list_categories(
    session: DbSession, query: Annotated[CategoriesQuery, Query()]
) -> AdminCategoriesEnvelope:
    rows = TaxonomyAdminService(session).list_all(query.module)
    return AdminCategoriesEnvelope(data=[_category(row) for row in rows])


@router.post(
    "/categories",
    status_code=201,
    response_model=AdminCategoryEnvelope,
    summary="Create a category inside an existing module",
    responses={
        409: {"model": ErrorResponse, "description": "conflict: duplicate name or slug"},
        422: {"model": ErrorResponse, "description": "validation_error"},
    },
)
def create_category(
    payload: CategoryCreate, response: Response, session: DbSession
) -> AdminCategoryEnvelope:
    """``module`` must be one of the code-defined modules (an admin can never add one). The slug
    is derived from the name when omitted and is immutable afterwards."""
    return AdminCategoryEnvelope(data=_category(TaxonomyAdminService(session).create(payload)))


@router.post(
    "/categories/reorder",
    response_model=AdminCategoriesEnvelope,
    summary="Renumber one sibling group",
    responses={422: {"model": ErrorResponse, "description": "validation_error"}},
)
def reorder_categories(payload: CategoryReorder, session: DbSession) -> AdminCategoriesEnvelope:
    """``orderedIds`` must be exactly the ids of the ``(module, parentId)`` group; ``displayOrder``
    becomes ``1..n`` in that order, atomically. Returns the group in its new order."""
    rows = TaxonomyAdminService(session).reorder(payload)
    return AdminCategoriesEnvelope(data=[_category(row) for row in rows])


@router.patch(
    "/categories/{category_id}",
    response_model=AdminCategoryEnvelope,
    summary="Rename, move, (de)activate or reorder one category",
    responses={
        **_NOT_FOUND,
        409: {"model": ErrorResponse, "description": "conflict: duplicate name"},
        422: {"model": ErrorResponse, "description": "validation_error"},
    },
)
def patch_category(
    category_id: str, payload: CategoryPatch, session: DbSession
) -> AdminCategoryEnvelope:
    """Omitted = unchanged. ``module`` and ``slug`` are immutable. A rename refreshes the search
    document of every listing in the category in the same transaction; deactivating hides the
    category from pickers but never breaks the listings that carry it."""
    return AdminCategoryEnvelope(
        data=_category(TaxonomyAdminService(session).patch(category_id, payload))
    )
