"""Payments and refunds under REAL concurrency (GROCERY-4C): separate PostgreSQL connections over
COMMITTED rows.

Nothing here is a timing race. One request is PAUSED holding the lock under test and the other is
OBSERVED waiting for it in ``pg_stat_activity`` before the first goes on, so each test says which
one wins, and both orders are tested. Only tests like these say anything about the database.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import Engine

from app.repositories.grocery_staff import GroceryStaffRepository
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.grocery_helpers import (
    ALL_METHODS,
    SETTINGS,
    TOTAL_PAISA,
    advance,
    customer,
    open_for_orders,
    outcome,
    payment_body,
    places,
    purge_grocery,
    reagreement,
    refund_body,
    staff_order,
    staff_post,
    submitted,
)
from tests.db.test_grocery_concurrency import Running, all_waiting, gate_method
from tests.db.test_grocery_staff_concurrency import ORDER_ROW, count, status_of
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import scalar, wait_until, waiting_on_a_lock


@pytest.fixture
def world(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_grocery(db_engine), committed_world(db_engine) as env:
        yield env


def shop(env: AuthEnv) -> tuple[AuthApi, str]:
    admin = open_for_orders(env, paymentMethods=ALL_METHODS)
    return admin, submitted(customer(env))["id"]


def second_session(env: AuthEnv) -> AuthApi:
    other = env.client()
    assert other.login("grocery-admin@example.org").status_code == 200
    return other


def bring_to(admin: AuthApi, order: str, start: str, *, paid: bool) -> int:
    """The order at ``start``, with a verified payment if ``paid``; its revision."""
    detail = advance(admin, order, "confirmed" if start == "confirmed" else "preparing")
    if paid:
        answer = staff_post(admin, order, "record-payment", payment_body(detail["revision"]))
        assert answer.status_code == 200, answer.text
        detail = answer.json()["data"]
    if start == "out_for_delivery":
        detail = staff_post(admin, order, "dispatch", {"revision": detail["revision"]}).json()[
            "data"
        ]
    assert detail["status"] == start
    return int(detail["revision"])


@dataclass(frozen=True)
class Step:
    action: str
    #: ``(status, code)`` this one gets when the OTHER change had the order first.
    loses_with: tuple[int, str]
    body: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Pair:
    label: str
    start: str
    paid: bool
    one: Step
    other: Step


STALE = (409, "order_conflict")
GONE = (409, "invalid_state_transition")


def without_revision(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if key != "revision"}


def record(method: str = "bank_transfer", reference: str = "TID-RACE-1") -> Step:
    body = without_revision(payment_body(method=method, reference=reference))
    return Step("record-payment", STALE, body)


REFUND = Step("refund", GONE, without_revision(refund_body()))
CASH_DELIVERY = Step("complete", STALE, {"amountCollectedPaisa": TOTAL_PAISA})

PAIRS = (
    Pair("two payments at once", "confirmed", False, record(), record("card", "SLIP-2222")),
    Pair(
        "a payment vs a lower amount",
        "confirmed",
        False,
        record(),
        Step("reduce-amount", STALE, {"finalAmountPaisa": 100, "reason": "Short"}),
    ),
    Pair(
        "a payment vs a new agreement",
        "confirmed",
        False,
        record(),
        Step("reconfirm", STALE, without_revision(reagreement())),
    ),
    Pair(
        "a payment vs a cancellation",
        "confirmed",
        False,
        record(),
        # if the cancellation goes first the payment finds a finished order
        Step("cancel", STALE, {"reason": "Asked by phone"}),
    ),
    Pair(
        "a card payment vs a cash delivery",
        "out_for_delivery",
        False,
        record("card", "SLIP-3333"),
        CASH_DELIVERY,
    ),
    Pair("two refunds at once", "preparing", True, REFUND, REFUND),
    Pair("a refund vs dispatch", "preparing", True, REFUND, Step("dispatch", GONE)),
)


@pytest.mark.parametrize("reverse", [False, True], ids=["as listed", "reversed"])
@pytest.mark.parametrize("pair", PAIRS, ids=[p.label for p in PAIRS])
def test_two_money_changes_of_one_order_never_both_apply(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    pair: Pair,
    reverse: bool,
) -> None:
    admin, order = shop(world)
    revision = bring_to(admin, order, pair.start, paid=pair.paid)
    other_admin = second_session(world)
    winner, loser = (pair.other, pair.one) if reverse else (pair.one, pair.other)

    def send(step: Step, api: AuthApi) -> Response:
        return staff_post(api, order, step.action, {**step.body, "revision": revision})

    gate = gate_method(monkeypatch, GroceryStaffRepository, "order_for_staff", after=True)
    first = Running(lambda: send(winner, admin))
    gate.wait_arrived()  # it holds the order row
    second = Running(lambda: send(loser, other_admin))
    all_waiting(db_engine, ORDER_ROW, [second])
    gate.release.set()

    assert first.finish().status_code == 200
    lost = outcome(second.finish())
    expected = loser.loses_with
    # a change that left the order finished refuses by its state, whatever the loser is
    if status_of(db_engine) in ("cancelled", "delivered"):
        expected = GONE
    assert lost == expected, (winner.action, loser.action)

    payments = count(db_engine, "grocery_payments")
    refunds = count(db_engine, "grocery_refunds")
    assert payments <= 1 and refunds <= payments
    final = status_of(db_engine)
    # never delivered without a payment, never cancelled while money is held
    assert not (final == "delivered" and payments == 0)
    assert not (final == "cancelled" and payments > refunds)
    # a payment's amount is always what the order says is due
    assert count(db_engine, "grocery_orders o JOIN grocery_payments p ON p.order_id = o.id",
                 "p.amount_due_paisa <> o.final_due_paisa") == 0  # fmt: skip
    assert scalar(db_engine, "SELECT revision FROM grocery_orders") == revision + 1
    assert places(world.session) == 1


def test_one_online_transaction_claimed_for_two_orders_at_once_pays_only_one(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two different orders share no row lock: both pass the check, and the database's unique
    index decides. The loser gets the ordinary answer, not a server error."""
    admin, first_order = shop(world)
    second_order = submitted(customer(world, "other"))["id"]
    revisions = {
        order: advance(admin, order, "confirmed")["revision"]
        for order in (first_order, second_order)
    }
    other_admin = second_session(world)
    gate = gate_method(monkeypatch, GroceryStaffRepository, "reference_used", after=True)

    def claim(api: AuthApi, order: str) -> Response:
        return staff_post(api, order, "record-payment", payment_body(revisions[order]))

    paused = Running(lambda: claim(admin, first_order))
    gate.wait_arrived()  # it has found the reference unused, and not yet written
    winner = claim(other_admin, second_order)
    gate.release.set()
    loser = paused.finish()

    assert winner.status_code == 200, winner.text
    assert loser.status_code == 422, loser.text
    assert loser.json()["error"]["details"][0]["code"] == "reference_in_use"
    assert "TID" not in loser.text
    assert count(db_engine, "grocery_payments") == 1


