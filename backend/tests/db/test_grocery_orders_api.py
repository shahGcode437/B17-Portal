"""GROCERY-1b: the customer's order API — submit, idempotency, history, detail, cancel, privacy
(API_CONTRACT.md §18)."""

import datetime
import logging
import re
import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.models.enums import StaffScope
from app.repositories.grocery import GroceryRepository
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.grocery_helpers import (
    ADDRESS,
    AVAILABILITY,
    ORDERS,
    PHONE_STORED,
    PHONE_TYPED,
    TODAY,
    cancel,
    capacity,
    configure,
    customer,
    detail_pairs,
    history_count,
    new_key,
    open_for_orders,
    order_body,
    order_count,
    outcome,
    owner_admin,
    places,
    submit,
    submitted,
)

ITEM = {"name": "Rice", "unit": "kg", "quantity": "1"}


def get(api: AuthApi, order_id: str) -> Any:
    return api.get(f"{ORDERS}/{order_id}")


def delivery(**changes: Any) -> dict[str, Any]:
    return {**order_body()["delivery"], **changes}


def stored(env: AuthEnv, column: str, order_id: str) -> Any:
    return env.session.execute(
        text(f"SELECT {column} FROM grocery_orders WHERE id = :i"),  # noqa: S608
        {"i": uuid.UUID(order_id)},
    ).scalar_one()


def nothing_was_stored(env: AuthEnv) -> bool:
    return (order_count(env.session), history_count(env.session), places(env.session)) == (0, 0, 0)


# -- submitting ------------------------------------------------------------------------------------


def test_a_submitted_order_is_stored_exactly_with_server_owned_fields(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)

    response = submit(buyer, order_body(delivery=delivery(block="  test   BLOCK a ")))

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert response.headers["location"] == f"/api/v1/grocery/orders/{data['id']}"
    assert response.headers["cache-control"] == "no-store"
    assert re.fullmatch(r"GRC-[2-9A-HJKMNP-Z]{8}", data["reference"])
    assert (data["status"], data["revision"], data["itemCount"], data["canCancel"]) == (
        "submitted",
        1,
        2,
        True,
    )
    assert data["block"] == "Test Block A"  # the CONFIGURED spelling
    assert data["delivery"] == {
        "contactName": "Test Customer",
        "contactPhone": PHONE_STORED,
        "block": "Test Block A",
        "addressLine": ADDRESS,
        "landmark": "Blue gate",
    }
    assert data["items"] == [
        {
            "position": 1,
            "name": "Basmati rice",
            "unit": "kg",
            "quantity": "5",
            "preferredBrand": "Any good one",
            "substitution": "ask",
        },
        {"position": 2, "name": "Eggs", "unit": "dozen", "quantity": "1.5", "substitution": "none"},
    ]
    assert data["instructions"] == "Please ring twice."
    assert [(h.get("fromStatus"), h["toStatus"], h["actorRole"]) for h in data["history"]] == [
        (None, "submitted", "customer")
    ]
    assert "cancelledAt" not in data and "customerId" not in data
    assert datetime.datetime.fromisoformat(data["submittedAt"]) == auth_env.clock()
    me = buyer.me().json()["data"]["id"]
    assert str(stored(auth_env, "customer_id", data["id"])) == me
    assert stored(auth_env, "service_date", data["id"]) == TODAY
    assert places(auth_env.session) == 1


