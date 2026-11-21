"""The Admin surface (Phase 12E + RBAC-B).

TWO routers share the ``/admin`` prefix, and the choice of router IS the authority:

* ``router`` — the DEFAULT, **Super Admin only** (``require_super_admin`` router-wide). The
  taxonomy routes live here. A route added to the admin surface and not deliberately moved
  elsewhere therefore fails CLOSED to the strictest authority; it can never be public and never be
  Moderator-accessible by accident.
* ``staff_router`` — ``require_staff`` router-wide, for the four listing-moderation routes ONLY
  (queue, detail, approve, reject). ``require_staff`` is the front door: the reads are scoped by
  the principal it resolved, and a decision never trusts that principal — the service reads and
  LOCKS the actor's authority inside its own transaction, after locking the listing
  (``app/services/moderation.py``). A Moderator sees and acts on only their assigned scopes; a
  listing outside their scope is indistinguishable from a missing one (``404``, never ``403``).

:data:`ADMIN_AUTHORITY` classifies every route in one place and ``test_staff_authority_api.py``
fails when a route has no entry, sits on the wrong router, or its real dependency differs.

Every response is ``Cache-Control: no-store`` (the central middleware covers errors too).

HTTP only: parse, call a service (which owns the transaction and the live-authority re-check),
shape the response.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import (
    ClockDep,
    StaffUser,
    require_staff,
    require_super_admin,
)
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

_AUTH_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
    403: {
        "model": ErrorResponse,
        "description": (
            "email_not_verified | forbidden (not staff / not a Super Admin) | csrf_failed"
        ),
    },
}

#: The DEFAULT: Super Admin only. Add a route here and it is already safe.
router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_super_admin)],
    responses=_AUTH_RESPONSES,
)

#: Staff (Super Admin or a Moderator with an effective scope). Listing moderation ONLY — putting a
#: route here is a deliberate decision that must also be recorded in ``ADMIN_AUTHORITY``.
staff_router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_staff)],
    responses=_AUTH_RESPONSES,
)

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Unknown listing / category (or out of scope)"}
}
_MODERATION_ERRORS: dict[int | str, dict[str, Any]] = {
    **_NOT_FOUND,
    409: {"model": ErrorResponse, "description": "listing_conflict | invalid_state_transition"},
    422: {"model": ErrorResponse, "description": "validation_error"},
}

#: Every route under ``/admin/*`` is classified here (RBAC-B / RBAC-C; ``AUTH_RBAC.md §27.4``
#: rule 7), including those declared in ``admin_staff.py``.
#:
#: ``scoped_staff`` — reachable by a Super Admin and by a Moderator whose live scope matches the
#: resource (the service re-checks under the row lock). Router: ``admin.staff_router``.
#:
#: ``super_admin_only`` — reachable by a Super Admin only (``require_super_admin``); a Moderator is
#: refused with ``403 forbidden``. Router: ``admin.router`` / ``admin_staff.router`` (the
#: fail-closed defaults).
#:
#: ``super_admin_sensitive`` — a Super Admin only, and ADDITIONALLY a session created within the
#: sensitive window plus a per-actor rate limit (``require_staff_mutation``). Every staff-management
#: mutation. Router: ``admin_staff.sensitive_router``.
#:
#: A CI test fails when any ``/admin/*`` route has no entry here, sits on the wrong router, or its
#: runtime dependency is weaker than the entry says.
ADMIN_AUTHORITY: dict[str, str] = {
    "GET /admin/listings": "scoped_staff",
    "GET /admin/listings/{listing_id}": "scoped_staff",
    "POST /admin/listings/{listing_id}/approve": "scoped_staff",
    "POST /admin/listings/{listing_id}/reject": "scoped_staff",
    "GET /admin/categories": "super_admin_only",
    "POST /admin/categories": "super_admin_only",
    "POST /admin/categories/reorder": "super_admin_only",
    "PATCH /admin/categories/{category_id}": "super_admin_only",
    "GET /admin/staff": "super_admin_only",
    "GET /admin/audit": "super_admin_only",
    "POST /admin/staff/moderators": "super_admin_sensitive",
    "PUT /admin/staff/moderators/{user_id}/scopes": "super_admin_sensitive",
    "POST /admin/staff/moderators/{user_id}/pause": "super_admin_sensitive",
    "POST /admin/staff/moderators/{user_id}/resume": "super_admin_sensitive",
    "DELETE /admin/staff/moderators/{user_id}": "super_admin_sensitive",
}


def _category(category: object) -> AdminCategory:
    return AdminCategory.model_validate(category, from_attributes=True)


# -- moderation ------------------------------------------------------------------------------------


@staff_router.get(
    "/listings",
    response_model=AdminListingsEnvelope,
    summary="The moderation queue, scoped to the actor's authority",
)
def moderation_queue(
    staff: StaffUser, session: DbSession, query: Annotated[AdminListingsQuery, Query()]
) -> AdminListingsEnvelope:
    """Lightweight summaries of every listing visible to the actor, optionally filtered by
    ``status`` and ``kind``; ``meta.counts`` is per status over the ACTOR'S scope (global for a
    Super Admin, assigned scopes for a Moderator). A ``pending`` queue is oldest-first; every other
    view is newest-first."""
    items, meta = AdminListingReadService(session, staff).queue(query)
    return AdminListingsEnvelope(data=items, meta=meta)


@staff_router.get(
    "/listings/{listing_id}",
    response_model=AdminListingEnvelope,
    summary="Everything a moderator needs to review one in-scope listing",
    responses=_NOT_FOUND,
)
def moderation_detail(
    listing_id: str, staff: StaffUser, session: DbSession
) -> AdminListingEnvelope:
    """The full content and the moderation history; the private stored location goes only to a
    Super Admin, a Moderator sees no location precision beyond the public projection. ``404`` for a
    listing outside the actor's scope — indistinguishable from a missing one."""
    return AdminListingEnvelope(data=AdminListingReadService(session, staff).get(listing_id))


