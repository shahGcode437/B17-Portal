"""GROCERY-1b: the operating settings and the public availability answer (API_CONTRACT.md §18)."""

import datetime
from typing import Any

import pytest

from app.core.rate_limit import GROCERY_SETTINGS_WRITE
from app.models.enums import StaffScope
from app.services.staff_scopes import LISTING_STAFF_SCOPES
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.grocery_helpers import (
    AVAILABILITY,
    BLOCKS,
    SETTINGS,
    configure,
    customer,
    detail_pairs,
    open_for_orders,
    outcome,
    owner_admin,
    places,
    settings_revisions,
    submit,
    submitted,
)

DEFAULTS = {
    "revision": 1,
    "enabled": False,
    "serviceableBlocks": [],
    "operatingDays": [1, 2, 3, 4, 5, 6, 7],
    "opensAt": "10:00",
    "closesAt": "20:00",
    "timezone": "Asia/Karachi",
    "dailyCapacity": 10,
    "maxActiveOrdersPerCustomer": 2,
    "maxItemsPerOrder": 50,
}


def available(api: AuthApi) -> dict[str, Any]:
    response = api.get(AVAILABILITY)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def at(env: AuthEnv, hour: int, minute: int = 0, second: int = 0, day: int = 17) -> None:
    """Set the clock to a UTC time on 2026-10-``day`` (Karachi is UTC+5)."""
    env.clock.now = datetime.datetime(2026, 10, day, hour, minute, second, tzinfo=datetime.UTC)


# -- the default is closed ---------------------------------------------------------------------------


def test_grocery_is_disabled_by_default_with_no_serviceable_block(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)

    data = admin.get(SETTINGS).json()["data"]

    assert {k: data[k] for k in DEFAULTS} == DEFAULTS
    assert "updatedBy" not in data  # the default was written by the migration
    answer = available(auth_env.client())
    assert answer["acceptingOrders"] is False and answer["unavailableReason"] == "disabled"
    assert answer["serviceableBlocks"] == []


def test_availability_is_public_private_free_and_never_cached(auth_env: AuthEnv) -> None:
    response = auth_env.client().get(AVAILABILITY)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()["data"]
    assert set(data) == {
        "acceptingOrders",
        "unavailableReason",
        "serviceableBlocks",
        "schedule",
        "limits",
        "units",
        "substitutionOptions",
    }
    assert data["schedule"] == {
        "timezone": "Asia/Karachi",
        "operatingDays": [1, 2, 3, 4, 5, 6, 7],
        "opensAt": "10:00",
        "closesAt": "20:00",
    }
    assert data["limits"] == {"maxItemsPerOrder": 50, "maxActiveOrders": 2}  # no capacity figure
    assert [u["unit"] for u in data["units"]] == [
        "kg",
        "gram",
        "litre",
        "ml",
        "piece",
        "pack",
        "dozen",
    ]
    assert data["units"][0] == {"unit": "kg", "minimum": "0.05", "maximum": "50", "step": "0.001"}
    assert data["substitutionOptions"] == ["allow", "ask", "none"]


def test_enabling_without_a_block_still_accepts_nothing(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)
    configure(admin, enabled=True)
    buyer = customer(auth_env)

    assert available(buyer)["unavailableReason"] == "no_service_area"
    assert outcome(submit(buyer)) == (503, "grocery_unavailable")
    assert places(auth_env.session) == 0


def test_the_reasons_come_in_a_fixed_order(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env, dailyCapacity=1)
    anyone = auth_env.client()
    assert available(anyone) == {**available(anyone), "acceptingOrders": True}
    assert "unavailableReason" not in available(anyone)

    submitted(customer(auth_env))
    assert available(anyone)["unavailableReason"] == "daily_limit_reached"
    configure(admin, operatingDays=[1])  # today is a Saturday: closed wins over full
    assert available(anyone)["unavailableReason"] == "closed"
    configure(admin, serviceableBlocks=[])
    assert available(anyone)["unavailableReason"] == "no_service_area"
    configure(admin, enabled=False)
    assert available(anyone)["unavailableReason"] == "disabled"


