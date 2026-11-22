"""Helpers for the listing-write API tests (real PostgreSQL, real app, one cookie jar per browser).

``signed_in`` logs a fresh account in through the real login endpoint; the payload builders live in
``tests.write_payloads`` (DB-free) and are re-exported here.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from httpx import Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Listing, ListingStatusHistory
from app.models.enums import ActorRole, CategoryModule, HistoryAction, ListingStatus, PlanCode
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.write_payloads import (
    LISTINGS,
    MINE,
    PROFILE,
    approximate,
    area_only,
    business_body,
    exact,
    food_body,
    property_body,
    provider_body,
    staff_provider_body,
    tutor_body,
)

PROVIDERS = "/admin/providers"

__all__ = [
    "LISTINGS",
    "MINE",
    "PROFILE",
    "PROVIDERS",
    "approximate",
    "area_only",
    "archive",
    "archive_provider",
    "business_body",
    "codes",
    "create",
    "create_provider",
    "created_id",
    "error_code",
    "exact",
    "food_body",
    "history",
    "mine",
    "patch",
    "patch_provider",
    "property_body",
    "provider_body",
    "set_status",
    "signed_in",
    "staff_provider_body",
    "stored",
    "stored_columns",
    "tutor_body",
]


def signed_in(
    env: AuthEnv,
    email: str = "sana@example.org",
    *,
    verified: bool = True,
    professional: PlanCode | None = PlanCode.FREE,
    admin: bool = False,
    moderator_scopes: Sequence[CategoryModule] | None = None,
    display_name: str = "Sana Baker",
) -> AuthApi:
    """A browser signed in (real login) as a fresh account with the given capabilities.

    ``moderator_scopes`` makes a Moderator (RBAC-A): ``[]`` = the role with no scope.

    Default is a plain professional (least-privileged owner). Tests that create, edit or archive a
    Service / Professional (``provider``) listing opt in with ``admin=True`` (or a ``services``
    Moderator) — provider listings are portal-managed (``docs/backend/AUTH_RBAC.md §27.9``, §31) and
    only staff author them, through ``/admin/providers``. Keeping the default non-admin means a
    future authorization regression would show up as a test failure rather than being masked by an
    incidentally-admin principal.
    """
    make_account(
        env.session,
        email,
        verified=verified,
        professional=professional,
        admin=admin,
        moderator_scopes=moderator_scopes,
        display_name=display_name,
    )
    api = env.client()
    response = api.login(email)
    assert response.status_code == 200, response.text
    return api


def create(api: AuthApi, body: dict[str, Any]) -> Response:
    return api.request("POST", LISTINGS, json=body)


def created_id(api: AuthApi, body: dict[str, Any]) -> str:
    """The id of a listing the test SET UP through the API (asserts ``201``).

    A ``provider`` body is portal-managed and cannot be created through ``POST /listings`` any more
    (RBAC-D): fixtures that need one are authored by the signed-in STAFF account through the real
    ``POST /admin/providers`` — the one canonical path — and the body's ``kind`` (which the staff
    API does not accept) is dropped. Tests that PROBE the refusal on ``/listings`` call
    :func:`create` directly, which never rewrites anything."""
    if body.get("kind") == "provider":
        staff_body = {key: value for key, value in body.items() if key != "kind"}
        response = create_provider(api, staff_body)
    else:
        response = create(api, body)
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


def create_provider(api: AuthApi, body: dict[str, Any] | None = None) -> Response:
    """``POST /admin/providers`` — the staff Provider authoring API (RBAC-D)."""
    return api.request("POST", PROVIDERS, json=staff_provider_body() if body is None else body)


def patch_provider(api: AuthApi, listing_id: str, revision: int, **fields: Any) -> Response:
    return api.request("PATCH", f"{PROVIDERS}/{listing_id}", json={"revision": revision, **fields})


def archive_provider(api: AuthApi, listing_id: str, revision: int) -> Response:
    return api.request("POST", f"{PROVIDERS}/{listing_id}/archive", json={"revision": revision})


def patch(api: AuthApi, listing_id: str, revision: int, **fields: Any) -> Response:
    return api.request("PATCH", f"{LISTINGS}/{listing_id}", json={"revision": revision, **fields})


def archive(api: AuthApi, listing_id: str, revision: int) -> Response:
    return api.request("POST", f"{LISTINGS}/{listing_id}/archive", json={"revision": revision})


def mine(api: AuthApi, listing_id: str) -> dict[str, Any]:
    response = api.get(f"{MINE}/{listing_id}")
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def codes(response: Response) -> list[tuple[str, str]]:
    """``(field, code)`` of every detail in an error envelope."""
    return [(d["field"], d["code"]) for d in response.json()["error"].get("details", [])]


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


# -- direct database inspection (the stored truth, not the API's description of it) -----------------


def stored(session: Session, listing_id: str) -> Listing:
    session.expire_all()
    listing = session.get(Listing, uuid.UUID(listing_id), populate_existing=True)
    assert listing is not None
    return listing


def stored_columns(session: Session, listing_id: str) -> dict[str, Any]:
    row = (
        session.execute(
            text(
                "SELECT status, revision, submitted_at, title, description, area, block, address, "
                "landmark, latitude, longitude, location_visibility, public_latitude, "
                "public_longitude, search_document, tags, image_url, updated_at FROM listings "
                "WHERE id = :id"
            ),
            {"id": listing_id},
        )
        .mappings()
        .one()
    )
    return dict(row)


def history(session: Session, listing_id: str) -> list[ListingStatusHistory]:
    session.expire_all()
    return list(
        session.scalars(
            select(ListingStatusHistory)
            .where(ListingStatusHistory.listing_id == uuid.UUID(listing_id))
            .order_by(ListingStatusHistory.created_at, ListingStatusHistory.revision)
        )
    )


def set_status(
    session: Session, listing_id: str, status: ListingStatus, reason: str | None = None
) -> None:
    """Stand in for the Admin moderation API (slice 12E): move a listing's status and, for a
    rejection, append the history row the real action will write. Test setup only."""
    listing = stored(session, listing_id)
    # A Provider has no owner (RBAC-D); any existing user satisfies the history row's foreign key.
    actor_id = listing.owner_id or session.scalar(text("SELECT id FROM users ORDER BY id LIMIT 1"))
    assert actor_id is not None
    previous = listing.status
    revision = listing.revision
    session.execute(
        text("UPDATE listings SET status = :s WHERE id = :id"),
        {"s": status.value, "id": listing_id},
    )
    if status is ListingStatus.REJECTED:
        session.add(
            ListingStatusHistory(
                listing_id=uuid.UUID(listing_id),
                from_status=previous,
                to_status=ListingStatus.REJECTED,
                action=HistoryAction.REJECTED,
                revision=revision,
                actor_user_id=actor_id,  # any user satisfies the FK; the role is what matters
                actor_role=ActorRole.ADMIN,
                reason=reason or "Please add opening hours and a clearer description.",
            )
        )
    session.commit()
    session.expire_all()
