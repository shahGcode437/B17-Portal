"""Helpers for the Phase 12F tests: Saved items and service requests (real PostgreSQL, real app,
one cookie jar per browser).

Time: ``FakeClock`` starts at 2026-10-17 12:00 UTC, i.e. 17:00 on 2026-10-17 in B-17 (UTC+05:00),
so "today" for a preferred date is ``TODAY``.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from httpx import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.enums import ListingStatus, PlanCode
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.write_helpers import created_id, set_status, signed_in
from tests.write_payloads import business_body, provider_body, tutor_body

REQUESTS = "/requests"
SAVED = "/saved"
LEADS = "/users/me/leads"

TODAY = "2026-10-17"
TOMORROW = "2026-10-18"
YESTERDAY = "2026-10-16"

ACTIONS = ("accept", "start", "complete", "cancel")


def request_body(listing_id: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "providerListingId": listing_id,
        "service": "Fix wiring",
        "details": "The kitchen socket sparks when I plug the kettle in.",
        "area": "B-17, Block C",
        "preferredDate": TOMORROW,
        "preferredTime": "10:30",
        "notes": "Please call before arriving.",
        "preferredContactChannel": "in_app",
    }
    body.update(overrides)
    return body


def requester_signed_in(
    env: AuthEnv, email: str = "resident@example.org", *, verified: bool = True
) -> AuthApi:
    """A verified account with NO professional profile (a plain resident), signed in."""
    return signed_in(env, email, verified=verified, professional=None, display_name="Rana Resident")


def provider_signed_in(
    env: AuthEnv, email: str = "provider@example.org", *, plan: PlanCode = PlanCode.PREMIUM
) -> AuthApi:
    return signed_in(env, email, professional=plan, display_name="Pro Vider")


def approved(env: AuthEnv, owner: AuthApi, body: dict[str, Any] | None = None) -> str:
    """A listing created through the API, then approved directly in the database (the moderation
    API has its own suites): its id."""
    listing_id = created_id(owner, body or provider_body())
    set_status(env.session, listing_id, ListingStatus.APPROVED)
    return listing_id


def approved_provider(env: AuthEnv, owner: AuthApi, name: str = "Bright Spark Electricians") -> str:
    return approved(env, owner, provider_body(name=name))


def approved_business(env: AuthEnv, owner: AuthApi) -> str:
    return approved(env, owner, business_body())


def approved_tutor(env: AuthEnv, owner: AuthApi) -> str:
    return approved(env, owner, tutor_body())


def send(api: AuthApi, listing_id: str, **overrides: Any) -> Response:
    return api.request("POST", REQUESTS, json=request_body(listing_id, **overrides))


def sent_id(api: AuthApi, listing_id: str, **overrides: Any) -> str:
    response = send(api, listing_id, **overrides)
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


def act(api: AuthApi, request_id: str, action: str, **kwargs: Any) -> Response:
    return api.request("POST", f"{REQUESTS}/{request_id}/{action}", **kwargs)


def detail(api: AuthApi, request_id: str) -> dict[str, Any]:
    response = api.get(f"{REQUESTS}/{request_id}")
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def status_of(api: AuthApi, request_id: str) -> str:
    return str(detail(api, request_id)["status"])


def history_of(data: dict[str, Any]) -> list[tuple[str | None, str, str]]:
    """``(fromStatus, toStatus, actorRole)`` of a request detail's history."""
    return [(h.get("fromStatus"), h["toStatus"], h["actorRole"]) for h in data["history"]]


def stored_request(session: Session, request_id: str) -> dict[str, Any]:
    session.expire_all()
    row = (
        session.execute(text("SELECT * FROM service_requests WHERE id = :id"), {"id": request_id})
        .mappings()
        .one()
    )
    return dict(row)


def request_count(session: Session) -> int:
    return int(session.scalar(text("SELECT count(*) FROM service_requests")) or 0)


def history_rows(session: Session, request_id: str) -> list[tuple[str | None, str, str]]:
    return [
        (r[0], r[1], r[2])
        for r in session.execute(
            text(
                "SELECT from_status, to_status, actor_role FROM service_request_status_history "
                "WHERE request_id = :id ORDER BY created_at, id"
            ),
            {"id": request_id},
        )
    ]


def saved_rows(session: Session, user_email: str) -> list[str]:
    return [
        str(r[0])
        for r in session.execute(
            text(
                "SELECT s.listing_id FROM saved_items s JOIN users u ON u.id = s.user_id "
                "WHERE u.email = :e ORDER BY s.created_at, s.listing_id"
            ),
            {"e": user_email},
        )
    ]


def saved_ids(api: AuthApi, **params: str) -> list[str]:
    response = api.get(SAVED, params=params)
    assert response.status_code == 200, response.text
    return [str(item["item"]["id"]) for item in response.json()["data"]]


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


def detail_codes(response: Response) -> list[tuple[str, str]]:
    return [(d["field"], d["code"]) for d in response.json()["error"].get("details", [])]


@dataclass
class World:
    """One approved provider listing, its owner, and one resident."""

    env: AuthEnv
    owner: AuthApi
    resident: AuthApi
    listing_id: str


def world(env: AuthEnv) -> World:
    owner = provider_signed_in(env)
    resident = requester_signed_in(env)
    return World(env, owner, resident, approved_provider(env, owner))


def new_id() -> str:
    return str(uuid.uuid4())


def set_request_status(session: Session, request_id: str, status: str) -> None:
    """Position a request in ``status`` directly in the database (test set-up only: the lifecycle
    tests then apply ONE action through the API and check its outcome). No history row is added."""
    session.execute(
        text("UPDATE service_requests SET status = :s WHERE id = :id"),
        {"s": status, "id": request_id},
    )
    session.commit()
    session.expire_all()


def seed_requests(session: Session, requester_email: str, listing_id: str, count: int) -> list[str]:
    """``count`` extra requests by one requester, inserted directly (the create rate limit would
    stop an API loop at five an hour). Each gets its ``submitted`` history row."""
    requester = session.execute(
        text("SELECT id FROM users WHERE email = :e"), {"e": requester_email}
    ).scalar_one()
    ids: list[str] = []
    for index in range(count):
        request_id = str(uuid.uuid4())
        session.execute(
            text(
                "INSERT INTO service_requests (id, requester_id, provider_listing_id, "
                "provider_name_snapshot, service, details, area, preferred_date, created_at) "
                "SELECT :id, :u, l.id, l.title, 'Seeded service', 'Seeded request details text', "
                "'B-17', '2026-10-20', now() + make_interval(secs => :n) "
                "FROM listings l WHERE l.id = :l"
            ),
            {"id": request_id, "u": requester, "l": listing_id, "n": index},
        )
        session.execute(
            text(
                "INSERT INTO service_request_status_history "
                "(id, request_id, from_status, to_status, actor_user_id, actor_role) "
                "VALUES (gen_random_uuid(), :id, NULL, 'submitted', :u, 'requester')"
            ),
            {"id": request_id, "u": requester},
        )
        ids.append(request_id)
    session.commit()
    return ids