@pytest.mark.parametrize(
    ("clock", "open_"),
    [((4, 59, 59), False), ((5, 0, 0), True), ((14, 59, 59), True), ((15, 0, 0), False)],
    ids=["09:59:59", "10:00:00", "19:59:59", "20:00:00"],
)
def test_the_opening_and_closing_boundaries_in_karachi(
    auth_env: AuthEnv, clock: tuple[int, int, int], open_: bool
) -> None:
    open_for_orders(auth_env)
    at(auth_env, *clock)
    buyer = customer(auth_env)  # signed in at that moment

    assert available(buyer)["acceptingOrders"] is open_
    expected = (201, None) if open_ else (409, "grocery_closed")
    assert outcome(submit(buyer)) == expected
    assert places(auth_env.session) == (1 if open_ else 0)


def test_only_configured_operating_days_accept_orders(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env, operatingDays=[1, 2, 3, 4, 5])  # no weekend
    buyer = customer(auth_env)

    assert outcome(submit(buyer)) == (409, "grocery_closed")
    configure(admin, operatingDays=[6])
    assert submit(buyer).status_code == 201


# -- who may manage the settings -----------------------------------------------------------------------

LISTING = sorted(LISTING_STAFF_SCOPES)
REFUSED_ACTORS: list[tuple[str, dict[str, Any], tuple[int, str]]] = [
    ("unverified super admin", {"admin": True, "verified": False}, (403, "email_not_verified")),
    ("resident", {}, (403, "forbidden")),
    ("grocery moderator", {"moderator_scopes": [StaffScope.GROCERY]}, (403, "forbidden")),
    (
        "grocery + services moderator",
        {"moderator_scopes": [StaffScope.GROCERY, StaffScope.SERVICES]},
        (403, "forbidden"),
    ),
    (
        "every-scope moderator",
        {"moderator_scopes": [*LISTING, StaffScope.GROCERY]},
        (403, "forbidden"),
    ),
    ("listing moderator", {"moderator_scopes": [StaffScope.FOOD]}, (403, "forbidden")),
    ("paused moderator", {"moderator_scopes": []}, (403, "forbidden")),
]


@pytest.mark.parametrize(
    ("account", "expected"), [r[1:] for r in REFUSED_ACTORS], ids=[r[0] for r in REFUSED_ACTORS]
)
def test_only_a_super_admin_may_read_or_change_the_settings(
    auth_env: AuthEnv, account: dict[str, Any], expected: tuple[int, str]
) -> None:
    make_account(auth_env.session, "someone@example.org", **account)
    api = auth_env.client()
    assert api.login("someone@example.org").status_code == 200

    assert outcome(api.get(SETTINGS)) == expected
    assert (
        outcome(api.request("PATCH", SETTINGS, json={"revision": 1, "enabled": True})) == expected
    )
    assert [r.revision for r in settings_revisions(auth_env.session)] == [1]


def test_anonymous_and_professional_accounts_are_refused(auth_env: AuthEnv) -> None:
    anonymous = auth_env.client()
    professional = customer(auth_env, "pro", professional="premium")

    assert outcome(anonymous.get(SETTINGS)) == (401, "unauthenticated")
    assert anonymous.request("PATCH", SETTINGS, json={"revision": 1}).status_code == 401
    assert outcome(professional.get(SETTINGS)) == (403, "forbidden")


def test_a_stale_staff_session_cannot_change_the_settings(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)
    auth_env.clock.advance(hours=2, minutes=1)

    response = admin.request("PATCH", SETTINGS, json={"revision": 1, "enabled": True})

    assert outcome(response) == (401, "session_expired")
    assert len(settings_revisions(auth_env.session)) == 1


def test_a_change_needs_the_origin_and_the_csrf_token(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)
    body = {"revision": 1, "enabled": True}

    assert outcome(admin.request("PATCH", SETTINGS, json=body, csrf="wrong")) == (
        403,
        "csrf_failed",
    )
    assert outcome(admin.request("PATCH", SETTINGS, json=body, csrf=None)) == (403, "csrf_failed")
    assert outcome(admin.request("PATCH", SETTINGS, json=body, origin="https://evil.example")) == (
        403,
        "csrf_failed",
    )
    assert len(settings_revisions(auth_env.session)) == 1


