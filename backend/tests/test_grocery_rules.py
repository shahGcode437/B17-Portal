"""GROCERY-1b, DB-free: the pure rules and the request schemas (API_CONTRACT.md §18)."""

import datetime
import re
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from app.models.enums import GroceryActorRole, GroceryOrderStatus, GroceryUnit
from app.schemas.grocery import GroceryOrderCreate, GrocerySettingsPatch
from app.services import grocery_rules as rules
from app.services.listing_state import _valid_block

UTC = datetime.UTC


def utc(
    year: int, month: int, day: int, hour: int, minute: int = 0, second: int = 0
) -> datetime.datetime:
    return datetime.datetime(year, month, day, hour, minute, second, tzinfo=UTC)


# -- lifecycle ------------------------------------------------------------------------------------


def test_these_are_the_only_transitions_that_exist() -> None:
    allowed = {
        (status.value, action.value, actor.value): rules.next_status(status, action, actor)
        for status in GroceryOrderStatus
        for action in rules.GroceryAction
        for actor in GroceryActorRole
        if rules.next_status(status, action, actor) is not None
    }

    assert {key: target.value for key, target in allowed.items() if target} == {
        ("submitted", "cancel", "customer"): "cancelled",
        ("submitted", "confirm", "staff"): "confirmed",
        ("confirmed", "start_preparing", "staff"): "preparing",
        ("preparing", "dispatch", "staff"): "out_for_delivery",
        ("out_for_delivery", "complete", "staff"): "delivered",
        ("out_for_delivery", "delivery_failed", "staff"): "preparing",
        ("submitted", "cancel", "staff"): "cancelled",
        ("confirmed", "cancel", "staff"): "cancelled",
        ("preparing", "cancel", "staff"): "cancelled",
    }


def test_delivered_and_cancelled_are_final_and_every_other_status_is_active() -> None:
    assert [status.value for status in GroceryOrderStatus] == [
        "submitted",
        "confirmed",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
    ]
    assert {s.value for s in rules.TERMINAL_STATUSES} == {"delivered", "cancelled"}
    assert set(GroceryOrderStatus) == rules.ACTIVE_STATUSES | rules.TERMINAL_STATUSES
    assert not rules.ACTIVE_STATUSES & rules.TERMINAL_STATUSES
    assert not {key for key in rules.TRANSITIONS if key[0] in rules.TERMINAL_STATUSES}
    # nothing leads into confirmed except recording the customer's agreement
    assert {key[1] for key, to in rules.TRANSITIONS.items() if to.value == "confirmed"} == {
        rules.GroceryAction.CONFIRM
    }


def test_the_statuses_for_changing_the_price_and_cancelling_late() -> None:
    assert {s.value for s in rules.RECONFIRM_STATUSES} == {"confirmed", "preparing"}
    assert {s.value for s in rules.REDUCE_STATUSES} == {
        "confirmed",
        "preparing",
        "out_for_delivery",
    }
    assert {s.value for s in rules.AFTER_PROCUREMENT} == {"preparing"}


def test_money_is_whole_paisa_and_the_pilot_cap_includes_the_fees() -> None:
    assert rules.order_total(185_000, 10_000, 15_000) == 210_000
    assert rules.order_total(1, 0, 0) == 1
    assert rules.DEFAULT_MAX_ORDER_VALUE_PAISA == 2_000_000  # PKR 20,000, fees included
    assert type(rules.order_total(1, 2, 3)) is int


# -- quantities -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "value"),
    [("1", "1"), ("0.05", "0.05"), ("1.500", "1.500"), ("999999.999", "999999.999")],
)
def test_a_plain_decimal_is_read_exactly(text: str, value: str) -> None:
    assert rules.parse_quantity(text) == Decimal(value)


@pytest.mark.parametrize(
    "text",
    [
        "0",
        "0.000",
        "-1",
        "+1",
        "1e3",
        "NaN",
        "nan",
        "Infinity",
        "inf",
        "1,5",
        " 1",
        "1 ",
        "1.",
        ".5",
        "1.0001",
        "01",
        "1000000",
        "",
        "abc",
        "1.5kg",
        "١",
        "1_000",
    ],
)
def test_anything_else_is_not_a_quantity(text: str) -> None:
    assert rules.parse_quantity(text) is None


def test_every_unit_has_a_rule() -> None:
    assert set(rules.UNIT_RULES) == set(GroceryUnit)
    assert {
        GroceryUnit.GRAM,
        GroceryUnit.ML,
        GroceryUnit.PIECE,
        GroceryUnit.PACK,
    } == rules.WHOLE_UNITS
    assert Decimal("5000") == rules.MAX_ANY_QUANTITY


