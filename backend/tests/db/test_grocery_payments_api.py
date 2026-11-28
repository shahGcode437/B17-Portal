"""GROCERY-4C through the real app on PostgreSQL: payment methods, recording a verified payment,
paid orders, the Super Admin's refund record, what each side sees, the database's own guards and
the all-of-B-17 confirmation (docs/backend/API_CONTRACT.md §21, DATA_MODEL.md §24).

Races on separate connections are in ``test_grocery_payment_concurrency.py``; revocation of the
acting session in ``test_privileged_session_races.py``; the cash-on-delivery behaviour that did
not change is still in ``test_grocery_staff_api.py``.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.models.enums import StaffScope
from app.services import grocery_rules as rules
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.grocery_helpers import (
    ALL_METHODS,
    BLOCKS,
    ORDERS,
    SETTINGS,
    STAFF_ORDERS,
    TOTAL_PAISA,
    advance,
    configure,
    customer,
    grocery_moderator,
    open_for_orders,
    order_body,
    outcome,
    payment_body,
    places,
    reagreement,
    refund_body,
    staff_order,
    staff_post,
    submit,
    submitted,
)
from tests.db.test_grocery_staff_api import everything, problem, rows, stored

CASH = "cash_on_delivery"


def shop(env: AuthEnv, methods: list[str] | None = None) -> tuple[AuthApi, AuthApi, str]:
    """Ordering open with ``methods`` switched on: Super Admin, customer, one submitted order."""
    admin = open_for_orders(env, paymentMethods=ALL_METHODS if methods is None else methods)
    buyer = customer(env)
    return admin, buyer, submitted(buyer)["id"]


def at(admin: AuthApi, order: str, status: str) -> dict[str, Any]:
    return advance(admin, order, status)


def pay(api: AuthApi, order: str, **changes: Any) -> dict[str, Any]:
    revision = changes.pop("revision", None) or staff_order(api, order)["revision"]
    response = staff_post(api, order, "record-payment", payment_body(revision, **changes))
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def mine(buyer: AuthApi, order: str) -> dict[str, Any]:
    response = buyer.get(f"{ORDERS}/{order}")
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def refused(env: AuthEnv, api: AuthApi, order: str, action: str, body: dict[str, Any]) -> Any:
    """The answer to a change that must leave everything exactly as it was."""
    before = everything(env)
    answer = problem(staff_post(api, order, action, body))
    assert everything(env) == before
    return answer


# == the offered methods =============================================================================


def test_only_cash_is_offered_until_a_super_admin_switches_more_on(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env)
    anyone = auth_env.client()
    assert anyone.get("/grocery/availability").json()["data"]["paymentMethods"] == [CASH]
    assert admin.get(SETTINGS).json()["data"]["paymentMethods"] == [CASH]

    saved = configure(admin, paymentMethods=["jazzcash", "card", CASH])

    expected = [CASH, "card", "jazzcash"]  # one order, cash first, whatever was sent
    assert saved["paymentMethods"] == expected
    assert anyone.get("/grocery/availability").json()["data"]["paymentMethods"] == expected
    assert configure(admin, paymentMethods=expected)["revision"] == saved["revision"]  # no-op


@pytest.mark.parametrize(
    ("methods", "code"),
    [
        (["card"], "cash_required"),
        ([], "cash_required"),
        ([CASH, "card", "card"], "duplicate_method"),
        ([CASH, "bitcoin"], "enum"),
        (None, "not_nullable"),
    ],
)
def test_a_method_list_that_makes_no_sense_is_refused(
    auth_env: AuthEnv, methods: list[str] | None, code: str
) -> None:
    admin = open_for_orders(auth_env)
    revision = admin.get(SETTINGS).json()["data"]["revision"]

    answer = admin.request(
        "PATCH", SETTINGS, json={"revision": revision, "paymentMethods": methods}
    )

    assert answer.status_code == 422, answer.text
    assert code in {d["code"] for d in answer.json()["error"]["details"]}
    assert admin.get(SETTINGS).json()["data"]["revision"] == revision


def test_a_method_that_is_not_switched_on_cannot_be_recorded(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env, methods=[CASH, "card"])
    detail = at(admin, order, "confirmed")
    assert detail["recordableMethods"] == ["card"]

    answer = refused(auth_env, admin, order, "record-payment", payment_body(detail["revision"]))

    assert answer == (422, "validation_error", {("method", "method_not_enabled")})


def test_switching_a_method_off_stops_new_records_and_keeps_old_ones(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env)
    at(admin, order, "confirmed")
    pay(admin, order)
    other_buyer = customer(auth_env, "other")
    other = submitted(other_buyer)["id"]
    detail = at(admin, other, "confirmed")
    configure(admin, paymentMethods=[CASH])

    answer = refused(
        auth_env,
        admin,
        other,
        "record-payment",
        payment_body(detail["revision"], reference="TID-ANOTHER-1"),
    )

    assert answer[2] == {("method", "method_not_enabled")}
    assert staff_order(admin, order)["payment"]["method"] == "bank_transfer"
    assert staff_order(admin, other)["recordableMethods"] == []
    assert "record_payment" not in staff_order(admin, other)["availableActions"]


# == recording a verified payment ====================================================================


@pytest.mark.parametrize("method", ["bank_transfer", "easypaisa", "jazzcash", "card"])
def test_an_early_payment_is_paid_and_not_delivered(auth_env: AuthEnv, method: str) -> None:
    admin, buyer, order = shop(auth_env)
    confirmed = at(admin, order, "confirmed")

    paid = pay(admin, order, method=method, reference="tid 7788-99 ab")

    assert (paid["status"], paid.get("deliveredAt")) == (
        "confirmed",
        None,
    )
    assert paid["revision"] == confirmed["revision"] + 1  # a screen read before this is stale
    assert (paid["paymentStatus"], paid["paymentCollected"]) == ("paid", True)
    assert paid["payment"]["method"] == method
    assert paid["payment"]["reference"] == "TID778899AB"  # stored without spaces or hyphens
    assert paid["payment"]["amountCollectedPaisa"] == TOTAL_PAISA
    assert paid["payment"]["collectedBy"]["displayName"]
    assert paid["recordableMethods"] == []

    seen = mine(buyer, order)
    assert (seen["status"], seen["paymentStatus"]) == ("confirmed", "paid")
    assert seen["payment"] == {
        "method": method,
        "status": "collected",
        "amountDuePaisa": TOTAL_PAISA,
        "amountCollectedPaisa": TOTAL_PAISA,
        "collectedAt": seen["payment"]["collectedAt"],
    }
    assert "TID778899AB" not in buyer.get(f"{ORDERS}/{order}").text  # staff only
    assert buyer.get(ORDERS).json()["data"][0]["paymentStatus"] == "paid"
    assert rows(auth_env, "grocery_payments") == 1
    assert stored(auth_env, "SELECT status FROM grocery_orders") == "confirmed"


def test_a_card_payment_at_the_door_then_delivery_collects_nothing_more(
    auth_env: AuthEnv,
) -> None:
    admin, buyer, order = shop(auth_env)
    at(admin, order, "out_for_delivery")
    paid = pay(admin, order, method="card", reference="APPROVAL-004411")
    assert paid["status"] == "out_for_delivery"

    with_cash = refused(
        auth_env,
        admin,
        order,
        "complete",
        {"revision": paid["revision"], "amountCollectedPaisa": TOTAL_PAISA},
    )
    done = staff_post(admin, order, "complete", {"revision": paid["revision"]})

    assert with_cash == (422, "validation_error", {("amountCollectedPaisa", "already_paid")})
    assert done.status_code == 200, done.text
    assert done.json()["data"]["status"] == "delivered"
    assert done.json()["data"]["payment"]["method"] == "card"
    assert rows(auth_env, "grocery_payments") == 1
    assert mine(buyer, order)["payment"]["status"] == "collected"


def test_an_unpaid_delivery_still_needs_the_exact_cash(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env)
    detail = at(admin, order, "out_for_delivery")

    nothing = refused(auth_env, admin, order, "complete", {"revision": detail["revision"]})
    short = refused(
        auth_env,
        admin,
        order,
        "complete",
        {"revision": detail["revision"], "amountCollectedPaisa": TOTAL_PAISA - 1},
    )
    done = staff_post(
        admin,
        order,
        "complete",
        {"revision": detail["revision"], "amountCollectedPaisa": TOTAL_PAISA},
    )

    assert nothing[2] == {("amountCollectedPaisa", "missing")}
    assert short[2] == {("amountCollectedPaisa", "amount_mismatch")}
    assert done.status_code == 200, done.text
    payment = done.json()["data"]["payment"]
    assert (payment["method"], payment.get("reference")) == (CASH, None)
    assert mine(buyer, order)["payment"]["status"] == "collected"


@pytest.mark.parametrize(
    "amount", [TOTAL_PAISA - 1, TOTAL_PAISA + 1, 1, 0, -TOTAL_PAISA, 100.5, "2250", True, None]
)
def test_a_wrong_amount_is_never_recorded(auth_env: AuthEnv, amount: object) -> None:
    admin, _, order = shop(auth_env)
    detail = at(admin, order, "confirmed")

    status, code, details = refused(
        auth_env,
        admin,
        order,
        "record-payment",
        payment_body(detail["revision"], amountPaisa=amount),
    )

    assert (status, code) == (422, "validation_error")
    assert {field for field, _ in details} == {"amountPaisa"}


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"method": CASH}, ("method", "cash_at_delivery")),
        ({"moneyVerified": False}, ("moneyVerified", "verification_required")),
        ({"reference": "ab1"}, ("reference", "invalid_reference")),
        ({"reference": "paid, trust me!"}, ("reference", "invalid_reference")),
        ({"reference": "4111 1111 1111 1111"}, ("reference", "looks_like_card_number")),
        ({"reference": "5500-0055-5555-5559"}, ("reference", "looks_like_card_number")),
        (
            {"reference": "PK36 SCBL 0000 0011 2345 6702"},
            ("reference", "looks_like_account_number"),
        ),
    ],
    ids=["cash", "unverified", "short", "free-text", "visa", "mastercard", "iban"],
)
def test_what_may_not_be_recorded(
    auth_env: AuthEnv,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    changes: dict[str, Any],
    expected: tuple[str, str],
) -> None:
    admin, _, order = shop(auth_env)
    detail = at(admin, order, "confirmed")
    before = everything(auth_env)

    answer = staff_post(admin, order, "record-payment", payment_body(detail["revision"], **changes))

    assert problem(answer) == (422, "validation_error", {expected})
    sent = str(changes.get("reference", ""))
    if len(sent) > 8:  # what looked like a number is never echoed
        assert sent not in answer.text and rules.normalize_reference(sent) not in answer.text
        captured = capsys.readouterr()
        logged = caplog.text + captured.out + captured.err
        assert "record-payment" in logged  # the request WAS logged, so this is not vacuous
        assert sent not in logged and rules.normalize_reference(sent) not in logged
    assert everything(auth_env) == before


def test_a_customers_word_records_nothing(auth_env: AuthEnv) -> None:
    """There is no route by which a customer can mark anything paid."""
    admin, buyer, order = shop(auth_env)
    detail = at(admin, order, "confirmed")
    before = everything(auth_env)

    claims = [
        staff_post(buyer, order, "record-payment", payment_body(detail["revision"])),
        buyer.request("POST", f"{ORDERS}/{order}/payment", json=payment_body()),
        buyer.request("PATCH", f"{ORDERS}/{order}", json={"paymentStatus": "paid"}),
    ]

    assert [c.status_code for c in claims] == [403, 404, 405]
    assert everything(auth_env) == before
    assert mine(buyer, order)["payment"]["status"] == "due"


def test_only_the_holding_grocery_moderator_or_a_super_admin_records_a_payment(
    auth_env: AuthEnv,
) -> None:
    admin, _, order = shop(auth_env)
    holder = grocery_moderator(auth_env, "holder")
    advance(holder, order, "confirmed")
    revision = staff_order(holder, order)["revision"]
    other = grocery_moderator(auth_env, "colleague")
    listing = customer(auth_env, "listing", moderator_scopes=[StaffScope.FOOD])

    assert refused(auth_env, other, order, "record-payment", payment_body(revision))[:2] == (
        409,
        "order_not_claimed",
    )
    assert refused(auth_env, listing, order, "record-payment", payment_body(revision))[:2] == (
        403,
        "forbidden",
    )
    assert refused(auth_env, auth_env.client(), order, "record-payment", payment_body(revision))[
        0
    ] in (401, 403)
    assert pay(holder, order)["paymentStatus"] == "paid"


def test_a_payment_is_recorded_once(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    at(admin, order, "preparing")
    paid = pay(admin, order)

    again = refused(
        auth_env,
        admin,
        order,
        "record-payment",
        payment_body(paid["revision"], method="card", reference="OTHER-0002"),
    )

    assert again[:2] == (409, "payment_recorded")
    assert "record_payment" not in paid["availableActions"]
    assert rows(auth_env, "grocery_payments") == 1


@pytest.mark.parametrize("method", ["bank_transfer", "easypaisa", "jazzcash"])
def test_one_online_transaction_cannot_pay_two_orders(auth_env: AuthEnv, method: str) -> None:
    admin, _, order = shop(auth_env)
    at(admin, order, "confirmed")
    pay(admin, order, method=method, reference="TID 55-66 77")
    other = submitted(customer(auth_env, "other"))["id"]
    detail = at(admin, other, "confirmed")

    reused = refused(
        auth_env,
        admin,
        other,
        "record-payment",
        payment_body(detail["revision"], method=method, reference="tid556677"),
    )

    assert reused[2] == {("reference", "reference_in_use")}


def test_card_slip_numbers_and_other_methods_may_repeat(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    at(admin, order, "confirmed")
    pay(admin, order, method="card", reference="004411")
    other = submitted(customer(auth_env, "other"))["id"]
    at(admin, other, "confirmed")

    assert pay(admin, other, method="card", reference="004411")["paymentStatus"] == "paid"


@pytest.mark.parametrize("status", ["submitted", "delivered", "cancelled"])
def test_a_payment_needs_an_agreed_open_order(auth_env: AuthEnv, status: str) -> None:
    admin, _, order = shop(auth_env)
    detail = at(admin, order, status)

    answer = refused(auth_env, admin, order, "record-payment", payment_body(detail["revision"]))

    assert answer[:2] == (409, "invalid_state_transition")


# == a paid order ====================================================================================


def test_a_paid_orders_amount_and_existence_cannot_be_changed(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    at(admin, order, "confirmed")
    paid = pay(admin, order)
    revision = paid["revision"]
    attempts = {
        "reconfirm": reagreement(revision),
        "reduce-amount": {"revision": revision, "finalAmountPaisa": 100, "reason": "Short"},
        "cancel": {"revision": revision, "reason": "No longer wanted"},
    }

    for action, body in attempts.items():
        assert refused(auth_env, admin, order, action, body)[:2] == (409, "payment_recorded")
    assert not {"reconfirm", "reduce_amount", "cancel"} & set(paid["availableActions"])
    assert "record_refund" in paid["availableActions"]


def test_a_failed_delivery_leaves_the_payment_as_it_was(auth_env: AuthEnv) -> None:
    admin, buyer, order = shop(auth_env)
    at(admin, order, "out_for_delivery")
    paid = pay(admin, order)

    failed = staff_post(
        admin, order, "delivery-failed", {"revision": paid["revision"], "reason": "Not home"}
    )

    data = failed.json()["data"]
    assert (data["status"], data["paymentStatus"], data.get("refund")) == (
        "preparing",
        "paid",
        None,
    )
    assert mine(buyer, order)["payment"]["status"] == "collected"
    assert rows(auth_env, "grocery_refunds") == 0


# == the Super Admin's refund record =================================================================


def paid_order(env: AuthEnv, status: str = "confirmed") -> tuple[AuthApi, AuthApi, str, int]:
    admin, buyer, order = shop(env)
    at(admin, order, "confirmed" if status == "confirmed" else "preparing")
    pay(admin, order)
    detail = staff_order(admin, order)
    if status in ("out_for_delivery", "delivered"):
        response = staff_post(admin, order, "dispatch", {"revision": detail["revision"]})
        detail = response.json()["data"]
    if status == "delivered":
        response = staff_post(admin, order, "complete", {"revision": detail["revision"]})
        detail = response.json()["data"]
    assert detail["status"] == status, detail
    return admin, buyer, order, detail["revision"]


@pytest.mark.parametrize("status", ["confirmed", "preparing"])
def test_refunding_an_undelivered_order_cancels_it_in_the_same_change(
    auth_env: AuthEnv, status: str
) -> None:
    admin, buyer, order, revision = paid_order(auth_env, status)
    taken = places(auth_env.session)

    done = staff_post(admin, order, "refund", refund_body(revision))

    assert done.status_code == 200, done.text
    data = done.json()["data"]
    assert (data["status"], data["paymentStatus"], data["paymentCollected"]) == (
        "cancelled",
        "refunded",
        False,
    )
    assert data["payment"]["amountCollectedPaisa"] == TOTAL_PAISA  # the record stays
    refund = data["refund"]
    assert (refund["amountPaisa"], refund["method"], refund["reference"]) == (
        TOTAL_PAISA,
        "bank_transfer",
        "RF202611280001",
    )
    assert refund["reason"] == "The order could not be supplied"
    assert refund["refundedBy"]["displayName"] and refund["refundedAt"]
    assert data["history"][-1]["toStatus"] == "cancelled"
    issues = [e for e in data["events"] if e.get("issueKind") == "cancelled_after_procurement"]
    assert len(issues) == (1 if status == "preparing" else 0)
    assert (rows(auth_env, "grocery_payments"), rows(auth_env, "grocery_refunds")) == (1, 1)
    assert places(auth_env.session) == taken  # a cancelled order keeps its day's place

    seen = mine(buyer, order)
    assert (seen["status"], seen["paymentStatus"], seen["cancelledBy"]) == (
        "cancelled",
        "refunded",
        "staff",
    )
    assert seen["payment"]["status"] == "refunded"
    assert seen["payment"]["refundedAmountPaisa"] == TOTAL_PAISA
    raw = buyer.get(f"{ORDERS}/{order}").text
    for internal in ("could not be supplied", "RF202611280001", "TID202611280001"):
        assert internal not in raw


def test_refunding_a_delivered_order_keeps_it_delivered(auth_env: AuthEnv) -> None:
    admin, buyer, order, revision = paid_order(auth_env, "delivered")

    done = staff_post(admin, order, "refund", refund_body(revision, method="cash", reference=None))

    assert done.status_code == 200, done.text
    data = done.json()["data"]
    assert (data["status"], data["paymentStatus"]) == ("delivered", "refunded")
    assert data["refund"].get("reference") is None
    assert mine(buyer, order)["payment"]["status"] == "refunded"
    again = refused(auth_env, admin, order, "refund", refund_body(data["revision"]))
    assert again == (409, "invalid_state_transition", {("payment", "already_refunded")})


def test_only_a_super_admin_records_a_refund(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    holder = grocery_moderator(auth_env, "holder")
    advance(holder, order, "confirmed")
    pay(holder, order)
    revision = staff_order(holder, order)["revision"]

    answer = refused(auth_env, holder, order, "refund", refund_body(revision))

    assert answer == (403, "forbidden", {("order", "super_admin_required")})
    assert "record_refund" not in staff_order(holder, order)["availableActions"]
    assert "record_refund" in staff_order(admin, order)["availableActions"]


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"amountPaisa": TOTAL_PAISA - 1}, ("amountPaisa", "amount_mismatch")),
        ({"amountPaisa": TOTAL_PAISA + 1}, ("amountPaisa", "amount_mismatch")),
        ({"moneyReturned": False}, ("moneyReturned", "return_required")),
        ({"reference": None}, ("reference", "reference_required")),
        ({"reference": "4111111111111111"}, ("reference", "looks_like_card_number")),
        ({"reason": "   "}, ("reason", "string_too_short")),
        ({"method": "cash_on_delivery"}, ("method", "enum")),
        (
            {"procurementAcknowledged": False},
            ("procurementAcknowledged", "acknowledgement_required"),
        ),
    ],
    ids=["partial", "excess", "not-returned", "no-reference", "card-number", "no-reason",
         "bad-method", "no-acknowledgement"],
)  # fmt: skip
def test_what_may_not_be_recorded_as_a_refund(
    auth_env: AuthEnv, changes: dict[str, Any], expected: tuple[str, str]
) -> None:
    admin, _, order, revision = paid_order(auth_env, "preparing")

    status, code, details = refused(
        auth_env, admin, order, "refund", refund_body(revision, **changes)
    )

    assert (status, code) == (422, "validation_error")
    assert expected in details


def test_nothing_unpaid_or_on_its_way_can_be_refunded(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    detail = at(admin, order, "confirmed")
    unpaid = refused(auth_env, admin, order, "refund", refund_body(detail["revision"]))
    assert unpaid == (409, "invalid_state_transition", {("payment", "no_payment")})

    paid = pay(admin, order)
    for action in ("start-preparing", "dispatch"):
        paid = staff_post(admin, order, action, {"revision": paid["revision"]}).json()["data"]
    on_the_way = refused(auth_env, admin, order, "refund", refund_body(paid["revision"]))

    assert on_the_way[:2] == (409, "invalid_state_transition")


# == the database's own guards =======================================================================


def sql(env: AuthEnv, statement: str) -> None:
    """Run one statement as a careless script would, in its own savepoint."""
    nested = env.session.begin_nested()
    try:
        env.session.execute(text(statement))
        nested.commit()
    except DBAPIError:
        nested.rollback()
        raise


REFUND_ROW = (
    "INSERT INTO grocery_refunds (id, order_id, payment_id, amount_paisa, method, reference, "
    "reason, refunded_by, refunded_at) SELECT gen_random_uuid(), p.order_id, p.id, "
    "p.amount_collected_paisa {delta}, 'cash', NULL, 'why', p.collected_by, now() "
    "FROM grocery_payments p"
)


def test_the_database_keeps_a_paid_order_honest_whatever_writes(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)
    at(admin, order, "confirmed")
    pay(admin, order)
    broken = {
        "grocery_paid_amount_fixed": "UPDATE grocery_orders SET final_due_paisa = 100",
        "grocery_paid_cancel_needs_refund": (
            "UPDATE grocery_orders SET status = 'cancelled', cancelled_at = now()"
        ),
        "fk_grocery_refunds_whole_payment": REFUND_ROW.format(delta="- 1"),
        "uq_grocery_payments_order_id": (
            "INSERT INTO grocery_payments (id, order_id, method, amount_due_paisa, "
            "amount_collected_paisa, reference, collected_by, collected_at) "
            "SELECT gen_random_uuid(), order_id, 'card', amount_due_paisa, "
            "amount_collected_paisa, 'SECOND1', collected_by, now() FROM grocery_payments"
        ),
        "append-only": "UPDATE grocery_payments SET method = 'card'",
    }
    for guard, statement in broken.items():
        with pytest.raises(DBAPIError, match=guard):
            sql(auth_env, statement)

    sql(auth_env, REFUND_ROW.format(delta=""))
    for statement in ("UPDATE grocery_refunds SET reason = 'x'", "DELETE FROM grocery_refunds"):
        with pytest.raises(DBAPIError, match="append-only"):
            sql(auth_env, statement)


def test_the_database_refuses_a_payment_or_delivery_that_does_not_add_up(
    auth_env: AuthEnv,
) -> None:
    admin, _, order = shop(auth_env)
    payment = (
        "INSERT INTO grocery_payments (id, order_id, method, amount_due_paisa, "
        "amount_collected_paisa, reference, collected_by, collected_at) SELECT "
        "gen_random_uuid(), id, 'card', {amount}, {amount}, 'DIRECT1', customer_id, now() "
        "FROM grocery_orders"
    )
    with pytest.raises(DBAPIError, match="grocery_payment_matches_order"):
        sql(auth_env, payment.format(amount=TOTAL_PAISA))  # nothing agreed yet
    at(admin, order, "out_for_delivery")
    with pytest.raises(DBAPIError, match="grocery_payment_matches_order"):
        sql(auth_env, payment.format(amount=TOTAL_PAISA - 1))  # not what is due
    with pytest.raises(DBAPIError, match="grocery_delivery_needs_payment"):
        sql(auth_env, "UPDATE grocery_orders SET status = 'delivered', delivered_at = now()")


# == all of B-17 =====================================================================================


def coverage(env: AuthEnv, admin: AuthApi) -> tuple[bool, bool]:
    public = env.client().get("/grocery/availability").json()["data"]
    return admin.get(SETTINGS).json()["data"]["coversAllB17"], public["coversAllB17"]


def test_full_coverage_is_off_until_a_super_admin_confirms_it(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env)
    assert coverage(auth_env, admin) == (False, False)

    assert configure(admin, coversAllB17=True)["coversAllB17"] is True

    assert coverage(auth_env, admin) == (True, True)


def test_full_coverage_cannot_be_confirmed_with_no_block(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env, serviceableBlocks=[], enabled=False)
    revision = admin.get(SETTINGS).json()["data"]["revision"]

    answer = admin.request("PATCH", SETTINGS, json={"revision": revision, "coversAllB17": True})

    assert problem(answer) == (422, "validation_error", {("coversAllB17", "needs_blocks")})


@pytest.mark.parametrize(
    "blocks",
    [[BLOCKS[0]], [*BLOCKS, "Test Block C"], ["Test Block A", "Test Block Z"], []],
    ids=["one removed", "one added", "one replaced", "all removed"],
)
def test_changing_the_blocks_clears_the_confirmation(auth_env: AuthEnv, blocks: list[str]) -> None:
    admin = open_for_orders(auth_env, coversAllB17=True)

    saved = configure(admin, serviceableBlocks=blocks)

    assert saved["coversAllB17"] is False
    assert coverage(auth_env, admin) == (False, False)


def test_the_confirmation_survives_what_does_not_change_the_list(auth_env: AuthEnv) -> None:
    admin = open_for_orders(auth_env, coversAllB17=True)

    respelt = configure(admin, serviceableBlocks=["test  block b", "TEST BLOCK A"])
    unrelated = configure(admin, dailyCapacity=25)

    assert (respelt["coversAllB17"], unrelated["coversAllB17"]) == (True, True)


def test_the_confirmation_may_be_made_again_in_the_change_of_the_blocks(
    auth_env: AuthEnv,
) -> None:
    admin = open_for_orders(auth_env, coversAllB17=True)

    saved = configure(admin, serviceableBlocks=[*BLOCKS, "Test Block C"], coversAllB17=True)

    assert saved["coversAllB17"] is True


def test_full_coverage_accepts_no_address_outside_the_list(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env, coversAllB17=True)
    buyer = customer(auth_env)
    body = order_body()
    body["delivery"]["block"] = "Somewhere Outside"

    answer = submit(buyer, body)

    assert problem(answer)[2] == {("delivery.block", "not_serviceable")}
    assert outcome(submit(buyer)) == (201, None)


def test_the_database_will_not_hold_full_coverage_over_no_blocks(auth_env: AuthEnv) -> None:
    open_for_orders(auth_env)
    with pytest.raises(DBAPIError, match="full_coverage_needs_blocks"):
        sql(
            auth_env,
            "INSERT INTO grocery_settings_revisions (revision, enabled, serviceable_blocks, "
            "operating_days, opens_at, closes_at, timezone, daily_capacity, "
            "max_active_orders_per_customer, max_items_per_order, actor_user_id, covers_all_b17) "
            "SELECT revision + 100, false, '{}', operating_days, opens_at, closes_at, timezone, "
            "daily_capacity, max_active_orders_per_customer, max_items_per_order, "
            "gen_random_uuid(), true FROM grocery_settings_revisions LIMIT 1",
        )


def test_the_queue_names_each_orders_money(auth_env: AuthEnv) -> None:
    admin, _, order = shop(auth_env)

    def listed() -> tuple[str | None, bool]:
        row = admin.get(STAFF_ORDERS).json()["data"][0]
        return row.get("paymentStatus"), row["paymentCollected"]

    assert listed() == (None, False)  # nothing agreed yet
    at(admin, order, "confirmed")
    assert listed() == ("unpaid", False)
    pay(admin, order)
    assert listed() == ("paid", True)
    revision = staff_order(admin, order)["revision"]
    assert staff_post(admin, order, "refund", refund_body(revision)).status_code == 200
    assert listed() == ("refunded", False)
