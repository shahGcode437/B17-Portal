"""Saved items (Phase 12F; docs/backend/API_CONTRACT.md §10.2, §13).

Guard: any signed-in user (``CurrentUser`` — e-mail verification is not required, AUTH_RBAC.md
§22.1). The user is always the session's; no path or body names another user. Every response is
``Cache-Control: no-store``. HTTP only: parse, call a service, shape the response.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.auth import CurrentUser
from app.dependencies.db import DbSession
from app.dependencies.write import NoStore
from app.schemas.saved import SavedEnvelope, SavedQuery
from app.services.saved import SavedService

router = APIRouter(
    prefix="/saved",
    route_class=ContractRoute,
    tags=["saved"],
    dependencies=[NoStore],
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated / session invalid"},
        403: {"model": ErrorResponse, "description": "csrf_failed"},
    },
)


@router.get("", response_model=SavedEnvelope, summary="My saved listings")
def list_saved(
    principal: CurrentUser, session: DbSession, query: Annotated[SavedQuery, Query()]
) -> SavedEnvelope:
    """Newest save first. Only saved listings that are STILL approved are returned, each in its
    public card shape plus ``savedAt``; a listing that was taken down is simply absent (and comes
    back if it is re-approved)."""
    items, meta = SavedService(session).list(principal.user_id, query)
    return SavedEnvelope(data=items, meta=meta)


@router.put(
    "/{listing_id}",
    status_code=204,
    summary="Save a listing",
    responses={404: {"model": ErrorResponse, "description": "Unknown or not an approved listing"}},
)
def save_listing(listing_id: str, principal: CurrentUser, session: DbSession) -> Response:
    """Idempotent: saving twice leaves one saved item and answers ``204`` both times. Only an
    approved listing can be saved (``404`` otherwise)."""
    SavedService(session).save(principal.user_id, listing_id)
    return Response(status_code=204)


@router.delete(
    "/{listing_id}",
    status_code=204,
    summary="Remove a saved listing",
    responses={404: {"model": ErrorResponse, "description": "Malformed id"}},
)
def unsave_listing(listing_id: str, principal: CurrentUser, session: DbSession) -> Response:
    """Idempotent: ``204`` whether or not it was saved, and whatever the listing's status is now."""
    SavedService(session).unsave(principal.user_id, listing_id)
    return Response(status_code=204)