#: (unit, minimum, maximum, step) — the documented table, literally.
BOUNDS = [
    (GroceryUnit.KG, "0.05", "50", "0.001"),
    (GroceryUnit.GRAM, "1", "5000", "1"),
    (GroceryUnit.LITRE, "0.1", "50", "0.001"),
    (GroceryUnit.ML, "1", "5000", "1"),
    (GroceryUnit.PIECE, "1", "100", "1"),
    (GroceryUnit.PACK, "1", "50", "1"),
    (GroceryUnit.DOZEN, "0.5", "20", "0.5"),
]


@pytest.mark.parametrize(
    ("unit", "minimum", "maximum", "step"), BOUNDS, ids=[b[0].value for b in BOUNDS]
)
def test_the_boundaries_of_each_unit(
    unit: GroceryUnit, minimum: str, maximum: str, step: str
) -> None:
    low, high, grain = Decimal(minimum), Decimal(maximum), Decimal(step)
    assert (rules.UNIT_RULES[unit].minimum, rules.UNIT_RULES[unit].maximum) == (low, high)
    assert rules.UNIT_RULES[unit].step == grain
    assert rules.quantity_problem(unit, low) is None
    assert rules.quantity_problem(unit, high) is None
    assert rules.quantity_problem(unit, low + grain) is None

    below = rules.quantity_problem(unit, low - Decimal("0.001"))
    above = rules.quantity_problem(unit, high + Decimal("0.001"))
    assert below is not None and below[0] == "quantity_too_small"
    assert above is not None and above[0] == "quantity_too_large"


@pytest.mark.parametrize(
    ("unit", "text"),
    [("gram", "1.5"), ("ml", "250.5"), ("piece", "2.5"), ("pack", "1.001"), ("dozen", "1.25")],
)
def test_a_quantity_off_the_units_step_is_too_precise(unit: str, text: str) -> None:
    problem = rules.quantity_problem(GroceryUnit(unit), Decimal(text))

    assert problem is not None and problem[0] == "quantity_precision"


@pytest.mark.parametrize(
    ("value", "text"),
    [("2.500", "2.5"), ("1.000", "1"), ("100", "100"), ("0.050", "0.05"), ("5000", "5000")],
)
def test_the_canonical_text_has_no_exponent_or_trailing_zero(value: str, text: str) -> None:
    assert rules.format_quantity(Decimal(value)) == text


# -- operating window and the Karachi calendar ------------------------------------------------------

WINDOW: dict[str, Any] = {
    "operating_days": [1, 2, 3, 4, 5, 6, 7],
    "opens_at": datetime.time(10, 0),
    "closes_at": datetime.time(20, 0),
    "timezone": "Asia/Karachi",
}


@pytest.mark.parametrize(
    ("moment", "expected"),
    [  # Karachi is UTC+5: 10:00 there is 05:00 UTC, 20:00 there is 15:00 UTC
        (utc(2026, 11, 27, 4, 59, 59), False),
        (utc(2026, 11, 27, 5, 0, 0), True),  # opening is INCLUDED
        (utc(2026, 11, 27, 12, 0), True),
        (utc(2026, 11, 27, 14, 59, 59), True),
        (utc(2026, 11, 27, 15, 0, 0), False),  # closing is EXCLUDED
        (utc(2026, 11, 27, 19, 30), False),  # 00:30 the next day in Karachi
    ],
)
def test_orders_are_accepted_from_opening_until_just_before_closing(
    moment: datetime.datetime, expected: bool
) -> None:
    assert rules.is_open(moment, **WINDOW) is expected


def test_the_moment_is_judged_in_karachi_whatever_zone_it_arrives_in() -> None:
    new_york = datetime.timezone(datetime.timedelta(hours=-5))
    moment = datetime.datetime(2026, 11, 27, 0, 0, tzinfo=new_york)  # 05:00 UTC, 10:00 Karachi

    assert rules.is_open(moment, **WINDOW) is True


def test_the_weekday_is_karachis() -> None:
    # 2026-11-27 is a Friday (ISO 5). 20:00 UTC that day is already Saturday 01:00 in Karachi.
    window = {**WINDOW, "opens_at": datetime.time(0, 0), "operating_days": [5]}

    assert rules.is_open(utc(2026, 11, 27, 12, 0), **window) is True
    assert rules.is_open(utc(2026, 11, 27, 20, 0), **window) is False


