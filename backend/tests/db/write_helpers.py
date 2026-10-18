"""Helpers for the listing-write API tests (real PostgreSQL, real app, one cookie jar per browser).

``signed_in`` logs a fresh account in through the real login endpoint; the payload builders live in
``tests.write_payloads`` (DB-free) and are re-exported here.
"""

import uuid
from typing import Any

from httpx import Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Listing, ListingStatusHistory
from app.models.enums import ActorRole, HistoryAction, ListingStatus, PlanCode
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
    tutor_body,
)

__all__ = [
    "LISTINGS",
    "MINE",
    "PROFILE",
    "approximate",
    "area_only",
    "archive",
    "business_body",
    "codes",
    "create",
    "created_id",
    "error_code",
    "exact",
    "food_body",
    "history",
    "mine",
    "patch",
    "property_body",
    "provider_body",
    "set_status",
    "signed_in",
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
    display_name: str = "Sana Baker",
) -> AuthApi:
    """A browser signed in (real login) as a fresh account with the given capabilities."""
    make_account(
        env.session,
        email,
        verified=verified,
        professional=professional,
        admin=admin,
        display_name=display_name,
    )
    api = env.client()
    response = api.login(email)
    assert response.status_code == 200, response.text
    return api


def create(api: AuthApi, body: dict[str, Any]) -> Response:
    return api.request("POST", LISTINGS, json=body)


def created_id(api: AuthApi, body: dict[str, Any]) -> str:
    response = create(api, body)
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


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
    owner_id = listing.owner_id
    assert owner_id is not None
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
                actor_user_id=owner_id,  # any user satisfies the FK; the role is what matters
                actor_role=ActorRole.ADMIN,
                reason=reason or "Please add opening hours and a clearer description.",
            )
        )
    session.commit()
    session.expire_all()