def test_a_quantity_stays_exact(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    items = [
        {"name": "Saffron rice", "unit": "kg", "quantity": "0.333"},
        {"name": "Oil", "unit": "litre", "quantity": "2.500"},
    ]

    data = submitted(customer(auth_env), order_body(items=items))

    assert [i["quantity"] for i in data["items"]] == ["0.333", "2.5"]
    saved = (
        auth_env.session.execute(
            text("SELECT quantity::text FROM grocery_order_items ORDER BY position")
        )
        .scalars()
        .all()
    )
    assert saved == ["0.333", "2.500"]  # NUMERIC(10,3): no binary floating point anywhere


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (order_body(items=[]), "items"),
        (order_body(items=[{**ITEM, "unit": "bag"}]), "items.0.unit"),
        (order_body(items=[{**ITEM, "quantity": 2}]), "items.0.quantity"),
        (order_body(items=[{**ITEM, "quantity": "0"}]), "items.0.quantity"),
        (order_body(items=[{**ITEM, "quantity": "-1"}]), "items.0.quantity"),
        (order_body(items=[{**ITEM, "quantity": "Infinity"}]), "items.0.quantity"),
        (order_body(items=[{**ITEM, "quantity": "50.001"}]), "items.0.quantity"),
        (order_body(delivery=delivery(contactPhone="+447911123456")), "delivery.contactPhone"),
        (order_body(delivery=delivery(contactPhone="12")), "delivery.contactPhone"),
        (order_body(delivery=delivery(addressLine="    ")), "delivery.addressLine"),
        (
            order_body(delivery={k: v for k, v in delivery().items() if k != "block"}),
            "delivery.block",
        ),
        ({"items": [ITEM]}, "delivery"),
        (order_body(customerId=str(uuid.uuid4())), "customerId"),
        (order_body(status="cancelled"), "status"),
        (order_body(delivery=delivery(customerId="x")), "delivery.customerId"),
    ],
)
def test_an_invalid_payload_is_refused_before_anything_is_taken(
    auth_env: AuthEnv, body: dict[str, Any], field: str
) -> None:
    open_for_orders(auth_env, dailyCapacity=1)
    buyer = customer(auth_env)

    response = submit(buyer, body)

    assert outcome(response) == (422, "validation_error")
    assert field in {d["field"] for d in response.json()["error"]["details"]}
    assert nothing_was_stored(auth_env)
    assert submit(buyer).status_code == 201  # the only place of the day is still free


def test_an_unconfigured_block_is_refused(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)

    for block in ("Test Block C", "A", "Block A"):
        response = submit(buyer, order_body(delivery=delivery(block=block)))
        assert outcome(response) == (422, "validation_error"), block
        assert detail_pairs(response) == {("delivery.block", "not_serviceable")}
    assert nothing_was_stored(auth_env)


def test_the_configured_line_limit_is_enforced(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env, maxItemsPerOrder=2)
    buyer = customer(auth_env)

    over = submit(buyer, order_body(items=[ITEM] * 3))

    assert detail_pairs(over) == {("items", "too_many_items")}
    assert nothing_was_stored(auth_env)
    assert submit(buyer, order_body(items=[ITEM] * 2)).status_code == 201


def test_fifty_lines_are_allowed_by_default_and_fifty_one_are_not(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)

    assert outcome(submit(buyer, order_body(items=[ITEM] * 51))) == (422, "validation_error")
    assert submitted(buyer, order_body(items=[ITEM] * 50))["itemCount"] == 50


def test_nothing_is_accepted_while_disabled(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env)
    configure(admin, enabled=False)

    response = submit(customer(auth_env))

    assert outcome(response) == (503, "grocery_unavailable")
    assert nothing_was_stored(auth_env)


# -- capacity and the active-order limit ------------------------------------------------------------


def test_the_daily_capacity_is_enforced_and_a_cancelled_order_keeps_its_place(
    auth_env: AuthEnv,
) -> None:
    open_for_orders(auth_env, dailyCapacity=2)
    first, second, third = (customer(auth_env, n) for n in ("one", "two", "three"))
    order = submitted(first)
    submitted(second)
    assert outcome(submit(third)) == (409, "grocery_capacity_reached")

    assert cancel(first, order["id"]).status_code == 200

    assert places(auth_env.session) == 2  # the cancellation released nothing
    assert outcome(submit(third)) == (409, "grocery_capacity_reached")
    assert outcome(submit(first)) == (409, "grocery_capacity_reached")
    assert order_count(auth_env.session) == 2


def test_the_capacity_day_rolls_over_at_karachi_midnight(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env, dailyCapacity=1, opensAt="00:00", closesAt="23:59")
    auth_env.clock.now = datetime.datetime(2026, 10, 17, 18, 30, tzinfo=datetime.UTC)  # 23:30 PKT
    first, second = customer(auth_env, "one"), customer(auth_env, "two")
    submitted(first)
    assert outcome(submit(second)) == (409, "grocery_capacity_reached")

    auth_env.clock.now = datetime.datetime(2026, 10, 17, 19, 0, tzinfo=datetime.UTC)  # 00:00 PKT
    order = submitted(second)

    # still the 17th in UTC, already the 18th in Karachi
    assert stored(auth_env, "service_date", order["id"]) == datetime.date(2026, 10, 18)
    assert capacity(auth_env.session) == {TODAY: 1, datetime.date(2026, 10, 18): 1}