@pytest.mark.parametrize(
    ("moment", "day"),
    [
        (utc(2026, 11, 26, 18, 59, 59), datetime.date(2026, 11, 26)),
        (utc(2026, 11, 26, 19, 0, 0), datetime.date(2026, 11, 27)),  # midnight in Karachi
        (utc(2026, 12, 31, 19, 0), datetime.date(2027, 1, 1)),
    ],
)
def test_the_capacity_day_rolls_over_at_karachi_midnight(
    moment: datetime.datetime, day: datetime.date
) -> None:
    assert rules.service_date(moment, "Asia/Karachi") == day


def test_a_naive_time_is_refused_not_guessed() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        rules.service_date(datetime.datetime(2026, 11, 27, 12, 0), "Asia/Karachi")


# -- blocks, references, keys -----------------------------------------------------------------------


def test_a_block_matches_only_a_configured_one_and_keeps_its_configured_spelling() -> None:
    configured = ["Test Block A", "T/2"]

    assert rules.match_block("  test   BLOCK a ", configured) == "Test Block A"
    assert rules.match_block("t/2", configured) == "T/2"
    for unknown in ("A", "Block A", "Test Block", "Test Block AA", "Test Block B"):
        assert rules.match_block(unknown, configured) is None


def test_with_no_configured_block_nothing_is_serviceable() -> None:
    assert rules.match_block("Test Block A", []) is None


@pytest.mark.parametrize(
    "label", ["A", "Test Block A", "T/2", "1-B", "C.3", "", " A", "-A", "A!", "<b>", "A" * 41]
)
def test_a_block_label_follows_the_listing_block_rule(label: str) -> None:
    """One rule for what a block may be written as, in listings and in Grocery."""
    assert rules.is_block_label(label) is (0 < len(label) <= 40 and _valid_block(label))


def test_a_reference_is_random_and_avoids_look_alike_characters() -> None:
    references = {rules.new_reference() for _ in range(500)}

    assert len(references) == 500
    assert all(re.fullmatch(r"GRC-[2-9A-HJKMNP-Z]{8}", r) for r in references)
    assert not set("01ILO") & set(rules.REFERENCE_ALPHABET)


@pytest.mark.parametrize(
    ("key", "valid"),
    [
        ("a" * 8, True),
        ("a" * 128, True),
        ("3f2b9c1e-77aa-4e1d-9c3b-2d6f0a1b8e55", True),
        ("order:2026.11_27-1", True),
        ("a" * 7, False),
        ("a" * 129, False),
        ("has space 1", False),
        ("new\nline-key", False),
        ("ключ-ключ", False),
        ("", False),
    ],
)
def test_the_idempotency_key_format(key: str, valid: bool) -> None:
    assert rules.is_idempotency_key(key) is valid


# -- the request schema --------------------------------------------------------------------------------


def body(**changes: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "items": [{"name": "Basmati rice", "unit": "kg", "quantity": "5"}],
        "delivery": {
            "contactName": "Test Customer",
            "contactPhone": "0300 1234567",
            "block": "Test Block A",
            "addressLine": "House 1, Street 2",
        },
    }
    payload.update(changes)
    return payload


def parsed(**changes: Any) -> GroceryOrderCreate:
    return GroceryOrderCreate.model_validate(body(**changes))


def problems(payload: dict[str, Any], model: type = GroceryOrderCreate) -> set[tuple[str, str]]:
    with pytest.raises(ValidationError) as raised:
        model.model_validate(payload)  # type: ignore[attr-defined]
    return {
        (".".join(str(part) for part in error["loc"]), error["type"])
        for error in raised.value.errors()
    }


def digest(order: GroceryOrderCreate) -> bytes:
    return rules.payload_hash(order.canonical())


def test_the_same_order_written_differently_has_the_same_fingerprint() -> None:
    plain = parsed()
    spelled = parsed(
        items=[
            {
                "name": "  Basmati rice ",
                "unit": "kg",
                "quantity": "5.000",
                "substitution": "ask",
                "preferredBrand": "",
                "note": "  ",
            }
        ],
        delivery={
            "contactName": " Test Customer ",
            "contactPhone": "+92 300-123 4567",
            "block": "test   block a",
            "addressLine": "House 1, Street 2 ",
            "landmark": "",
        },
        instructions="   ",
    )

    assert digest(spelled) == digest(plain)
    assert spelled.delivery.contact_phone == "+923001234567"
    assert spelled.items[0].quantity == "5"


