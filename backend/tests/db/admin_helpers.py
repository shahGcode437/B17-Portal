"""Helpers for the Phase 12E admin tests (real PostgreSQL, real app, one cookie jar per browser)."""

import uuid
from typing import Any

from httpx import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.enums import PlanCode
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.write_helpers import created_id, signed_in

ADMIN = "/admin"
ADMIN_LISTINGS = "/admin/listings"
ADMIN_CATEGORIES = "/admin/categories"
PUBLIC_CATEGORIES = "/categories"


def admin_signed_in(env: AuthEnv, email: str = "admin@example.org") -> AuthApi:
    """A verified account holding the ``admin`` role (granted straight in ``user_roles``), signed in
    through the real login endpoint. It has NO professional profile: Admin is a role, not a plan."""
    return signed_in(env, email, professional=None, admin=True, display_name="Site Admin")


def owner_signed_in(
    env: AuthEnv, email: str = "owner@example.org", *, plan: PlanCode | None = PlanCode.PREMIUM
) -> AuthApi:
    return signed_in(env, email, professional=plan, display_name="Sana Baker")


def approve(api: AuthApi, listing_id: str, revision: int, **kwargs: Any) -> Response:
    return api.request(
        "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": revision}, **kwargs
    )


def reject(
    api: AuthApi,
    listing_id: str,
    revision: int,
    reason: str = "Please add your opening hours and a clearer description.",
    **kwargs: Any,
) -> Response:
    return api.request(
        "POST",
        f"{ADMIN_LISTINGS}/{listing_id}/reject",
        json={"revision": revision, "reason": reason},
        **kwargs,
    )


def queue(api: AuthApi, **params: Any) -> Response:
    return api.get(ADMIN_LISTINGS, params={k: str(v) for k, v in params.items()})


def detail(api: AuthApi, listing_id: str) -> dict[str, Any]:
    response = api.get(f"{ADMIN_LISTINGS}/{listing_id}")
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def pending(owner: AuthApi, body: dict[str, Any]) -> str:
    return created_id(owner, body)


def age_history(session: Session, listing_id: str, minutes: int = 1) -> None:
    """Make every EXISTING history row of the listing ``minutes`` older.

    ``created_at`` is the database's ``now()`` — the same instant for every statement of the test's
    single outer transaction — so a test that cares about the ORDER of history calls this between
    steps (production writes are separate transactions with distinct timestamps)."""
    session.execute(
        text(
            "UPDATE listing_status_history SET created_at = created_at - make_interval(mins => :m)"
            " WHERE listing_id = :l"
        ),
        {"m": minutes, "l": listing_id},
    )
    session.commit()


def history_of(data: dict[str, Any]) -> list[tuple[str, str | None, str, int]]:
    """``(action, fromStatus, toStatus, revision)`` of an admin detail's history."""
    return [
        (h["action"], h.get("fromStatus"), h["toStatus"], h["revision"]) for h in data["history"]
    ]


def category_body(module: str = "food", name: str = "Sweet Shops", **extra: Any) -> dict[str, Any]:
    return {"module": module, "name": name, **extra}


def create_category(
    api: AuthApi, module: str = "food", name: str = "Sweet Shops", **extra: Any
) -> Response:
    return api.request("POST", ADMIN_CATEGORIES, json=category_body(module, name, **extra))


def created_category(
    api: AuthApi, module: str = "food", name: str = "Sweet Shops", **extra: Any
) -> dict[str, Any]:
    response = create_category(api, module, name, **extra)
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def patch_category(api: AuthApi, category_id: str, **fields: Any) -> Response:
    return api.request("PATCH", f"{ADMIN_CATEGORIES}/{category_id}", json=fields)


def reorder(api: AuthApi, module: str, parent_id: str | None, ordered_ids: list[str]) -> Response:
    return api.request(
        "POST",
        f"{ADMIN_CATEGORIES}/reorder",
        json={"module": module, "parentId": parent_id, "orderedIds": ordered_ids},
    )


def admin_categories(api: AuthApi, module: str | None = None) -> list[dict[str, Any]]:
    response = api.get(ADMIN_CATEGORIES, params={"module": module} if module else None)
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["data"]
    return rows


def category_id(session: Session, module: str, slug: str) -> str:
    value = session.scalar(
        text("SELECT id FROM categories WHERE module = :m AND slug = :s"), {"m": module, "s": slug}
    )
    assert value is not None
    return str(value)


def search_document(session: Session, listing_id: str) -> str:
    session.expire_all()
    value = session.scalar(
        text("SELECT search_document FROM listings WHERE id = :i"), {"i": uuid.UUID(listing_id)}
    )
    assert value is not None
    return str(value)
