"""Shared helpers for the GROCERY-1b API and concurrency tests.

The block names are TEST labels only: the official B-17 block list has not been supplied and none
is invented. The test clock starts on 2026-10-17 12:00 UTC — a Saturday, 17:00 in Karachi.
"""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from httpx import Response
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.models import (
    GroceryDailyCapacity,
    GroceryOrder,
    GroceryOrderStatusHistory,
    GrocerySettingsRevision,
)
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.write_helpers import signed_in

ORDERS = "/grocery/orders"
AVAILABILITY = "/grocery/availability"
SETTINGS = "/admin/grocery/settings"
BLOCKS = ["Test Block A", "Test Block B"]
PHONE_TYPED = "0300 1234567"
PHONE_STORED = "+923001234567"
ADDRESS = "House 17, Street 4"
TODAY = datetime.date(2026, 10, 17)  # the Karachi date at the test clock's start


def order_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "items": [
            {
                "name": "Basmati rice",
                "unit": "kg",
                "quantity": "5",
                "preferredBrand": "Any good one",
            },
            {"name": "Eggs", "unit": "dozen", "quantity": "1.5", "substitution": "none"},
        ],
        "delivery": {
            "contactName": "Test Customer",
            "contactPhone": PHONE_TYPED,
            "block": "Test Block A",
            "addressLine": ADDRESS,
            "landmark": "Blue gate",
        },
        "instructions": "Please ring twice.",
    }
    body.update(overrides)
    return body


def new_key() -> str:
    return uuid.uuid4().hex


def customer(env: AuthEnv, name: str = "buyer", **account: Any) -> AuthApi:
    """A signed-in verified resident (no professional profile, no role)."""
    account.setdefault("professional", None)
    return signed_in(env, f"{name}@example.org", display_name=name.title(), **account)


def owner_admin(env: AuthEnv, email: str = "grocery-admin@example.org") -> AuthApi:
    return signed_in(env, email, professional=None, admin=True, display_name="Grocery Admin")


def configure(admin: AuthApi, **changes: Any) -> dict[str, Any]:
    """Change the settings through the real API (on the current revision) and return them."""
    current = admin.get(SETTINGS)
    assert current.status_code == 200, current.text
    response = admin.request(
        "PATCH", SETTINGS, json={"revision": current.json()["data"]["revision"], **changes}
    )
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def open_for_orders(env: AuthEnv, **changes: Any) -> AuthApi:
    """Ordering enabled with the two test blocks. Returns the Super Admin who did it."""
    admin = owner_admin(env)
    configure(admin, **{"enabled": True, "serviceableBlocks": BLOCKS, **changes})
    return admin


def submit(
    api: AuthApi, body: dict[str, Any] | None = None, key: str | None = None, **kw: Any
) -> Response:
    headers = dict(kw.pop("headers", {}))
    headers["Idempotency-Key"] = key or new_key()
    return api.request(
        "POST", ORDERS, json=order_body() if body is None else body, headers=headers, **kw
    )


def submitted(
    api: AuthApi, body: dict[str, Any] | None = None, key: str | None = None
) -> dict[str, Any]:
    response = submit(api, body, key)
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def cancel(api: AuthApi, order_id: str, revision: int = 1, **body: Any) -> Response:
    return api.request("POST", f"{ORDERS}/{order_id}/cancel", json={"revision": revision, **body})


def outcome(response: Response) -> tuple[int, str | None]:
    code = response.json()["error"]["code"] if response.status_code >= 400 else None
    return response.status_code, code


def detail_pairs(response: Response) -> set[tuple[str, str]]:
    return {(d["field"], d["code"]) for d in response.json()["error"]["details"]}


# -- stored truth ------------------------------------------------------------------------------------


def order_count(session: Session) -> int:
    session.expire_all()
    return int(session.scalar(select(func.count()).select_from(GroceryOrder)) or 0)


def history_count(session: Session) -> int:
    session.expire_all()
    return int(session.scalar(select(func.count()).select_from(GroceryOrderStatusHistory)) or 0)


def capacity(session: Session) -> dict[datetime.date, int]:
    session.expire_all()
    return {row.service_date: row.reserved for row in session.scalars(select(GroceryDailyCapacity))}


def places(session: Session, day: datetime.date = TODAY) -> int:
    return capacity(session).get(day, 0)


def settings_revisions(session: Session) -> list[GrocerySettingsRevision]:
    session.expire_all()
    return list(
        session.scalars(select(GrocerySettingsRevision).order_by(GrocerySettingsRevision.revision))
    )


# -- committed-world cleanup ---------------------------------------------------------------------


def reset_grocery(engine: Engine) -> None:
    """For COMMITTED tests only. Settings versions are append-only and the capacity counter has no
    foreign key, so the ``TRUNCATE users CASCADE`` of a committed world reaches neither. The test
    role owns the table and may disable its trigger for one transaction (production roles do
    not); DDL is transactional, so the trigger is back whatever happens."""
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM grocery_daily_capacity"))
        connection.execute(
            text(
                "ALTER TABLE grocery_settings_revisions "
                "DISABLE TRIGGER trg_grocery_settings_revisions_append_only"
            )
        )
        connection.execute(text("DELETE FROM grocery_settings_revisions WHERE revision > 1"))
        connection.execute(
            text(
                "ALTER TABLE grocery_settings_revisions "
                "ENABLE TRIGGER trg_grocery_settings_revisions_append_only"
            )
        )


@contextmanager
def purge_grocery(engine: Engine) -> Iterator[None]:
    reset_grocery(engine)
    try:
        yield
    finally:
        reset_grocery(engine)