@pytest.mark.parametrize(
    "change",
    [
        {"items": [{"name": "Basmati rice", "unit": "kg", "quantity": "6"}]},
        {"items": [{"name": "Basmati rice", "unit": "gram", "quantity": "5"}]},
        {"items": [{"name": "Basmati Rice", "unit": "kg", "quantity": "5"}]},
        {
            "items": [
                {"name": "Basmati rice", "unit": "kg", "quantity": "5", "substitution": "none"}
            ]
        },
        {"instructions": "Ring twice."},
        {
            "delivery": {
                "contactName": "Test Customer",
                "contactPhone": "03001234568",
                "block": "Test Block A",
                "addressLine": "House 1, Street 2",
            }
        },
    ],
)
def test_any_real_difference_changes_the_fingerprint(change: dict[str, Any]) -> None:
    assert digest(parsed(**change)) != digest(parsed())


def test_the_order_of_the_lines_is_part_of_the_order() -> None:
    first = {"name": "Rice", "unit": "kg", "quantity": "1"}
    second = {"name": "Milk", "unit": "litre", "quantity": "1"}

    assert digest(parsed(items=[first, second])) != digest(parsed(items=[second, first]))


@pytest.mark.parametrize(
    ("changes", "field", "code"),
    [
        ({"items": []}, "items", "too_short"),
        ({"items": [{"name": "x", "unit": "kg", "quantity": "1"}] * 101}, "items", "too_long"),
        (
            {"items": [{"name": "  ", "unit": "kg", "quantity": "1"}]},
            "items.0.name",
            "string_too_short",
        ),
        (
            {"items": [{"name": "x" * 81, "unit": "kg", "quantity": "1"}]},
            "items.0.name",
            "string_too_long",
        ),
        (
            {"items": [{"name": "Rice\nmore", "unit": "kg", "quantity": "1"}]},
            "items.0.name",
            "invalid_characters",
        ),
        ({"items": [{"name": "Rice", "unit": "bag", "quantity": "1"}]}, "items.0.unit", "enum"),
        (
            {"items": [{"name": "Rice", "unit": "kg", "quantity": 1}]},
            "items.0.quantity",
            "string_type",
        ),
        (
            {"items": [{"name": "Rice", "unit": "kg", "quantity": 1.5}]},
            "items.0.quantity",
            "string_type",
        ),
        (
            {"items": [{"name": "Rice", "unit": "kg", "quantity": "NaN"}]},
            "items.0.quantity",
            "invalid_quantity",
        ),
        (
            {"items": [{"name": "Rice", "unit": "kg", "quantity": "51"}]},
            "items.0.quantity",
            "quantity_too_large",
        ),
        (
            {"items": [{"name": "Eggs", "unit": "piece", "quantity": "1.5"}]},
            "items.0.quantity",
            "quantity_precision",
        ),
        (
            {"items": [{"name": "Rice", "unit": "kg", "quantity": "1", "substitution": "maybe"}]},
            "items.0.substitution",
            "enum",
        ),
        (
            {
                "items": [
                    {"name": "Rice", "unit": "kg", "quantity": "1", "preferredBrand": "b" * 61}
                ]
            },
            "items.0.preferredBrand",
            "string_too_long",
        ),
        (
            {"items": [{"name": "Rice", "unit": "kg", "quantity": "1", "note": "n" * 201}]},
            "items.0.note",
            "string_too_long",
        ),
        ({"instructions": "i" * 501}, "instructions", "string_too_long"),
    ],
)
def test_invalid_lines_are_refused(changes: dict[str, Any], field: str, code: str) -> None:
    assert (field, code) in problems(body(**changes))


@pytest.mark.parametrize(
    ("key", "value", "code"),
    [
        ("contactName", "A", "string_too_short"),
        ("contactName", "n" * 81, "string_too_long"),
        ("contactPhone", "+447911123456", "invalid_phone"),  # valid E.164, not Pakistani
        ("contactPhone", "+1 415 555 0100", "invalid_phone"),
        ("contactPhone", "0300 12345", "invalid_phone"),
        ("contactPhone", "call me", "invalid_phone"),
        ("addressLine", "H 1 ", "string_too_short"),
        ("addressLine", "a" * 201, "string_too_long"),
        ("addressLine", "House 1\nStreet 2", "invalid_characters"),
        ("block", "", "string_too_short"),
        ("block", "Block <A>", "invalid_block"),
        ("landmark", "l" * 101, "string_too_long"),
    ],
)
def test_invalid_delivery_details_are_refused(key: str, value: str, code: str) -> None:
    delivery = {**body()["delivery"], key: value}

    assert (f"delivery.{key}", code) in problems(body(delivery=delivery))


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("03001234567", "+923001234567"),
        ("+92 300 1234567", "+923001234567"),
        ("0092 3001234567", "+923001234567"),
        ("051 1234567", "+92511234567"),
    ],
)
def test_a_pakistani_number_is_normalised_by_the_existing_helper(typed: str, stored: str) -> None:
    delivery = {**body()["delivery"], "contactPhone": typed}

    assert parsed(delivery=delivery).delivery.contact_phone == stored