def test_a_customer_may_have_only_two_active_orders(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    first = submitted(buyer)
    submitted(buyer)

    third = submit(buyer)

    assert outcome(third) == (409, "grocery_active_order_limit")
    assert (order_count(auth_env.session), places(auth_env.session)) == (2, 2)
    assert submit(customer(auth_env, "other")).status_code == 201  # the limit is per customer
    assert cancel(buyer, first["id"]).status_code == 200
    assert submit(buyer).status_code == 201  # a cancelled order is not active


def test_the_active_limit_follows_the_settings(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env, maxActiveOrdersPerCustomer=1)
    buyer = customer(auth_env)
    submitted(buyer)

    assert outcome(submit(buyer)) == (409, "grocery_active_order_limit")


def test_one_account_cannot_use_up_a_days_capacity_by_cancelling(auth_env: AuthEnv) -> None:
    """Cancelled orders keep their place, so submissions are limited per account: 3 an hour and
    4 a day."""
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    for _ in range(3):
        order = submitted(buyer)
        assert cancel(buyer, order["id"]).status_code == 200

    limited = submit(buyer)

    assert outcome(limited) == (429, "rate_limited") and "retry-after" in limited.headers
    assert places(auth_env.session) == 3
    auth_env.clock.advance(hours=1)
    assert cancel(buyer, submitted(buyer)["id"]).status_code == 200  # the 4th of the day
    auth_env.clock.advance(hours=1)
    assert outcome(submit(buyer)) == (429, "rate_limited")
    assert places(auth_env.session) == 4


def test_a_refused_submission_is_not_counted_against_the_rate_limit(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    for _ in range(5):
        assert submit(buyer, order_body(delivery=delivery(block="Nowhere"))).status_code == 422

    assert submit(buyer).status_code == 201


# -- idempotency -------------------------------------------------------------------------------------


def test_the_key_is_required_and_well_formed(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)

    missing = buyer.request("POST", ORDERS, json=order_body())
    blank = buyer.request("POST", ORDERS, json=order_body(), headers={"Idempotency-Key": "   "})
    short = buyer.request("POST", ORDERS, json=order_body(), headers={"Idempotency-Key": "abc"})
    spaced = buyer.request(
        "POST", ORDERS, json=order_body(), headers={"Idempotency-Key": "has space inside"}
    )

    assert outcome(missing) == (400, "idempotency_key_required")
    assert outcome(blank) == (400, "idempotency_key_required")
    assert outcome(short) == (400, "idempotency_key_invalid")
    assert outcome(spaced) == (400, "idempotency_key_invalid")
    assert nothing_was_stored(auth_env)


def test_a_retry_returns_the_original_order_and_takes_nothing_more(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    first = submit(buyer, key=key)
    # the same order, written differently: spelling, spacing, trailing zeros, block case
    again_body = order_body(
        delivery=delivery(contactPhone="+92 300-123-4567", block="TEST block A")
    )
    again_body["items"][0]["quantity"] = "5.000"

    retry = submit(buyer, again_body, key)

    assert (first.status_code, retry.status_code) == (201, 200)
    assert "location" not in retry.headers
    assert retry.json()["data"] == first.json()["data"]
    assert (
        order_count(auth_env.session),
        places(auth_env.session),
        history_count(auth_env.session),
    ) == (1, 1, 1)


def test_retries_do_not_use_the_submission_rate_limit(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    submitted(buyer, key=key)

    assert {submit(buyer, key=key).status_code for _ in range(10)} == {200}
    assert submit(buyer).status_code == 201  # only 2 of the 3 an hour were used


@pytest.mark.parametrize(
    "change",
    [
        {"instructions": "Something else."},
        {"items": [{"name": "Basmati rice", "unit": "kg", "quantity": "6"}]},
        {"delivery": {**order_body()["delivery"], "addressLine": "House 18, Street 4"}},
        {"delivery": {**order_body()["delivery"], "block": "Test Block B"}},
    ],
    ids=["instructions", "items", "address", "block"],
)
def test_the_same_key_with_a_different_order_is_a_conflict(
    auth_env: AuthEnv, change: dict[str, Any]
) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    original = submitted(buyer, key=key)

    response = submit(buyer, order_body(**change), key)

    assert outcome(response) == (409, "idempotency_key_reused")
    assert "data" not in response.json()
    assert (order_count(auth_env.session), places(auth_env.session)) == (1, 1)
    assert get(buyer, original["id"]).json()["data"] == original


def test_a_key_belongs_to_one_customer(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    first, second = customer(auth_env, "one"), customer(auth_env, "two")
    key = new_key()
    mine = submitted(first, key=key)

    theirs = submit(second, key=key)  # the same key and the very same body

    assert theirs.status_code == 201
    assert theirs.json()["data"]["id"] != mine["id"]
    assert (order_count(auth_env.session), places(auth_env.session)) == (2, 2)
    assert outcome(get(second, mine["id"])) == (404, "not_found")


@pytest.mark.parametrize(
    "later",
    [
        "disabled",
        "no blocks",
        "closed",
        "capacity full",
        "block removed",
        "item limit lowered",
        "active limit reached",
        "rate limit reached",
    ],
)
def test_a_retry_still_finds_its_order_whatever_changed_afterwards(
    auth_env: AuthEnv, later: str
) -> None:
    admin = open_for_orders(auth_env, dailyCapacity=3)
    buyer = customer(auth_env)
    key = new_key()
    original = submitted(buyer, key=key)
    if later == "disabled":
        configure(admin, enabled=False)
    elif later == "no blocks":
        configure(admin, serviceableBlocks=[])
    elif later == "closed":
        configure(admin, operatingDays=[1])
    elif later == "capacity full":
        configure(admin, dailyCapacity=1)
    elif later == "block removed":
        configure(admin, serviceableBlocks=["Test Block B"])
    elif later == "item limit lowered":
        configure(admin, maxItemsPerOrder=1)
    elif later == "active limit reached":
        configure(admin, maxActiveOrdersPerCustomer=1)
    else:
        submitted(buyer)
        assert cancel(buyer, submitted_ids(buyer)[0]).status_code == 200
        submitted(buyer)  # three this hour
    stored_before = (order_count(auth_env.session), places(auth_env.session))

    retry = submit(buyer, key=key)

    assert retry.status_code == 200, retry.text
    assert retry.json()["data"]["id"] == original["id"]
    assert (order_count(auth_env.session), places(auth_env.session)) == stored_before


def submitted_ids(api: AuthApi) -> list[str]:
    return [o["id"] for o in api.get(f"{ORDERS}?status=submitted").json()["data"]]


def test_a_retry_after_cancellation_returns_the_cancelled_order_and_creates_nothing(
    auth_env: AuthEnv,
) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    order = submitted(buyer, key=key)
    assert cancel(buyer, order["id"]).status_code == 200

    retry = submit(buyer, key=key)

    assert retry.status_code == 200 and retry.json()["data"]["status"] == "cancelled"
    assert (order_count(auth_env.session), places(auth_env.session)) == (1, 1)


def test_a_retry_outside_the_opening_hours_still_works(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    submitted(buyer, key=key)
    auth_env.clock.advance(hours=6)  # 23:00 in Karachi

    assert submit(buyer, key=key).status_code == 200
    assert outcome(submit(buyer)) == (409, "grocery_closed")


def test_a_refused_submission_does_not_bind_its_key(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    assert submit(buyer, order_body(delivery=delivery(block="Nowhere")), key).status_code == 422

    assert submit(buyer, key=key).status_code == 201


def test_a_replay_needs_the_same_authentication(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    submitted(buyer, key=key)
    assert buyer.logout().status_code == 204

    assert submit(buyer, key=key).status_code == 401
    assert submit(auth_env.client(), key=key).status_code == 401
    auth_env.session.execute(
        text("UPDATE users SET status = 'suspended' WHERE email = 'buyer@example.org'")
    )
    auth_env.session.commit()
    again = auth_env.client()
    assert again.login("buyer@example.org").status_code in (401, 403)
    assert submit(again, key=key).status_code == 401


# -- who may do what ---------------------------------------------------------------------------------


def test_every_order_route_needs_a_verified_signed_in_account(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    order = submitted(customer(auth_env))
    anonymous = auth_env.client()
    unverified = customer(auth_env, "unverified", verified=False)
    calls = [
        ("GET", ORDERS, None),
        ("GET", f"{ORDERS}/{order['id']}", None),
        ("POST", ORDERS, order_body()),
        ("POST", f"{ORDERS}/{order['id']}/cancel", {"revision": 1}),
    ]

    for method, path, body in calls:
        kwargs: dict[str, Any] = {"headers": {"Idempotency-Key": new_key()}}
        if body is not None:
            kwargs["json"] = body
        assert outcome(anonymous.request(method, path, **kwargs)) == (401, "unauthenticated"), path
        assert outcome(unverified.request(method, path, **kwargs)) == (403, "email_not_verified"), (
            path
        )
    assert order_count(auth_env.session) == 1


def test_a_suspended_customer_is_refused_at_once(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)
    auth_env.session.execute(
        text("UPDATE users SET status = 'suspended' WHERE email = 'buyer@example.org'")
    )
    auth_env.session.commit()

    assert submit(buyer).status_code == 401
    assert get(buyer, order["id"]).status_code == 401
    assert cancel(buyer, order["id"]).status_code == 401


@pytest.mark.parametrize(
    "account",
    [
        {},
        {"admin": True},
        {"moderator_scopes": [StaffScope.GROCERY]},
        {"moderator_scopes": [StaffScope.SERVICES]},
        {"professional": "premium"},
    ],
    ids=[
        "another resident",
        "super admin",
        "grocery moderator",
        "services moderator",
        "professional",
    ],
)
def test_nobody_else_can_see_or_cancel_an_order(auth_env: AuthEnv, account: dict[str, Any]) -> None:
    """There is no staff or administrator read of an order in this phase."""
    open_for_orders(auth_env)
    order = submitted(customer(auth_env))
    make_account(auth_env.session, "intruder@example.org", **account)
    intruder = auth_env.client()
    assert intruder.login("intruder@example.org").status_code == 200

    for response in (get(intruder, order["id"]), cancel(intruder, order["id"])):
        assert outcome(response) == (404, "not_found")
        assert response.headers["cache-control"] == "no-store"
    missing = get(intruder, str(uuid.uuid4()))
    assert (
        get(intruder, order["id"]).json()["error"]["message"] == missing.json()["error"]["message"]
    )
    assert intruder.get(ORDERS).json() == {
        "data": [],
        "meta": {"total": 0, "limit": 12, "offset": 0},
    }
    assert stored(auth_env, "status", order["id"]) == "submitted"


def test_a_malformed_id_is_just_not_found(auth_env: AuthEnv) -> None:
    buyer = customer(auth_env)

    for bad in ("1", "not-a-uuid", "GRC-ABCDEFGH"):
        assert outcome(get(buyer, bad)) == (404, "not_found")
        assert outcome(cancel(buyer, bad)) == (404, "not_found")


def test_an_unsafe_call_needs_the_origin_and_the_csrf_token(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)

    for kwargs in (
        {"csrf": None},
        {"csrf": "wrong"},
        {"origin": None},
        {"origin": "https://evil.example"},
    ):
        assert outcome(submit(buyer, **kwargs)) == (403, "csrf_failed"), kwargs
        response = buyer.request(
            "POST", f"{ORDERS}/{order['id']}/cancel", json={"revision": 1}, **kwargs
        )
        assert outcome(response) == (403, "csrf_failed"), kwargs
        assert response.headers["cache-control"] == "no-store"
    assert (order_count(auth_env.session), places(auth_env.session)) == (1, 1)


def test_every_grocery_answer_is_private(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)
    responses = [
        buyer.get(AVAILABILITY),
        buyer.get(ORDERS),
        get(buyer, order["id"]),
        submit(buyer, order_body(items=[])),  # 422
        submit(auth_env.client()),  # 401
        get(buyer, str(uuid.uuid4())),  # 404
        buyer.request("DELETE", f"{ORDERS}/{order['id']}"),  # 405
        buyer.get("/grocery/nothing-here"),  # 404 from the router
    ]

    assert [r.headers.get("cache-control") for r in responses] == ["no-store"] * len(responses)


# -- history and detail --------------------------------------------------------------------------------


def test_the_list_is_my_own_newest_first_paged_and_without_delivery_details(
    auth_env: AuthEnv,
) -> None:
    open_for_orders(auth_env, maxActiveOrdersPerCustomer=3)
    buyer = customer(auth_env)
    ids = []
    for _ in range(3):
        ids.append(submitted(buyer)["id"])
        auth_env.clock.advance(minutes=1)
    submitted(customer(auth_env, "other"))

    response = buyer.get(f"{ORDERS}?limit=2")
    rest = buyer.get(f"{ORDERS}?limit=2&offset=2").json()

    data, meta = response.json()["data"], response.json()["meta"]
    assert [o["id"] for o in data] == [ids[2], ids[1]] and [o["id"] for o in rest["data"]] == [
        ids[0]
    ]
    assert meta == {"total": 3, "limit": 2, "offset": 0}
    assert set(data[0]) == {
        "id",
        "reference",
        "status",
        "revision",
        "itemCount",
        "block",
        "submittedAt",
    }
    for secret in (PHONE_STORED, ADDRESS, "Test Customer", "Blue gate", "Basmati"):
        assert secret not in response.text


def test_the_list_filters_by_status(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    first, second = submitted(buyer), submitted(buyer)
    assert cancel(buyer, first["id"]).status_code == 200

    assert submitted_ids(buyer) == [second["id"]]
    cancelled = buyer.get(f"{ORDERS}?status=cancelled").json()
    assert [o["id"] for o in cancelled["data"]] == [first["id"]] and cancelled["meta"]["total"] == 1
    assert buyer.get(f"{ORDERS}?status=delivered").status_code == 422
    assert buyer.get(f"{ORDERS}?limit=51").status_code == 422


def test_existing_orders_stay_accessible_when_ordering_is_off_and_closed(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)
    configure(admin, enabled=False, serviceableBlocks=[], operatingDays=[1])
    auth_env.clock.advance(days=3)

    assert get(buyer, order["id"]).json()["data"]["delivery"]["addressLine"] == ADDRESS
    assert [o["id"] for o in buyer.get(ORDERS).json()["data"]] == [order["id"]]
    assert cancel(buyer, order["id"]).json()["data"]["status"] == "cancelled"


# -- cancellation --------------------------------------------------------------------------------------


def test_cancelling_records_the_time_the_reason_and_the_history(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)
    auth_env.clock.advance(minutes=3)

    response = cancel(buyer, order["id"], reason="  Ordered twice by mistake ")

    data = response.json()["data"]
    assert (data["status"], data["revision"], data["canCancel"]) == ("cancelled", 2, False)
    assert data["cancelReason"] == "Ordered twice by mistake"
    assert datetime.datetime.fromisoformat(data["cancelledAt"]) == auth_env.clock()
    assert [(h.get("fromStatus"), h["toStatus"], h.get("reason")) for h in data["history"]] == [
        (None, "submitted", None),
        ("submitted", "cancelled", "Ordered twice by mistake"),
    ]
    assert places(auth_env.session) == 1


def test_a_reason_is_optional(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)

    data = cancel(buyer, order["id"], reason="   ").json()["data"]

    assert data["status"] == "cancelled" and "cancelReason" not in data


@pytest.mark.parametrize("revision", [1, 2], ids=["same body", "newest revision"])
def test_a_repeated_cancellation_is_refused_and_changes_nothing(
    auth_env: AuthEnv, revision: int
) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)
    first = cancel(buyer, order["id"], reason="Changed my mind").json()["data"]

    again = cancel(buyer, order["id"], revision, reason="Again")

    assert outcome(again) == (409, "invalid_state_transition")
    assert get(buyer, order["id"]).json()["data"] == first
    assert (history_count(auth_env.session), places(auth_env.session)) == (2, 1)


def test_a_stale_revision_is_refused(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)

    response = cancel(buyer, order["id"], revision=7)

    assert outcome(response) == (409, "order_conflict")
    assert detail_pairs(response) == {("revision", "stale_revision")}
    assert stored(auth_env, "status", order["id"]) == "submitted"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"revision": 0},
        {"revision": "1"},
        {"revision": 1, "status": "cancelled"},
        {"revision": 1, "reason": "x" * 201},
    ],
)
def test_an_invalid_cancellation_body_is_refused(auth_env: AuthEnv, body: dict[str, Any]) -> None:
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    order = submitted(buyer)

    response = buyer.request("POST", f"{ORDERS}/{order['id']}/cancel", json=body)

    assert outcome(response) == (422, "validation_error")
    assert stored(auth_env, "status", order["id"]) == "submitted"


def test_there_is_no_route_that_sets_a_status(auth_env: AuthEnv) -> None:
    paths = {
        (method.upper(), path)
        for path, operations in auth_env.app.openapi()["paths"].items()
        if "grocery" in path
        for method in operations
    }

    assert paths == {
        ("GET", "/api/v1/grocery/availability"),
        ("POST", "/api/v1/grocery/orders"),
        ("GET", "/api/v1/grocery/orders"),
        ("GET", "/api/v1/grocery/orders/{order_id}"),
        ("POST", "/api/v1/grocery/orders/{order_id}/cancel"),
        ("GET", "/api/v1/admin/grocery/settings"),
        ("PATCH", "/api/v1/admin/grocery/settings"),
    }


# -- privacy -------------------------------------------------------------------------------------------

SECRETS = (PHONE_STORED, PHONE_TYPED, ADDRESS, "Test Customer", "Blue gate", "Please ring twice")


def assert_logs_are_clean(
    caplog: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    captured = capsys.readouterr()
    everything = caplog.text + captured.out + captured.err
    assert everything  # something WAS logged, so the check is not vacuous
    for secret in SECRETS:
        assert secret not in everything, secret


def test_delivery_details_never_reach_the_logs(
    auth_env: AuthEnv, caplog: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    caplog.set_level(logging.DEBUG)
    open_for_orders(auth_env)
    buyer = customer(auth_env)

    order = submitted(buyer)
    buyer.get(ORDERS)
    get(buyer, order["id"])
    submit(buyer, order_body(delivery=delivery(block="Nowhere")))
    cancel(buyer, order["id"], reason="Blue gate is locked")

    assert_logs_are_clean(caplog, capsys)


def test_a_database_error_while_saving_logs_no_delivery_detail(
    auth_env: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """An unexpected database error is logged. SQLAlchemy would put the statement parameters in
    it, and PostgreSQL can quote the failing row: both are stripped. Forced here by breaking a
    row so that a CHECK on the order itself fails."""
    open_for_orders(auth_env)
    buyer = customer(auth_env)
    original = GroceryRepository.add_order

    def broken(self: GroceryRepository, order: Any, items: Any) -> Any:
        order.reference = "BROKEN"  # violates ck_grocery_orders_reference_format
        return original(self, order, items)

    monkeypatch.setattr(GroceryRepository, "add_order", broken)
    caplog.set_level(logging.DEBUG)

    response = submit(buyer)

    assert outcome(response) == (500, "internal_error")
    everything = caplog.text
    assert "grocery write failed" in everything
    assert "ck_grocery_orders_reference_format" in everything
    assert "[parameters:" not in everything and "Failing row" not in everything
    assert_logs_are_clean(caplog, capsys)
    assert nothing_was_stored(auth_env)


def test_public_listing_and_search_routes_know_nothing_of_orders(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    submitted(customer(auth_env))
    anyone = auth_env.client()

    for path in (
        "/search?q=rice",
        "/search/suggestions?q=rice",
        "/categories",
        "/news",
        AVAILABILITY,
    ):
        response = anyone.get(path)
        assert response.status_code == 200, path
        for secret in (PHONE_STORED, ADDRESS, "Blue gate", "Test Customer"):
            assert secret not in response.text, (path, secret)


def test_an_order_creates_no_listing_service_request_or_role(auth_env: AuthEnv) -> None:
    def others() -> list[int]:
        return [
            int(auth_env.session.execute(text(f"SELECT count(*) FROM {t}")).scalar_one())  # noqa: S608
            for t in (
                "listings",
                "service_requests",
                "categories",
                "user_roles",
                "staff_scope_assignments",
                "staff_audit_events",
                "professional_profiles",
            )
        ]

    admin = owner_admin(auth_env, "before@example.org")
    configure(admin, enabled=True, serviceableBlocks=["Test Block A"])
    buyer = customer(auth_env)
    before = others()

    order = submitted(buyer)
    assert cancel(buyer, order["id"]).status_code == 200

    assert others() == before