@staff_router.post(
    "/listings/{listing_id}/approve",
    response_model=AdminListingEnvelope,
    summary="Approve a pending listing (own provider needs an override reason)",
    responses=_MODERATION_ERRORS,
)
def approve_listing(
    listing_id: str,
    payload: ApproveRequest,
    staff: StaffUser,
    session: DbSession,
    clock: ClockDep,
) -> AdminListingEnvelope:
    """``pending -> approved`` at the ``revision`` the actor reviewed. The revision is unchanged;
    a stale one is ``409 listing_conflict``, any other status ``409 invalid_state_transition``.
    A Super Admin approving their OWN ``provider`` listing needs ``overrideReason`` (>= 10 chars,
    normalised); the backend writes a ``staff_audit_events`` ``moderation_self_override`` row.
    Any other own-listing approval is ``403 self_moderation_forbidden``."""
    listing = ModerationService(session, clock).decide(
        staff,
        listing_id,
        ModerationAction.APPROVE,
        payload.revision,
        override_reason=payload.override_reason,
    )
    return AdminListingEnvelope(data=AdminListingReadService(session, staff).present(listing))


@staff_router.post(
    "/listings/{listing_id}/reject",
    response_model=AdminListingEnvelope,
    summary="Reject a pending listing, or take an approved one down",
    responses=_MODERATION_ERRORS,
)
def reject_listing(
    listing_id: str,
    payload: RejectRequest,
    staff: StaffUser,
    session: DbSession,
    clock: ClockDep,
) -> AdminListingEnvelope:
    """``pending -> rejected`` and the takedown ``approved -> rejected``, with a ``reason`` of at
    least 10 characters shown to the owner. Reject or takedown of one's own listing is
    ``403 self_moderation_forbidden`` — no override exists for these actions."""
    listing = ModerationService(session, clock).decide(
        staff,
        listing_id,
        ModerationAction.REJECT,
        payload.revision,
        reason=payload.reason,
    )
    return AdminListingEnvelope(data=AdminListingReadService(session, staff).present(listing))


# -- taxonomy (Super Admin only) ------------------------------------------------------------------


@router.get(
    "/categories",
    response_model=AdminCategoriesEnvelope,
    summary="Every category, inactive included (Super Admin only)",
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
    summary="Create a category inside an existing module (Super Admin only)",
    responses={
        409: {"model": ErrorResponse, "description": "conflict: duplicate name or slug"},
        422: {"model": ErrorResponse, "description": "validation_error"},
    },
)
def create_category(
    payload: CategoryCreate, response: Response, session: DbSession
) -> AdminCategoryEnvelope:
    return AdminCategoryEnvelope(data=_category(TaxonomyAdminService(session).create(payload)))


@router.post(
    "/categories/reorder",
    response_model=AdminCategoriesEnvelope,
    summary="Renumber one sibling group (Super Admin only)",
    responses={422: {"model": ErrorResponse, "description": "validation_error"}},
)
def reorder_categories(payload: CategoryReorder, session: DbSession) -> AdminCategoriesEnvelope:
    rows = TaxonomyAdminService(session).reorder(payload)
    return AdminCategoriesEnvelope(data=[_category(row) for row in rows])


@router.patch(
    "/categories/{category_id}",
    response_model=AdminCategoryEnvelope,
    summary="Rename, move, (de)activate or reorder one category (Super Admin only)",
    responses={
        **_NOT_FOUND,
        409: {"model": ErrorResponse, "description": "conflict: duplicate name"},
        422: {"model": ErrorResponse, "description": "validation_error"},
    },
)
def patch_category(
    category_id: str, payload: CategoryPatch, session: DbSession
) -> AdminCategoryEnvelope:
    return AdminCategoryEnvelope(
        data=_category(TaxonomyAdminService(session).patch(category_id, payload))
    )