@pytest.mark.parametrize(
    "field",
    [
        "customerId",
        "status",
        "reference",
        "id",
        "revision",
        "submittedAt",
        "cancelledAt",
        "serviceDate",
        "price",
        "total",
        "idempotencyKey",
        "area",
        "ownerId",
    ],
)
def test_a_client_cannot_set_a_server_owned_field(field: str) -> None:
    assert (field, "not_allowed") in problems(body(**{field: "x"}))


def test_undeclared_keys_are_refused_inside_items_and_delivery_too() -> None:
    item = {"name": "Rice", "unit": "kg", "quantity": "1", "price": "10"}
    delivery = {**body()["delivery"], "latitude": 33.6}

    assert ("items.0.price", "not_allowed") in problems(body(items=[item]))
    assert ("delivery.latitude", "not_allowed") in problems(body(delivery=delivery))


def test_a_validation_error_never_repeats_what_was_sent() -> None:
    delivery = {**body()["delivery"], "contactPhone": "SECRET-PHONE-99", "block": "SECRET<BLOCK>"}
    with pytest.raises(ValidationError) as raised:
        GroceryOrderCreate.model_validate(body(delivery=delivery, secretField="SECRET-VALUE"))

    messages = " ".join(error["msg"] for error in raised.value.errors())
    assert "SECRET" not in messages


# -- the settings patch -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("changes", "field", "code"),
    [
        ({"dailyCapacity": 0}, "dailyCapacity", "greater_than_equal"),
        ({"dailyCapacity": 201}, "dailyCapacity", "less_than_equal"),
        ({"dailyCapacity": "10"}, "dailyCapacity", "int_type"),
        ({"dailyCapacity": True}, "dailyCapacity", "int_type"),
        ({"maxActiveOrdersPerCustomer": 0}, "maxActiveOrdersPerCustomer", "greater_than_equal"),
        ({"maxActiveOrdersPerCustomer": 11}, "maxActiveOrdersPerCustomer", "less_than_equal"),
        ({"maxItemsPerOrder": 101}, "maxItemsPerOrder", "less_than_equal"),
        ({"enabled": "yes"}, "enabled", "bool_type"),
        ({"enabled": 1}, "enabled", "bool_type"),
        ({"enabled": None}, "enabled", "not_nullable"),
        ({"serviceableBlocks": None}, "serviceableBlocks", "not_nullable"),
        ({"serviceableBlocks": ["A<"]}, "serviceableBlocks", "invalid_block"),
        ({"serviceableBlocks": ["x" * 41]}, "serviceableBlocks", "invalid_block"),
        ({"serviceableBlocks": ["Test A", "test  a"]}, "serviceableBlocks", "duplicate_block"),
        ({"serviceableBlocks": [f"T{n}" for n in range(101)]}, "serviceableBlocks", "too_long"),
        ({"operatingDays": []}, "operatingDays", "too_short"),
        ({"operatingDays": [0]}, "operatingDays", "invalid_days"),
        ({"operatingDays": [1, 1]}, "operatingDays", "invalid_days"),
        ({"operatingDays": [8]}, "operatingDays", "invalid_days"),
        ({"opensAt": "9:00"}, "opensAt", "invalid_time"),
        ({"closesAt": "24:00"}, "closesAt", "invalid_time"),
        ({"timezone": "UTC"}, "timezone", "unsupported_timezone"),
        ({"updatedBy": "me"}, "updatedBy", "not_allowed"),
    ],
)
def test_unsafe_settings_are_refused(changes: dict[str, Any], field: str, code: str) -> None:
    assert (field, code) in problems({"revision": 1, **changes}, GrocerySettingsPatch)


def test_settings_input_is_normalised() -> None:
    patch = GrocerySettingsPatch.model_validate(
        {"revision": 1, "serviceableBlocks": ["  Test   A "], "operatingDays": [7, 1, 3]}
    )

    assert patch.serviceable_blocks == ["Test A"]
    assert patch.operating_days == [1, 3, 7]
    assert patch.model_fields_set == {"revision", "serviceable_blocks", "operating_days"}


def test_the_revision_is_required() -> None:
    assert ("revision", "missing") in problems({"enabled": True}, GrocerySettingsPatch)
