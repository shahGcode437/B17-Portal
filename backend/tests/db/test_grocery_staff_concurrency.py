"""GROCERY-2 under REAL concurrency: separate PostgreSQL connections over COMMITTED rows
(BACKEND_ARCHITECTURE.md §5.1, AUTH_RBAC.md §37).

Nothing here is a timing race. One request is PAUSED while it holds the lock under test, and the
other is OBSERVED waiting for that lock in ``pg_stat_activity`` before the first goes on — so each
test states which one wins, and both orders are tested.

Revocation of the acting SESSION against every staff change is in
``test_privileged_session_races.py``.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import Engine

from app.repositories.grocery import GroceryRepository
from app.repositories.grocery_staff import GroceryStaffRepository
from app.repositories.staff import StaffAuthorityRepository
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.grocery_helpers import (
    SETTINGS,
    TOTAL_PAISA,
    advance,
    agreement,
    cancel,
    customer,
    grocery_moderator,
    open_for_orders,
    outcome,
    places,
    purge_grocery,
    reagreement,
    staff_order,
    staff_post,
    submitted,
)
from tests.db.test_grocery_concurrency import (
    Running,
    all_waiting,
    codes,
    gate_method,
    row_locked,
    user_id,
)
from tests.db.test_grocery_staff_api import CHANGES, body_for, everything
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import (
    Revoker,
    scalar,
    wait_until,
    waiting_on_a_lock,
)

#: ``pg_stat_activity`` text of a statement waiting for the order row.
ORDER_ROW = "SELECT grocery_orders.%"
CUSTOMER_CANCEL = "customer-cancel"


@pytest.fixture
def world(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_grocery(db_engine), committed_world(db_engine) as env:
        yield env


def shop(env: AuthEnv) -> tuple[AuthApi, AuthApi, str]:
    admin = open_for_orders(env)
    buyer = customer(env)
    return admin, buyer, submitted(buyer)["id"]


def count(engine: Engine, table: str, where: str = "true") -> int:
    return int(scalar(engine, f"SELECT count(*) FROM {table} WHERE {where}"))  # noqa: S608


def status_of(engine: Engine) -> str:
    return str(scalar(engine, "SELECT status FROM grocery_orders"))


# -- two people take the same order -------------------------------------------------------------------


def test_two_moderators_claiming_at_once_get_exactly_one_holder(
    db_engine: Engine, world: AuthEnv
) -> None:
    _, _, order = shop(world)
    runners = [grocery_moderator(world, name) for name in ("first-runner", "second-runner")]

    with row_locked(db_engine, "SELECT 1 FROM grocery_orders FOR UPDATE"):
        running = [
            Running(lambda api=api: staff_post(api, order, "claim"))  # type: ignore[misc]
            for api in runners
        ]
        all_waiting(db_engine, ORDER_ROW, running)
    responses = [request.finish() for request in running]

    assert codes(responses) == [(200, None), (409, "order_already_claimed")]
    assert count(db_engine, "grocery_order_events", "action = 'claimed'") == 1
    assert count(db_engine, "grocery_orders", "assigned_to IS NOT NULL") == 1


# -- two changes of one order, in both orders ---------------------------------------------------------


@dataclass(frozen=True)
class Step:
    #: A staff action, or ``customer-cancel``.
    action: str
    #: What it answers when the OTHER change got the order first.
    loses_with: str
    body: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Pair:
    label: str
    start: str
    one: Step
    other: Step


def _complete() -> Step:
    return Step("complete", "invalid_state_transition", {"amountCollectedPaisa": TOTAL_PAISA})


PAIRS = (
    Pair(
        "customer cancels vs staff confirm",
        "submitted",
        Step(CUSTOMER_CANCEL, "invalid_state_transition"),
        Step("confirm", "invalid_state_transition", agreement()),
    ),
    Pair("two completions", "out_for_delivery", _complete(), _complete()),
    Pair(
        "completion vs a price reduction",
        "out_for_delivery",
        # the reduction leaves the status alone, so the completion is merely stale
        Step("complete", "order_conflict", {"amountCollectedPaisa": TOTAL_PAISA}),
        Step(
            "reduce-amount",
            "invalid_state_transition",
            {"finalAmountPaisa": TOTAL_PAISA - 100, "reason": "One item missing"},
        ),
    ),
    Pair(
        "a new agreement vs dispatch",
        "preparing",
        Step("reconfirm", "invalid_state_transition", reagreement()),
        Step("dispatch", "order_conflict"),
    ),
    Pair(
        "cancellation vs dispatch",
        "preparing",
        Step(
            "cancel",
            "invalid_state_transition",
            {"reason": "Shop closed", "procurementAcknowledged": True},
        ),
        Step("dispatch", "invalid_state_transition"),
    ),
    Pair(
        "a failed attempt vs completion",
        "out_for_delivery",
        Step("delivery-failed", "invalid_state_transition", {"reason": "Nobody home"}),
        _complete(),
    ),
)


@pytest.mark.parametrize("reverse", [False, True], ids=["as listed", "reversed"])
@pytest.mark.parametrize("pair", PAIRS, ids=[p.label for p in PAIRS])
def test_two_changes_of_one_order_never_both_apply(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    pair: Pair,
    reverse: bool,
) -> None:
    admin, buyer, order = shop(world)
    detail = advance(admin, order, pair.start) if pair.start != "submitted" else None
    revision = 1 if detail is None else detail["revision"]
    second_admin = world.client()
    assert second_admin.login("grocery-admin@example.org").status_code == 200
    winner, loser = (pair.other, pair.one) if reverse else (pair.one, pair.other)
    history = count(db_engine, "grocery_order_status_history")

    def send(step: Step, api: AuthApi) -> Response:
        if step.action == CUSTOMER_CANCEL:
            return cancel(buyer, order, revision)
        return staff_post(api, order, step.action, {**step.body, "revision": revision})

    # pause the winner right after it locked the order row
    if winner.action == CUSTOMER_CANCEL:
        gate = gate_method(monkeypatch, GroceryRepository, "own_order", after=True)
    else:
        gate = gate_method(monkeypatch, GroceryStaffRepository, "order_for_staff", after=True)
    first = Running(lambda: send(winner, admin))
    gate.wait_arrived()
    second = Running(lambda: send(loser, second_admin))
    all_waiting(db_engine, ORDER_ROW, [second])
    gate.release.set()

    assert first.finish().status_code == 200
    assert outcome(second.finish()) == (409, loser.loses_with)

    payments = count(db_engine, "grocery_payments")
    assert payments == (1 if winner.action == "complete" else 0)
    delivered = status_of(db_engine) == "delivered"
    assert delivered == (payments == 1)
    moved = winner.action not in ("reduce-amount", "reconfirm")
    assert count(db_engine, "grocery_order_status_history") == history + (1 if moved else 0)
    assert scalar(db_engine, "SELECT revision FROM grocery_orders") == revision + 1
    assert places(world.session) == 1  # the capacity place is never touched


# -- the value cap changes while a price is being agreed ----------------------------------------------


def change_cap(admin: AuthApi, paisa: int) -> Response:
    return admin.request("PATCH", SETTINGS, json={"revision": 2, "maxOrderValuePaisa": paisa})


def test_a_cap_change_waits_for_an_agreement_being_recorded(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin, _, order = shop(world)
    runner = grocery_moderator(world)
    advance(runner, order, "submitted")
    gate = gate_method(monkeypatch, GroceryRepository, "lock_settings_shared", after=True)
    confirming = Running(lambda: staff_post(runner, order, "confirm", agreement()))
    gate.wait_arrived()  # it holds the settings lock, shared

    changing = Running(lambda: change_cap(admin, TOTAL_PAISA - 1))
    all_waiting(db_engine, "SELECT pg_advisory_xact_lock(%", [changing])
    gate.release.set()

    assert confirming.finish().status_code == 200  # agreed under the cap it read
    assert changing.finish().status_code == 200
    assert status_of(db_engine) == "confirmed"


def test_an_agreement_waits_for_a_cap_change_in_flight_and_obeys_it(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin, _, order = shop(world)
    runner = grocery_moderator(world)
    advance(runner, order, "submitted")
    gate = gate_method(monkeypatch, GroceryRepository, "lock_settings_exclusive", after=True)
    changing = Running(lambda: change_cap(admin, TOTAL_PAISA - 1))
    gate.wait_arrived()  # it holds the settings lock, exclusive, and has not committed

    confirming = Running(lambda: staff_post(runner, order, "confirm", agreement()))
    all_waiting(db_engine, "SELECT pg_advisory_xact_lock_shared(%", [confirming])
    gate.release.set()

    assert changing.finish().status_code == 200
    response = confirming.finish()
    assert outcome(response) == (422, "validation_error")
    assert response.json()["error"]["details"][0]["code"] == "exceeds_order_limit"
    assert status_of(db_engine) == "submitted"
    assert count(db_engine, "grocery_order_confirmations") == 0


# -- the Grocery scope is taken away ------------------------------------------------------------------

#: The status each change needs.
NEEDS = {
    "claim": "submitted",
    "release": "submitted",
    "confirm": "submitted",
    "reconfirm": "confirmed",
    "reduce-amount": "confirmed",
    "start-preparing": "confirmed",
    "dispatch": "preparing",
    "delivery-failed": "out_for_delivery",
    "complete": "out_for_delivery",
    "cancel": "confirmed",
    "issues": "submitted",
}
DROP_SCOPE = (
    "DELETE FROM staff_scope_assignments WHERE scope = 'grocery' "
    "AND user_id = (SELECT id FROM users WHERE email = :e)"
)
RUNNER = "runner@example.org"


@pytest.mark.parametrize("action", CHANGES)
def test_a_scope_removed_after_authentication_stops_every_change(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    _, _, order = shop(world)
    runner = grocery_moderator(world)
    if action != "claim":
        advance(runner, order, NEEDS[action])
    revision = staff_order(runner, order)["revision"]
    before = everything(world)
    world.session.rollback()
    owner = user_id(db_engine, RUNNER)
    gate = gate_method(monkeypatch, StaffAuthorityRepository, "share_user", after=False)

    change = Running(lambda: staff_post(runner, order, action, body_for(action, revision)))
    gate.wait_arrived()  # past the route guard; no authority is locked yet
    Revoker(db_engine, [DROP_SCOPE], RUNNER).finish()
    gate.release.set()

    assert outcome(change.finish()) == (403, "forbidden")
    assert everything(world) == before
    assert count(db_engine, "staff_scope_assignments", f"user_id = '{owner}'") == 0


def test_removing_the_scope_waits_for_a_change_already_in_flight(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, _, order = shop(world)
    runner = grocery_moderator(world)
    advance(runner, order, "submitted")
    gate = gate_method(monkeypatch, StaffAuthorityRepository, "share_moderator_scope", after=True)
    change = Running(lambda: staff_post(runner, order, "confirm", agreement()))
    gate.wait_arrived()  # it holds the scope row, shared

    revoke = Revoker(db_engine, [DROP_SCOPE], RUNNER)
    wait_until(
        lambda: waiting_on_a_lock(db_engine, "DELETE FROM staff_scope_assignments%"),
        "the revoke to wait for the change",
    )
    assert not revoke.done.is_set()
    gate.release.set()

    assert change.finish().status_code == 200  # authorized by the row it held
    revoke.finish()
    assert status_of(db_engine) == "confirmed"
    after = staff_post(runner, order, "start-preparing", {"revision": 2})
    assert outcome(after) == (403, "forbidden")
    assert count(db_engine, "grocery_orders", "status = 'confirmed'") == 1
