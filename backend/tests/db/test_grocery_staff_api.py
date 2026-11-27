"""GROCERY-2 through the real app on PostgreSQL: staff authorization, the queue, assignment, the
recorded customer agreement, the lifecycle, cash on delivery, cancellation, privacy and what the
customer sees (docs/backend/API_CONTRACT.md §19, AUTH_RBAC.md §37).

Concurrency and revocation are in ``test_grocery_staff_concurrency.py`` and
``test_privileged_session_races.py``.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import text

from app.core.rate_limit import RatePolicy
from app.models.enums import PlanCode, StaffScope
from app.repositories.grocery_staff import GroceryStaffRepository
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.grocery_helpers import (
    ADDRESS,
    PHONE_STORED,
    SETTINGS,
    STAFF_ORDERS,
    TODAY,
    TOTAL_PAISA,
    advance,
    agreement,
    cancel,
    configure,
    customer,
    grocery_moderator,
    new_key,
    open_for_orders,
    order_body,
    outcome,
    places,
    reagreement,
    staff_order,
    staff_post,
    submit,
    submitted,
)
from tests.db.test_grocery_orders_api import assert_logs_are_clean

QUEUE_FIELDS = {
    "id",
    "reference",
    "status",
    "revision",
    "submittedAt",
    "serviceDate",
    "block",
    "itemCount",
    "paymentCollected",
    "failedDeliveryAttempts",
    "issueCount",
}
PRIVATE = (PHONE_STORED, ADDRESS, "Test Customer", "Blue gate", "Basmati", "Please ring twice")
CHANGES = (
    "claim",
    "release",
    "confirm",
    "reconfirm",
    "reduce-amount",
    "start-preparing",
    "dispatch",
    "delivery-failed",
    "complete",
    "cancel",
    "issues",
)


def body_for(action: str, revision: int = 1) -> dict[str, Any] | None:
    """A well-formed body of ``action``."""
    if action in ("claim", "release"):
        return None
    if action == "confirm":
        return agreement(revision)
    if action == "reconfirm":
        return reagreement(revision)
    if action == "issues":
        return {"kind": "other", "note": "Please look at this."}
    extras: dict[str, dict[str, Any]] = {
        "reduce-amount": {"finalAmountPaisa": 100, "reason": "One item missing"},
        "delivery-failed": {"reason": "Nobody home"},
        "complete": {"amountCollectedPaisa": TOTAL_PAISA},
        "cancel": {"reason": "Customer asked by phone", "procurementAcknowledged": True},
    }
    return {"revision": revision, **extras.get(action, {})}


def stored(env: AuthEnv, sql: str, **params: Any) -> Any:
    env.session.expire_all()
    return env.session.execute(text(sql), params).scalar_one()


def rows(env: AuthEnv, table: str) -> int:
    return int(stored(env, f"SELECT count(*) FROM {table}"))  # noqa: S608 - fixed names


def everything(env: AuthEnv) -> tuple[Any, ...]:
    """All that a staff change could leave behind."""
    env.session.expire_all()
    return tuple(
        [str(row) for row in env.session.execute(text(f"SELECT * FROM {table} ORDER BY id"))]  # noqa: S608
        for table in (
            "grocery_orders",
            "grocery_order_status_history",
            "grocery_order_confirmations",
            "grocery_payments",
            "grocery_order_events",
        )
    )


def shop(env: AuthEnv, **settings: Any) -> tuple[AuthApi, AuthApi, str]:
    """Ordering open: the Super Admin, a customer, and one submitted order."""
    admin = open_for_orders(env, **settings)
    buyer = customer(env)
    return admin, buyer, submitted(buyer)["id"]


def my_order(api: AuthApi, order_id: str) -> dict[str, Any]:
    response = api.get(f"/grocery/orders/{order_id}")
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def problem(response: Response) -> tuple[int, str | None, set[tuple[str, str]]]:
    status, code = outcome(response)
    details = response.json().get("error", {}).get("details") or []
    return status, code, {(d["field"], d["code"]) for d in details}


# == who may reach the staff side ===================================================================


@pytest.mark.parametrize(
    "account",
    [
        {},
        {"professional": PlanCode.PREMIUM},
        {"moderator_scopes": [StaffScope.SERVICES]},
        {
            "moderator_scopes": [
                StaffScope.DIRECTORY,
                StaffScope.FOOD,
                StaffScope.EDUCATION,
                StaffScope.PROPERTY,
                StaffScope.SERVICES,
            ]
        },
        {"moderator_scopes": []},
    ],
    ids=["resident", "professional", "services moderator", "every listing scope", "paused"],
)
def test_nobody_without_grocery_authority_reaches_any_staff_route(
    auth_env: AuthEnv, account: dict[str, Any]
) -> None:
    _, _, order = shop(auth_env)
    outsider = customer(auth_env, "outsider", **account)
    before = everything(auth_env)

    answers = [outsider.get(STAFF_ORDERS), outsider.get(f"{STAFF_ORDERS}/{order}")]
    answers += [staff_post(outsider, order, action, body_for(action)) for action in CHANGES]
    # a junk body and an id that does not exist answer the same: no oracle
    answers.append(staff_post(outsider, str(uuid.uuid4()), "confirm", {"junk": True}))

    assert {outcome(r) for r in answers} == {(403, "forbidden")}
    assert all(r.headers["cache-control"] == "no-store" for r in answers)
    assert everything(auth_env) == before


def test_anonymous_unverified_and_stale_staff_are_refused(auth_env: AuthEnv) -> None:
    _, _, order = shop(auth_env)
    anyone = auth_env.client()
    assert outcome(anyone.get(STAFF_ORDERS)) == (401, "unauthenticated")

    make_account(
        auth_env.session,
        "new@example.org",
        verified=False,
        moderator_scopes=[StaffScope.GROCERY],
    )
    unverified = auth_env.client()
    assert unverified.login("new@example.org").status_code == 200
    assert outcome(unverified.get(STAFF_ORDERS)) == (403, "email_not_verified")

    runner = grocery_moderator(auth_env)
    assert runner.get(STAFF_ORDERS).status_code == 200
    auth_env.clock.advance(hours=13)
    assert outcome(staff_post(runner, order, "claim")) == (401, "session_expired")


def test_a_staff_change_needs_the_origin_and_the_csrf_token(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    assert outcome(staff_post(admin, order, "claim", origin=None)) == (403, "csrf_failed")
    assert outcome(staff_post(admin, order, "claim", csrf=None)) == (403, "csrf_failed")
    assert staff_order(admin, order).get("assignee") is None


def test_staff_changes_are_rate_limited_per_actor(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin, _, order = shop(auth_env)
    monkeypatch.setattr(
        "app.dependencies.grocery.GROCERY_STAFF_WRITE", RatePolicy("grocery_staff_write", 2, 900)
    )
    assert [staff_post(admin, order, "claim").status_code for _ in range(2)] == [200, 200]

    refused = staff_post(admin, order, "claim")

    assert outcome(refused) == (429, "rate_limited") and "retry-after" in refused.headers
    assert admin.get(STAFF_ORDERS).status_code == 200  # reads are not counted


# == the queue and the detail =======================================================================


def test_the_queue_lists_every_order_without_any_customer_detail(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    first = submitted(customer(auth_env, "one"))
    auth_env.clock.advance(minutes=1)
    second = submitted(customer(auth_env, "two"))
    runner = grocery_moderator(auth_env)

    response = runner.get(STAFF_ORDERS)
    data, meta = response.json()["data"], response.json()["meta"]

    assert [o["id"] for o in data] == [first["id"], second["id"]]  # oldest first
    assert all(set(o) == QUEUE_FIELDS for o in data)
    assert data[0]["itemCount"] == 2 and data[0]["serviceDate"] == TODAY.isoformat()
    for secret in PRIVATE:
        assert secret not in response.text
    assert meta["total"] == 2 and meta["limit"] == 12
    assert meta["counts"]["submitted"] == 2 and meta["counts"]["delivered"] == 0
    assert response.headers["cache-control"] == "no-store"
    newest = runner.get(f"{STAFF_ORDERS}?sort=newest&limit=1").json()
    assert [o["id"] for o in newest["data"]] == [second["id"]] and newest["meta"]["total"] == 2


def test_the_queue_filters_by_status_reference_day_and_assignee(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env)
    first = submitted(customer(auth_env, "one"))
    second = submitted(customer(auth_env, "two"))
    runner = grocery_moderator(auth_env)
    advance(runner, first["id"], "confirmed")
    runner_id = runner.me().json()["data"]["id"]

    def found(query: str, api: AuthApi = runner) -> set[str]:
        response = api.get(f"{STAFF_ORDERS}?{query}")
        assert response.status_code == 200, response.text
        return {o["id"] for o in response.json()["data"]}

    assert found("status=confirmed") == {first["id"]}
    assert found("status=submitted") == {second["id"]}
    for text_typed in (second["reference"], second["reference"].lower(), second["reference"][4:9]):
        assert found(f"reference={text_typed}") == {second["id"]}, text_typed
    assert found("reference=%25%25%25") == set()  # LIKE characters are literal
    assert found(f"submittedOn={TODAY.isoformat()}") == {first["id"], second["id"]}
    assert found("submittedOn=2026-01-01") == set()
    assert found("assigned=me") == {first["id"]}
    assert found("assigned=me", admin) == set()
    assert found("assigned=unassigned") == {second["id"]}
    assert found(f"assigned={runner_id}", admin) == {first["id"]}
    counted = runner.get(f"{STAFF_ORDERS}?assigned=me&status=submitted").json()["meta"]
    assert counted["total"] == 0 and counted["counts"]["confirmed"] == 1
    for bad in ("assigned=somebody", "reference=ab", "status=shopping", "limit=51"):
        assert outcome(runner.get(f"{STAFF_ORDERS}?{bad}")) == (422, "validation_error"), bad


def test_the_detail_has_what_is_needed_to_handle_the_order(auth_env: AuthEnv) -> None:
    _, _, order = shop(auth_env)
    runner = grocery_moderator(auth_env)

    detail = staff_order(runner, order)

    assert [i["name"] for i in detail["items"]] == ["Basmati rice", "Eggs"]
    assert detail["items"][0]["preferredBrand"] == "Any good one"
    assert detail["items"][1]["substitution"] == "none"
    assert detail["delivery"]["contactPhone"] == PHONE_STORED
    assert detail["delivery"]["addressLine"] == ADDRESS
    assert detail["instructions"] == "Please ring twice."
    assert detail["confirmations"] == [] and "payment" not in detail
    assert detail["availableActions"] == ["claim", "record_issue"]
    assert detail["history"][0]["actorRole"] == "customer"
    assert "actor" not in detail["history"][0]  # a customer is a capacity here, not an account
    for missing in (str(uuid.uuid4()), "not-an-id"):
        response = runner.get(f"{STAFF_ORDERS}/{missing}")
        assert outcome(response) == (404, "not_found")
        assert response.headers["cache-control"] == "no-store"


# == assignment =====================================================================================


def test_one_staff_member_holds_an_order(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    first, second = grocery_moderator(auth_env, "first"), grocery_moderator(auth_env, "second")

    held = staff_post(first, order, "claim").json()["data"]

    assert held["assignee"]["displayName"] == "First" and held["revision"] == 1
    assert held["availableActions"] == ["release", "confirm", "cancel", "record_issue"]
    assert staff_post(first, order, "claim").status_code == 200  # again: nothing changes
    assert outcome(staff_post(second, order, "claim")) == (409, "order_already_claimed")
    assert outcome(staff_post(second, order, "release")) == (409, "order_not_claimed")
    assert outcome(staff_post(second, order, "confirm", agreement())) == (409, "order_not_claimed")
    assert staff_order(second, order)["availableActions"] == ["record_issue"]

    assert staff_post(admin, order, "release").status_code == 200  # a Super Admin may
    assert outcome(staff_post(first, order, "release")) == (409, "order_not_claimed")
    assert outcome(staff_post(first, order, "confirm", agreement())) == (409, "order_not_claimed")
    assert staff_post(second, order, "claim").status_code == 200
    events = staff_order(second, order)["events"]
    assert [(e["action"], e["subject"]["displayName"]) for e in events] == [
        ("claimed", "First"),
        ("released", "First"),
        ("claimed", "Second"),
    ]


def test_a_super_admin_may_act_without_claiming(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)

    response = staff_post(admin, order, "confirm", agreement())

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "confirmed"


def test_the_customers_own_cancellation_still_works_after_a_claim(auth_env: AuthEnv) -> None:
    """Claiming does not change the revision the customer is looking at."""
    _, buyer, order = shop(auth_env)
    staff_post(grocery_moderator(auth_env), order, "claim")

    response = cancel(buyer, order, revision=1, reason="Changed my mind")

    assert response.status_code == 200
    data = response.json()["data"]
    assert (data["status"], data["cancelledBy"], data["cancelReason"]) == (
        "cancelled",
        "customer",
        "Changed my mind",
    )


@pytest.mark.parametrize("role", ["grocery moderator", "super admin"])
def test_nobody_handles_their_own_order(auth_env: AuthEnv, role: str) -> None:
    open_for_orders(auth_env)
    account: dict[str, Any] = (
        {"admin": True} if role == "super admin" else {"moderator_scopes": [StaffScope.GROCERY]}
    )
    me = customer(auth_env, "self", **account)
    order = submitted(me)["id"]
    before = everything(auth_env)

    for action in CHANGES:
        refused = staff_post(me, order, action, body_for(action))
        assert problem(refused) == (403, "forbidden", {("order", "own_order")}), action

    assert staff_order(me, order)["availableActions"] == []
    assert everything(auth_env) == before


# == the customer's agreement and the price =========================================================


def test_confirming_records_who_said_the_customer_agreed_and_to_what(auth_env: AuthEnv) -> None:
    _, buyer, order = shop(auth_env)
    runner = grocery_moderator(auth_env)
    staff_post(runner, order, "claim")

    response = staff_post(
        runner,
        order,
        "confirm",
        agreement(pricingNote="Market rate today", consentNote="Brown eggs are fine"),
    )

    detail = response.json()["data"]
    assert (detail["status"], detail["revision"]) == ("confirmed", 2)
    assert (detail["agreedTotalPaisa"], detail["finalAmountDuePaisa"]) == (210_000, 210_000)
    (record,) = detail["confirmations"]
    assert record["totalPaisa"] == 210_000 and record["method"] == "phone_call"
    assert record["recordedBy"]["displayName"] == "Runner" and record["recordedAt"]
    assert (record["pricingNote"], record["consentNote"]) == (
        "Market rate today",
        "Brown eggs are fine",
    )

    seen = buyer.get(f"/grocery/orders/{order}")
    mine = seen.json()["data"]
    assert mine["status"] == "confirmed" and mine["canCancel"] is False
    assert mine["agreedTotalPaisa"] == mine["finalAmountDuePaisa"] == 210_000
    (told,) = mine["agreements"]
    assert told == {
        "sequence": 1,
        "itemsSubtotalPaisa": 185_000,
        "serviceFeePaisa": 10_000,
        "deliveryFeePaisa": 15_000,
        "totalPaisa": 210_000,
        "method": "phone_call",
        "recordedBy": "staff",  # recorded BY THE TEAM: not an approval the customer gave in the app
        "recordedAt": record["recordedAt"],
    }
    assert mine["payment"] == {
        "method": "cash_on_delivery",
        "status": "due",
        "amountDuePaisa": 210_000,
    }
    assert [(h["toStatus"], h["actorRole"]) for h in mine["history"]] == [
        ("submitted", "customer"),
        ("confirmed", "staff"),
    ]
    for internal in ("Market rate", "Brown eggs", "Runner", "pricingNote", "recordedByStaff"):
        assert internal not in seen.text
    assert outcome(cancel(buyer, order, revision=2)) == (409, "invalid_state_transition")


def test_fees_may_be_zero(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    body = agreement(agreedTotalPaisa=185_000)
    del body["serviceFeePaisa"], body["deliveryFeePaisa"]

    data = staff_post(admin, order, "confirm", body).json()["data"]

    assert data["finalAmountDuePaisa"] == 185_000
    assert data["confirmations"][0]["serviceFeePaisa"] == 0


def test_an_agreement_that_is_not_exact_is_refused_and_stores_nothing(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    before = everything(auth_env)
    no_agreement = agreement()
    del no_agreement["customerAgreed"]
    cap = 2_000_000
    cases: list[tuple[dict[str, Any], str, str]] = [
        (agreement(agreedTotalPaisa=TOTAL_PAISA - 1), "agreedTotalPaisa", "total_mismatch"),
        (agreement(customerAgreed=False), "customerAgreed", "agreement_required"),
        (no_agreement, "customerAgreed", "required"),
        (agreement(customerAgreed="true"), "customerAgreed", "invalid_type"),
        (agreement(itemsSubtotalPaisa=185_000.0), "itemsSubtotalPaisa", "invalid_type"),
        (agreement(itemsSubtotalPaisa="185000"), "itemsSubtotalPaisa", "invalid_type"),
        (agreement(itemsSubtotalPaisa=0), "itemsSubtotalPaisa", "too_small"),
        (agreement(deliveryFeePaisa=-1), "deliveryFeePaisa", "too_small"),
        (agreement(serviceFeePaisa=100_000_001), "serviceFeePaisa", "too_big"),
        (agreement(method="app_approval"), "method", "invalid_value"),
        ({**agreement(), "totalPaisa": 1}, "totalPaisa", "not_allowed"),
        ({**agreement(), "recordedBy": str(uuid.uuid4())}, "recordedBy", "not_allowed"),
        # the cap includes the fees: items alone are under it
        (
            agreement(itemsSubtotalPaisa=cap - 15_000, agreedTotalPaisa=cap + 10_000 - 0),
            "agreedTotalPaisa",
            "exceeds_order_limit",
        ),
    ]
    for body, field, _code in cases:
        response = staff_post(admin, order, "confirm", body)
        status, code, details = problem(response)
        assert (status, code) == (422, "validation_error"), (field, response.text)
        assert field in {d[0] for d in details}, (field, details)

    mismatch = staff_post(admin, order, "confirm", cases[0][0])
    assert problem(mismatch)[2] == {("agreedTotalPaisa", "total_mismatch")}
    over = staff_post(admin, order, "confirm", cases[-1][0])
    assert problem(over)[2] == {("agreedTotalPaisa", "exceeds_order_limit")}
    assert everything(auth_env) == before


def test_the_order_value_cap_is_a_setting(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    assert admin.get(SETTINGS).json()["data"]["maxOrderValuePaisa"] == 2_000_000
    exactly = agreement(
        itemsSubtotalPaisa=2_000_000,
        serviceFeePaisa=0,
        deliveryFeePaisa=0,
        agreedTotalPaisa=2_000_000,
    )
    configure(admin, maxOrderValuePaisa=1_999_999)
    refused = staff_post(admin, order, "confirm", exactly)
    assert problem(refused)[2] == {("agreedTotalPaisa", "exceeds_order_limit")}

    configure(admin, maxOrderValuePaisa=2_000_000)
    assert staff_post(admin, order, "confirm", exactly).status_code == 200
    # lowering it afterwards touches no agreement already recorded
    configure(admin, maxOrderValuePaisa=100)
    assert staff_order(admin, order)["finalAmountDuePaisa"] == 2_000_000
    for bad in (99, 100_000_001, "2000000", 2000.5):
        current = admin.get(SETTINGS).json()["data"]["revision"]
        response = admin.request(
            "PATCH", SETTINGS, json={"revision": current, "maxOrderValuePaisa": bad}
        )
        assert outcome(response) == (422, "validation_error"), bad


def test_a_higher_price_needs_a_new_agreement_and_the_old_one_stays(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env)
    detail = advance(admin, order, "preparing")
    higher = {"revision": detail["revision"], "finalAmountPaisa": 250_000, "reason": "Dearer"}

    assert problem(staff_post(admin, order, "reduce-amount", higher))[2] == {
        ("finalAmountPaisa", "not_a_reduction")
    }
    renewed = staff_post(
        admin,
        order,
        "reconfirm",
        agreement(
            detail["revision"],
            itemsSubtotalPaisa=225_000,
            agreedTotalPaisa=250_000,
            consentNote="Agreed to the dearer rice",
        ),
    ).json()["data"]

    assert (renewed["status"], renewed["revision"]) == ("preparing", detail["revision"] + 1)
    assert renewed["agreedTotalPaisa"] == renewed["finalAmountDuePaisa"] == 250_000
    assert [(c["sequence"], c["totalPaisa"]) for c in renewed["confirmations"]] == [
        (1, 210_000),
        (2, 250_000),
    ]
    assert [a["totalPaisa"] for a in my_order(buyer, order)["agreements"]] == [210_000, 250_000]
    assert [h["toStatus"] for h in renewed["history"]] == ["submitted", "confirmed", "preparing"]
    with pytest.raises(Exception, match="append-only"):
        auth_env.session.execute(text("UPDATE grocery_order_confirmations SET total_paisa = 1"))
    auth_env.session.rollback()


@pytest.mark.parametrize(
    "note",
    [None, "", "   ", "left out", "x" * 501],
    ids=["null", "empty", "blank", "absent", "too long"],
)
def test_a_new_agreement_must_say_what_the_customer_agreed_to(
    auth_env: AuthEnv, note: str | None
) -> None:
    admin, _, order = shop(auth_env)
    detail = advance(admin, order, "preparing")
    body = reagreement(detail["revision"], consentNote=note)
    if note == "left out":
        del body["consentNote"]
    before = everything(auth_env)

    status, code, details = problem(staff_post(admin, order, "reconfirm", body))

    assert (status, code) == (422, "validation_error")
    assert {field for field, _ in details} == {"consentNote"}
    assert everything(auth_env) == before


def test_an_approved_substitution_is_recorded_even_when_the_price_is_unchanged(
    auth_env: AuthEnv,
) -> None:
    admin, buyer, order = shop(auth_env)
    detail = advance(admin, order, "preparing")  # the first confirmation needed no note
    assert "consentNote" not in detail["confirmations"][0]
    note = "Brown eggs instead of white eggs, same price: agreed on the phone."

    response = staff_post(
        admin, order, "reconfirm", reagreement(detail["revision"], consentNote=note)
    )

    first, second = response.json()["data"]["confirmations"]
    assert (first["totalPaisa"], second["totalPaisa"]) == (210_000, 210_000)
    assert second["consentNote"] == note and second["recordedBy"]["userId"]
    seen = buyer.get(f"/grocery/orders/{order}")
    assert "Brown eggs" not in seen.text  # internal: the team tells the customer itself
    assert [a["recordedBy"] for a in seen.json()["data"]["agreements"]] == ["staff", "staff"]


def test_the_amount_due_can_be_lowered_with_a_reason(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env)
    detail = advance(admin, order, "out_for_delivery")
    revision = detail["revision"]
    for bad in (
        {"revision": revision, "finalAmountPaisa": 200_000},
        {"revision": revision, "finalAmountPaisa": 200_000, "reason": "  "},
        {"revision": revision, "finalAmountPaisa": 0, "reason": "Free"},
        {"revision": revision, "finalAmountPaisa": 210_000, "reason": "Same"},
    ):
        assert outcome(staff_post(admin, order, "reduce-amount", bad)) == (422, "validation_error")

    lowered = staff_post(
        admin,
        order,
        "reduce-amount",
        {"revision": revision, "finalAmountPaisa": 190_000, "reason": "One bag torn"},
    ).json()["data"]

    assert (lowered["agreedTotalPaisa"], lowered["finalAmountDuePaisa"]) == (210_000, 190_000)
    event = lowered["events"][-1]
    assert (event["action"], event["amountBeforePaisa"], event["amountAfterPaisa"]) == (
        "amount_reduced",
        210_000,
        190_000,
    )
    assert event["note"] == "One bag torn"
    mine = my_order(buyer, order)
    assert mine["finalAmountDuePaisa"] == 190_000 == mine["payment"]["amountDuePaisa"]
    assert "torn" not in str(mine)


# == the lifecycle ==================================================================================


def test_an_order_goes_from_submitted_to_delivered_and_paid(auth_env: AuthEnv) -> None:
    _, buyer, order = shop(auth_env)
    runner = grocery_moderator(auth_env)

    done = advance(runner, order, "delivered")

    assert done["revision"] == 5 and done["deliveredAt"] and done["paymentCollected"] is True
    assert [(h.get("fromStatus"), h["toStatus"]) for h in done["history"]] == [
        (None, "submitted"),
        ("submitted", "confirmed"),
        ("confirmed", "preparing"),
        ("preparing", "out_for_delivery"),
        ("out_for_delivery", "delivered"),
    ]
    assert all(
        h["actor"]["displayName"] == "Runner" and h["createdAt"] for h in done["history"][1:]
    )
    payment = done["payment"]
    assert (payment["amountDuePaisa"], payment["amountCollectedPaisa"]) == (210_000, 210_000)
    assert payment["collectedBy"]["displayName"] == "Runner" and payment["collectedAt"]
    assert done["availableActions"] == ["record_issue"]

    mine = my_order(buyer, order)
    assert mine["status"] == "delivered" and mine["deliveredAt"]
    assert mine["payment"] == {
        "method": "cash_on_delivery",
        "status": "collected",
        "amountDuePaisa": 210_000,
        "amountCollectedPaisa": 210_000,
        "collectedAt": payment["collectedAt"],
    }
    listed = buyer.get("/grocery/orders").json()["data"][0]
    assert listed["finalAmountDuePaisa"] == 210_000 and listed["deliveredAt"]


#: status -> the status-changing (or status-bound) operations it allows.
ALLOWED = {
    "submitted": {"confirm", "cancel"},
    "confirmed": {"reconfirm", "reduce-amount", "start-preparing", "cancel"},
    "preparing": {"reconfirm", "reduce-amount", "dispatch", "cancel"},
    "out_for_delivery": {"reduce-amount", "delivery-failed", "complete"},
    "delivered": set(),
    "cancelled": set(),
}


@pytest.mark.parametrize("status", list(ALLOWED))
def test_every_other_operation_is_refused_and_changes_nothing(
    auth_env: AuthEnv, status: str
) -> None:
    admin, _, order = shop(auth_env)
    detail = advance(admin, order, status)
    before = everything(auth_env)
    bound = [a for a in CHANGES if a not in ("claim", "release", "issues")]

    for action in bound:
        if action not in ALLOWED[status]:
            response = staff_post(admin, order, action, body_for(action, detail["revision"]))
            assert outcome(response) == (409, "invalid_state_transition"), (status, action)
    if status in ("delivered", "cancelled"):
        for action in ("claim", "release"):
            assert outcome(staff_post(admin, order, action)) == (409, "invalid_state_transition")
    # an allowed operation seen at an old revision is refused too
    for action in ALLOWED[status]:
        response = staff_post(admin, order, action, body_for(action, detail["revision"] + 1))
        assert outcome(response) == (409, "order_conflict"), (status, action)

    assert everything(auth_env) == before


def test_no_route_sets_a_status_or_skips_a_stage(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    for path in (f"{STAFF_ORDERS}/{order}", f"{STAFF_ORDERS}/{order}/status"):
        assert admin.request("PATCH", path, json={"status": "delivered"}).status_code in (404, 405)
    forged = {"revision": 1, "status": "delivered"}
    assert outcome(staff_post(admin, order, "start-preparing", forged)) == (422, "validation_error")
    assert staff_order(admin, order)["status"] == "submitted"


# == failed delivery and cash =======================================================================


def test_a_failed_delivery_is_never_delivered_or_paid_and_can_be_retried(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env)
    detail = advance(admin, order, "out_for_delivery")
    no_reason = {"revision": detail["revision"]}
    assert outcome(staff_post(admin, order, "delivery-failed", no_reason))[0] == 422

    failed = staff_post(
        admin,
        order,
        "delivery-failed",
        {"revision": detail["revision"], "reason": "Nobody home"},
    ).json()["data"]

    assert (failed["status"], failed["failedDeliveryAttempts"]) == ("preparing", 1)
    assert "payment" not in failed and "deliveredAt" not in failed
    assert rows(auth_env, "grocery_payments") == 0
    (attempt,) = failed["deliveryAttempts"]
    assert (attempt["outcome"], attempt["failureReason"]) == ("failed", "Nobody home")
    mine = my_order(buyer, order)
    assert mine["payment"]["status"] == "due" and "Nobody home" not in str(mine)

    again = staff_post(
        admin, order, "dispatch", {"revision": failed["revision"], "note": "Second run"}
    ).json()["data"]
    done = staff_post(
        admin,
        order,
        "complete",
        {"revision": again["revision"], "amountCollectedPaisa": TOTAL_PAISA},
    ).json()["data"]
    assert [(a["attempt"], a["outcome"], a.get("note")) for a in done["deliveryAttempts"]] == [
        (1, "failed", None),
        (2, "delivered", "Second run"),
    ]
    assert rows(auth_env, "grocery_payments") == 1


def test_only_the_exact_amount_completes_an_order(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    detail = advance(admin, order, "out_for_delivery")
    before = everything(auth_env)
    for collected in (TOTAL_PAISA - 1, TOTAL_PAISA + 1, 1):
        response = staff_post(
            admin,
            order,
            "complete",
            {"revision": detail["revision"], "amountCollectedPaisa": collected},
        )
        assert problem(response)[2] == {("amountCollectedPaisa", "amount_mismatch")}, collected
    assert everything(auth_env) == before  # still out for delivery, nothing paid

    noted = staff_post(
        admin, order, "issues", {"kind": "payment_discrepancy", "note": "Rs 100 short"}
    ).json()["data"]
    assert (noted["status"], noted["issueCount"]) == ("out_for_delivery", 1)
    assert noted["revision"] == detail["revision"]


def test_a_completion_is_recorded_once(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    done = advance(admin, order, "delivered")

    for revision in (done["revision"], done["revision"] - 1):  # a re-send of either
        again = staff_post(
            admin,
            order,
            "complete",
            {"revision": revision, "amountCollectedPaisa": TOTAL_PAISA},
        )
        assert outcome(again) == (409, "invalid_state_transition")
    assert rows(auth_env, "grocery_payments") == 1
    for statement in (
        "UPDATE grocery_payments SET amount_collected_paisa = 1",
        "DELETE FROM grocery_payments",
    ):
        with pytest.raises(Exception, match="append-only"):
            auth_env.session.execute(text(statement))
        auth_env.session.rollback()


# == cancellation ===================================================================================


@pytest.mark.parametrize("status", ["submitted", "confirmed"])
def test_staff_cancel_before_purchasing_with_a_reason_the_customer_never_sees(
    auth_env: AuthEnv, status: str
) -> None:
    _, buyer, order = shop(auth_env)
    runner = grocery_moderator(auth_env)
    detail = advance(runner, order, status)
    assert outcome(staff_post(runner, order, "cancel", {"revision": detail["revision"]}))[0] == 422

    cancelled = staff_post(
        runner,
        order,
        "cancel",
        {"revision": detail["revision"], "reason": "Suspected prank order"},
    ).json()["data"]

    assert cancelled["status"] == "cancelled" and cancelled["cancelledAt"]
    assert cancelled["history"][-1]["reason"] == "Suspected prank order"
    assert cancelled["issueCount"] == 0
    mine = my_order(buyer, order)
    assert (mine["status"], mine["cancelledBy"]) == ("cancelled", "staff")
    assert "cancelReason" not in mine and "payment" not in mine and "prank" not in str(mine)
    assert stored(auth_env, "SELECT cancel_reason FROM grocery_orders") is None


def test_cancelling_after_purchasing_is_the_super_admins_and_stays_visible(
    auth_env: AuthEnv,
) -> None:
    admin, _, order = shop(auth_env)
    runner = grocery_moderator(auth_env)
    detail = advance(runner, order, "preparing")
    body = {"revision": detail["revision"], "reason": "Customer left town"}
    assert "cancel" not in detail["availableActions"]

    assert problem(staff_post(runner, order, "cancel", body)) == (
        403,
        "forbidden",
        {("order", "super_admin_required")},
    )
    assert problem(staff_post(admin, order, "cancel", body))[2] == {
        ("procurementAcknowledged", "acknowledgement_required")
    }
    done = staff_post(admin, order, "cancel", {**body, "procurementAcknowledged": True}).json()[
        "data"
    ]

    assert (done["status"], done["issueCount"]) == ("cancelled", 1)
    assert done["events"][-1]["issueKind"] == "cancelled_after_procurement"
    assert "payment" not in done  # nothing was collected and no refund is created
    assert rows(auth_env, "grocery_payments") == 0


# == limits, capacity and issues ====================================================================


def test_only_delivered_and_cancelled_orders_stop_counting_as_active(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env, maxActiveOrdersPerCustomer=1)
    detail = advance(admin, order, "confirmed")
    for action in ("start-preparing", "dispatch"):
        assert outcome(submit(buyer)) == (409, "grocery_active_order_limit"), action
        detail = staff_post(admin, order, action, {"revision": detail["revision"]}).json()["data"]
    assert outcome(submit(buyer)) == (409, "grocery_active_order_limit")

    staff_post(
        admin,
        order,
        "complete",
        {"revision": detail["revision"], "amountCollectedPaisa": TOTAL_PAISA},
    )
    second = submitted(buyer)["id"]
    advance(admin, second, "cancelled")
    submitted(buyer)

    assert places(auth_env.session) == 3  # delivered and cancelled orders keep their places


def test_a_retried_submission_returns_the_order_as_staff_left_it(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env)
    buyer = customer(auth_env)
    key = new_key()
    order = submitted(buyer, key=key)["id"]
    advance(admin, order, "preparing")

    retry = submit(buyer, order_body(), key)

    assert retry.status_code == 200
    assert (retry.json()["data"]["id"], retry.json()["data"]["status"]) == (order, "preparing")
    assert places(auth_env.session) == 1


def test_an_issue_can_be_recorded_by_any_grocery_staff_and_changes_nothing_else(
    auth_env: AuthEnv,
) -> None:
    admin, buyer, order = shop(auth_env)
    advance(admin, order, "delivered")
    other = grocery_moderator(auth_env, "other")
    for bad in (
        {"kind": "other"},
        {"kind": "other", "note": " "},
        {"kind": "cancelled_after_procurement", "note": "forged"},
        {"kind": "refund", "note": "x"},
    ):
        assert outcome(staff_post(other, order, "issues", bad)) == (422, "validation_error"), bad

    noted = staff_post(
        other, order, "issues", {"kind": "item_shortage", "note": "Eggs missing"}
    ).json()["data"]

    assert (noted["status"], noted["revision"], noted["issueCount"]) == ("delivered", 5, 1)
    assert "Eggs missing" not in str(my_order(buyer, order))


# == privacy ========================================================================================


def test_no_delivery_detail_or_staff_note_reaches_the_logs(
    auth_env: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Including an unexpected database error while a staff change is being saved."""
    caplog.set_level(logging.DEBUG)
    admin, _, order = shop(auth_env)
    advance(admin, order, "confirmed")
    admin.get(STAFF_ORDERS)
    original = GroceryStaffRepository.add_record

    def broken(self: GroceryStaffRepository, row: Any) -> None:
        row.note = None  # an issue without a note violates ck_grocery_order_events_reason_required
        original(self, row)

    monkeypatch.setattr(GroceryStaffRepository, "add_record", broken)
    response = staff_post(
        admin, order, "issues", {"kind": "other", "note": "Please ring twice at Blue gate"}
    )

    assert outcome(response) == (500, "internal_error")
    assert "ck_grocery_order_events_reason_required" in caplog.text
    assert "[parameters:" not in caplog.text and "Failing row" not in caplog.text
    assert_logs_are_clean(caplog, capsys)


def test_another_customer_still_sees_nothing(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    advance(admin, order, "delivered")

    stranger = customer(auth_env, "stranger")

    assert outcome(stranger.get(f"/grocery/orders/{order}")) == (404, "not_found")
    assert stranger.get("/grocery/orders").json()["data"] == []