# -- changes and their permanent record -------------------------------------------------------------


def test_every_change_adds_a_complete_version_that_names_its_author(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)

    first = configure(admin, enabled=True, serviceableBlocks=["  Test   Block A "])
    second = configure(admin, dailyCapacity=25, closesAt="21:30")

    assert (first["revision"], first["serviceableBlocks"]) == (2, ["Test Block A"])
    assert second["revision"] == 3 and second["enabled"] is True
    assert (second["dailyCapacity"], second["closesAt"], second["opensAt"]) == (
        25,
        "21:30",
        "10:00",
    )
    assert second["updatedBy"]["displayName"] == "Grocery Admin"
    versions = settings_revisions(auth_env.session)
    assert [v.revision for v in versions] == [1, 2, 3]
    assert [(v.enabled, v.daily_capacity) for v in versions] == [
        (False, 10),
        (True, 10),
        (True, 25),
    ]
    admin_id = admin.me().json()["data"]["id"]
    assert [str(v.actor_user_id) for v in versions[1:]] == [admin_id, admin_id]
    assert versions[0].actor_user_id is None
    assert all(v.request_id for v in versions[1:])


def test_a_change_equal_to_the_current_settings_writes_nothing(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)

    data = configure(admin, enabled=False, dailyCapacity=10, serviceableBlocks=[], opensAt="10:00")

    assert data["revision"] == 1 and len(settings_revisions(auth_env.session)) == 1


def test_a_stale_revision_is_a_conflict_and_changes_nothing(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)
    configure(admin, enabled=True)

    response = admin.request("PATCH", SETTINGS, json={"revision": 1, "dailyCapacity": 99})

    assert outcome(response) == (409, "conflict")
    assert detail_pairs(response) == {("revision", "stale_revision")}
    assert admin.get(SETTINGS).json()["data"]["dailyCapacity"] == 10


@pytest.mark.parametrize(
    ("changes", "pair"),
    [
        ({}, ("body", "no_changes")),
        ({"closesAt": "10:00"}, ("closesAt", "closes_before_opens")),
        ({"opensAt": "20:00"}, ("closesAt", "closes_before_opens")),
        ({"opensAt": "18:00", "closesAt": "09:00"}, ("closesAt", "closes_before_opens")),
        ({"dailyCapacity": 0}, ("dailyCapacity", "greater_than_equal")),
        ({"serviceableBlocks": ["Test A", "TEST a"]}, ("serviceableBlocks", "duplicate_block")),
        ({"timezone": "Europe/London"}, ("timezone", "unsupported_timezone")),
        ({"enabled": None}, ("enabled", "not_nullable")),
        ({"actorUserId": "x"}, ("actorUserId", "not_allowed")),
    ],
)
def test_an_invalid_change_is_refused_and_writes_nothing(
    auth_env: AuthEnv, changes: dict[str, Any], pair: tuple[str, str]
) -> None:
    admin = owner_admin(auth_env)

    response = admin.request("PATCH", SETTINGS, json={"revision": 1, **changes})

    assert outcome(response) == (422, "validation_error")
    assert pair in detail_pairs(response)
    assert len(settings_revisions(auth_env.session)) == 1


def test_settings_changes_are_rate_limited_per_super_admin(auth_env: AuthEnv) -> None:
    admin = owner_admin(auth_env)
    body = {"revision": 1, "enabled": False}  # a no-op: counted, writes nothing

    statuses = [
        admin.request("PATCH", SETTINGS, json=body).status_code
        for _ in range(GROCERY_SETTINGS_WRITE.limit)
    ]
    over = admin.request("PATCH", SETTINGS, json=body)

    assert set(statuses) == {200}
    assert outcome(over) == (429, "rate_limited") and "retry-after" in over.headers


def test_the_blocks_offered_are_exactly_what_was_configured(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)

    assert available(auth_env.client())["serviceableBlocks"] == BLOCKS