def test_a_method_switched_off_during_a_payment_waits_for_it(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin, order = shop(world)
    revision = advance(admin, order, "confirmed")["revision"]
    switcher = second_session(world)
    version = admin.get(SETTINGS).json()["data"]["revision"]
    gate = gate_method(monkeypatch, GroceryStaffRepository, "current_settings", after=True)

    paying = Running(lambda: staff_post(admin, order, "record-payment", payment_body(revision)))
    gate.wait_arrived()  # it holds the settings lock, shared
    switching = Running(
        lambda: switcher.request(
            "PATCH", SETTINGS, json={"revision": version, "paymentMethods": ["cash_on_delivery"]}
        )
    )
    wait_until(
        lambda: waiting_on_a_lock(db_engine, "%pg_advisory_xact_lock(%"),
        "the settings change to wait for the payment",
    )
    assert switching.running
    gate.release.set()

    assert paying.finish().status_code == 200  # decided on the methods in force
    assert switching.finish().status_code == 200
    assert count(db_engine, "grocery_payments") == 1
    other = submitted(customer(world, "other"))["id"]
    detail = advance(admin, other, "confirmed")
    refusal = staff_post(
        admin, other, "record-payment", payment_body(detail["revision"], reference="TID-LATE-1")
    )
    assert refusal.status_code == 422
    assert staff_order(admin, other)["recordableMethods"] == []
