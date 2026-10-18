"""The pure rules of a listing write (no database, no HTTP): normalisation, per-kind completeness,
location requiredness, PATCH semantics, and the change class that decides moderation
(docs/backend/API_CONTRACT.md §10.3, LOCATION_MAP.md §4-§7)."""

from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest
from pydantic import TypeAdapter

from app.models.enums import BusinessVertical, ListingKind, LocationVisibility
from app.schemas.write import ListingCreate, ListingPatch
from app.services.listing_state import (
    Change,
    FoodState,
    ListingState,
    LocationState,
    MenuItemState,
    apply_patch,
    canonical_locality,
    canonical_service_options,
    classify_change,
    clean_text,
    is_pure_narrowing,
    is_valid_media_reference,
    normalize_tags,
    quantize_coordinate,
    state_from_create,
    validate_location,
    validate_state,
)
from tests.write_payloads import (
    approximate,
    area_only,
    business_body,
    exact,
    food_body,
    property_body,
    provider_body,
    tutor_body,
)

LOCALITIES = ["B-17"]
CREATE = TypeAdapter(ListingCreate)


def state(body: dict[str, Any]) -> ListingState:
    built, problems = state_from_create(CREATE.validate_python(body), LOCALITIES)
    assert built is not None and not problems, problems
    return built


def patched(old: ListingState, **fields: Any) -> tuple[ListingState, list[tuple[str, str]]]:
    revision = fields.pop("revision", 1)
    new, problems = apply_patch(
        old, ListingPatch.model_validate({"revision": revision, **fields}), LOCALITIES
    )
    return new, [(p.field, p.code) for p in problems]


def issues(listing: ListingState) -> list[tuple[str, str]]:
    return [(p.field, p.code) for p in validate_state(listing)]


# -- normalisation ----------------------------------------------------------------------------


def test_text_and_tags_are_normalised() -> None:
    assert clean_text("  a ") == "a"
    assert clean_text("   ") is None and clean_text(None) is None
    assert normalize_tags([" Wiring ", "WIRING", "", "repairs", "wiring "]) == ("wiring", "repairs")


def test_service_options_are_a_set_in_canonical_order() -> None:
    from app.models.enums import FoodServiceOption as O

    assert canonical_service_options([O.DELIVERY, O.DINE_IN, O.DELIVERY]) == ("dine-in", "delivery")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("B-17", "B-17"), ("b-17", "B-17"), ("  B-17 ", "B-17"), ("B 17", None), ("B-170", None)],
)
def test_area_is_matched_trimmed_and_case_insensitively(raw: str, expected: str | None) -> None:
    assert canonical_locality(raw, LOCALITIES) == expected


def test_a_configured_locality_keeps_its_spelling() -> None:
    assert canonical_locality("g-13", ["B-17", "G-13"]) == "G-13"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (33.1234565, "33.123456"),  # half-even on the 7th decimal
        (33.1234575, "33.123458"),
        (-72.0000004, "-72.000000"),
        (90, "90.000000"),
        (0.1 + 0.2, "0.300000"),
    ],
)
def test_coordinates_round_half_even_to_six_places(value: float, expected: str) -> None:
    assert quantize_coordinate(value) == Decimal(expected)


@pytest.mark.parametrize(
    "reference",
    ["https://cdn.example.org/a.jpg", "https://example.org/a?b=1", "/assets/menu.png", "/a/b.webp"],
)
def test_public_media_references_are_accepted(reference: str) -> None:
    assert is_valid_media_reference(reference)


@pytest.mark.parametrize(
    "reference",
    [
        "",
        "blob:https://example.org/3f1c",
        "data:image/png;base64,AAAA",
        "http://example.org/a.jpg",
        "javascript:alert(1)",
        "//evil.example.org/a.jpg",
        "https://user:secret@example.org/a.jpg",
        "https://",
        "https://example.org/a b",
        "/a/../etc/passwd",
        "/a\\b",
        "file:///etc/passwd",
        "assets/relative.png",
        "https://example.org/\x00",
    ],
)
def test_anything_else_is_not_a_media_reference(reference: str) -> None:
    assert not is_valid_media_reference(reference)


# -- building a state from a create body --------------------------------------------------------


def test_every_kind_builds_a_complete_valid_state() -> None:
    for body in (provider_body(), business_body(), food_body(), tutor_body(), property_body()):
        built = state(body)
        assert issues(built) == [], body["kind"]


def test_create_normalises_and_canonicalises() -> None:
    built = state(
        provider_body(
            name="  Bright Spark  ",
            area=" b-17 ",
            tags=[" Wiring", "wiring", ""],
            image="  /assets/a.png ",
        )
    )

    assert built.title == "Bright Spark"
    assert built.area == "B-17"
    assert built.tags == ("wiring",)
    assert built.image == "/assets/a.png"


def test_blank_optional_text_becomes_absent() -> None:
    built = state(business_body(location=exact(landmark="   ", block="")))

    assert built.location.landmark is None and built.location.block is None


def test_an_unknown_locality_is_reported_on_area() -> None:
    built, problems = state_from_create(
        CREATE.validate_python(provider_body(area="F-8")), LOCALITIES
    )

    assert built is not None
    assert [(p.field, p.code) for p in problems] == [("area", "unknown_locality")]


def test_a_food_business_derives_its_categories_from_the_food_block() -> None:
    built = state(food_body())

    assert built.category is None and built.vertical is BusinessVertical.FOOD
    assert built.category_slugs() == ("bakeries", "cafes")
    assert built.food is not None and built.food.service_options == ("takeaway", "delivery")
    assert built.food.menu[0] == MenuItemState("Fudge Cake", "Cakes", None, "PKR 1,800")


# -- location requiredness (LOCATION_MAP §6) -----------------------------------------------------


def test_provider_and_tutor_default_to_area_only_without_a_location() -> None:
    assert state(provider_body()).location == LocationState(visibility=LocationVisibility.AREA_ONLY)
    assert state(tutor_body()).location.visibility is LocationVisibility.AREA_ONLY
    assert state(provider_body(location={"block": "C"})).location.visibility is (
        LocationVisibility.AREA_ONLY
    )


@pytest.mark.parametrize("make", [business_body, food_body, property_body])
def test_business_food_and_property_must_choose_a_location(make: Any) -> None:
    body = make()
    del body["location"]
    _, problems = state_from_create(CREATE.validate_python(body), LOCALITIES)

    assert [(p.field, p.code) for p in problems] == [("location", "required")]

    body["location"] = {"block": "B"}
    _, problems = state_from_create(CREATE.validate_python(body), LOCALITIES)
    assert [(p.field, p.code) for p in problems] == [("location.visibility", "required")]


def test_a_property_always_needs_a_point_and_never_area_only() -> None:
    assert issues(state(property_body(location=area_only()))) == [
        ("location.visibility", "not_allowed")
    ]
    assert issues(state(property_body(location=approximate(latitude=None, longitude=None)))) == [
        ("location.latitude", "required"),
        ("location.longitude", "required"),
    ]


@pytest.mark.parametrize(
    "make", [business_body, food_body, property_body, provider_body, tutor_body]
)
def test_an_exact_location_needs_an_address_for_every_kind(make: Any) -> None:
    body = make(location=exact(address=None))

    assert issues(state(body)) == [("location.address", "required")]


@pytest.mark.parametrize("make", [business_body, food_body, provider_body, tutor_body])
def test_area_only_stores_no_point_and_is_allowed_for_non_property_kinds(make: Any) -> None:
    assert issues(state(make(location=area_only()))) == []
    assert issues(state(make(location=area_only(latitude=33.1, longitude=72.1)))) == [
        ("location.latitude", "not_allowed")
    ]


def test_approximate_keeps_a_point_and_an_optional_private_address() -> None:
    assert issues(state(business_body(location=approximate(address=None, landmark=None)))) == []
    assert issues(state(provider_body(location=approximate()))) == []
    assert issues(state(tutor_body(location=approximate(latitude=None, longitude=None)))) == [
        ("location.latitude", "required"),
        ("location.longitude", "required"),
    ]


def test_only_one_of_latitude_and_longitude_is_incomplete() -> None:
    assert issues(state(business_body(location=exact(longitude=None)))) == [
        ("location.longitude", "required")
    ]


@pytest.mark.parametrize(
    ("latitude", "longitude", "bad"),
    [
        (90.0, 180.0, []),
        (-90.0, -180.0, []),
        (90.0000004, 179.9999996, []),  # rounds to the limit: still valid
        (90.1, 10.0, ["location.latitude"]),
        (10.0, -180.1, ["location.longitude"]),
        (123.0, 400.0, ["location.latitude", "location.longitude"]),
    ],
)
def test_coordinates_are_range_checked_after_rounding(
    latitude: float, longitude: float, bad: list[str]
) -> None:
    result = validate_location(
        ListingKind.BUSINESS,
        LocationState(
            visibility=LocationVisibility.EXACT,
            address="Shop 4",
            latitude=quantize_coordinate(latitude),
            longitude=quantize_coordinate(longitude),
        ),
    )

    assert [p.field for p in result] == bad


@pytest.mark.parametrize("block", ["C", "Block C", "12-B/3", "C.1", "Sector 4"])
def test_a_block_label_accepts_letters_digits_space_dash_slash_dot(block: str) -> None:
    assert issues(state(business_body(location=exact(block=block)))) == []


@pytest.mark.parametrize("block", ["<script>", "C;", "a\tb", "-C", "C#"])
def test_a_malicious_or_odd_block_is_rejected(block: str) -> None:
    from app.schemas.write import LocationInput

    try:
        loc = LocationInput.model_validate({"visibility": "exact", "block": block})
    except ValueError:
        return  # rejected already at the schema (control characters)
    location = LocationState(
        visibility=LocationVisibility.EXACT,
        block=loc.block,
        address="x",
        latitude=Decimal(1),
        longitude=Decimal(1),
    )
    assert [p.field for p in validate_location(ListingKind.BUSINESS, location)] == [
        "location.block"
    ]


# -- complete-state rules ---------------------------------------------------------------------------


def test_a_general_business_needs_a_category_and_never_food_data() -> None:
    general = state(business_body())

    assert issues(replace(general, category=None)) == [("category", "required")]
    assert issues(replace(general, food=FoodState(("bakeries",), ("takeaway",)))) == [
        ("food", "not_allowed")
    ]


def test_a_food_business_never_has_a_typed_category_and_needs_its_food_data() -> None:
    food = state(food_body())

    assert issues(replace(food, category="grocery")) == [("category", "not_allowed")]
    assert issues(replace(food, food=None)) == [("food", "required")]


def test_food_category_count_distinctness_and_service_options() -> None:
    food = state(food_body())
    inner = food.food
    assert inner is not None

    def with_food(**fields: Any) -> list[tuple[str, str]]:
        return issues(replace(food, food=replace(inner, **fields)))

    assert with_food(categories=()) == [("food.categories", "required")]
    assert with_food(categories=("bakeries", "cafes", "desi-food")) == []
    assert with_food(categories=("bakeries", "cafes", "desi-food", "bbq")) == [
        ("food.categories", "too_many")
    ]
    assert with_food(categories=("bakeries", "bakeries")) == [("food.categories", "duplicate")]
    assert with_food(service_options=()) == [("food.serviceOptions", "required")]
    assert with_food(menu=tuple(MenuItemState(f"Item {i}") for i in range(8))) == []
    assert with_food(menu=tuple(MenuItemState(f"Item {i}") for i in range(9))) == [
        ("food.menuHighlights", "too_many")
    ]
    assert with_food(menu_image="blob:https://x/1") == [
        ("food.menuImage", "invalid_media_reference")
    ]


def test_provider_tutor_property_completeness() -> None:
    assert issues(replace(state(provider_body()), category=None)) == [("category", "required")]
    assert issues(replace(state(tutor_body()), grade=None)) == [("grade", "required")]
    prop = state(property_body())
    assert issues(replace(prop, category=None)) == [("propertyType", "required")]
    assert issues(replace(prop, listing_type=None, price=None)) == [
        ("listingType", "required"),
        ("price", "required"),
    ]


def test_kind_specific_fields_do_not_leak_across_kinds() -> None:
    assert issues(replace(state(provider_body()), grade="x")) == []  # grade is simply unused
    assert issues(replace(state(provider_body()), price="PKR 1")) == [("price", "not_allowed")]
    assert issues(replace(state(tutor_body()), vertical=BusinessVertical.FOOD)) == [
        ("food", "not_allowed")
    ]


def test_an_image_must_be_a_public_reference() -> None:
    assert issues(replace(state(provider_body()), image="blob:https://x/1")) == [
        ("image", "invalid_media_reference")
    ]
    assert issues(replace(state(provider_body()), image="https://cdn.example.org/a.jpg")) == []


# -- PATCH semantics ----------------------------------------------------------------------------------


def test_an_empty_patch_changes_nothing() -> None:
    old = state(food_body())

    new, problems = patched(old)

    assert (new, problems) == (old, [])
    assert classify_change(old, new) is Change.NONE


def test_omitted_is_unchanged_and_a_value_replaces() -> None:
    old = state(provider_body())

    new, problems = patched(old, name="  New Name ", tags=["a", "A", "b"])

    assert problems == []
    assert (new.title, new.tags) == ("New Name", ("a", "b"))
    assert replace(new, title=old.title, tags=old.tags) == old


def test_only_declared_fields_clear_with_null() -> None:
    old = state(property_body())

    cleared, problems = patched(old, image=None, bedrooms=None, furnished=None)

    assert problems == []
    assert (cleared.image, cleared.bedrooms, cleared.furnished) == (None, None, None)


@pytest.mark.parametrize(
    ("kind_body", "field", "alias"),
    [
        (provider_body, "name", "name"),
        (provider_body, "description", "description"),
        (provider_body, "area", "area"),
        (provider_body, "tags", "tags"),
        (provider_body, "location", "location"),
        (provider_body, "category", "category"),
        (business_body, "vertical", "vertical"),
        (business_body, "food", "food"),
        (tutor_body, "grade", "grade"),
        (property_body, "title", "title"),
        (property_body, "listingType", "listingType"),
        (property_body, "propertyType", "propertyType"),
        (property_body, "price", "price"),
    ],
)
def test_null_on_a_non_clearable_field_is_not_nullable(
    kind_body: Any, field: str, alias: str
) -> None:
    old = state(kind_body())

    new, problems = patched(old, **{field: None})

    assert problems == [(alias, "not_nullable")]
    assert new == old


def test_a_field_the_kind_does_not_have_is_not_allowed() -> None:
    provider = state(provider_body())

    for field, value in (("title", "Xx"), ("grade", "9"), ("price", "PKR 1"), ("food", {})):
        _, problems = patched(provider, **{field: value})
        assert problems == [(field, "not_allowed")], field
    prop = state(property_body())
    _, problems = patched(prop, name="Xx", category="house")
    assert problems == [("category", "not_allowed"), ("name", "not_allowed")]


def test_area_is_canonicalised_when_supplied_and_rejected_when_unknown() -> None:
    old = state(provider_body())

    assert patched(old, area="b-17")[0] == old
    assert patched(old, area="F-8")[1] == [("area", "unknown_locality")]


def test_the_location_block_replaces_the_whole_stored_block() -> None:
    old = state(business_body(location=exact(landmark="Near the park")))

    new, _ = patched(
        old,
        location={
            "visibility": "exact",
            "address": "Shop 4, Main Market",
            "latitude": 33.123456,
            "longitude": 72.123456,
        },
    )

    assert new.location.landmark is None and new.location.block is None  # omitted sub-fields clear
    assert new.location.address == "Shop 4, Main Market"


def test_a_provider_location_without_visibility_takes_the_default() -> None:
    old = state(provider_body(location=approximate()))

    new, problems = patched(old, location={"block": "C"})

    assert problems == [] and new.location == LocationState(
        visibility=LocationVisibility.AREA_ONLY, block="C"
    )


def test_a_business_location_without_visibility_is_required() -> None:
    old = state(business_body())

    _, problems = patched(old, location={"block": "C"})

    assert problems == [("location.visibility", "required")]


def test_food_patch_is_partial_and_arrays_replace_whole() -> None:
    old = state(food_body())

    new, problems = patched(
        old,
        food={
            "hoursNote": None,
            "menuHighlights": [{"name": "Eclair"}],
            "categories": ["desi-food"],
        },
    )

    assert problems == []
    assert new.food is not None and old.food is not None
    assert new.food.hours_note is None
    assert new.food.menu == (MenuItemState("Eclair"),)
    assert new.food.categories == ("desi-food",)
    assert new.food.service_options == old.food.service_options  # omitted = unchanged
    assert new.food.menu_image == old.food.menu_image


def test_food_arrays_cannot_be_cleared_with_null() -> None:
    old = state(food_body())

    _, problems = patched(
        old, food={"categories": None, "serviceOptions": None, "menuHighlights": None}
    )

    assert problems == [
        ("food.categories", "not_nullable"),
        ("food.serviceOptions", "not_nullable"),
        ("food.menuHighlights", "not_nullable"),
    ]


def test_an_empty_menu_is_valid_but_empty_categories_are_not() -> None:
    old = state(food_body())

    new, _ = patched(old, food={"menuHighlights": []})
    assert issues(new) == []
    assert new.food is not None and new.food.menu == ()

    empty, _ = patched(old, food={"categories": []})
    assert issues(empty) == [("food.categories", "required")]


def test_switching_a_food_business_to_general_removes_the_food_data() -> None:
    old = state(food_body())

    new, problems = patched(old, vertical="general", category="grocery")

    assert problems == []
    assert (new.vertical, new.food, new.category) == (BusinessVertical.GENERAL, None, "grocery")
    assert issues(new) == []
    assert issues(patched(old, vertical="general")[0]) == [("category", "required")]


def test_switching_a_general_business_to_food_needs_its_food_data() -> None:
    old = state(business_body())

    bare, problems = patched(old, vertical="food")
    assert problems == [] and bare.category is None
    assert issues(bare) == [("food.categories", "required"), ("food.serviceOptions", "required")]

    full, _ = patched(
        old, vertical="food", food={"categories": ["bakeries"], "serviceOptions": ["takeaway"]}
    )
    assert issues(full) == []


def test_food_rules_on_a_patch_follow_the_resulting_vertical() -> None:
    food = state(food_body())
    general = state(business_body())

    assert patched(food, category="grocery")[1] == [("category", "not_allowed")]
    assert patched(general, food={"hoursNote": "x"})[1] == [("food", "not_allowed")]


# -- the change class (the moderation decision) ------------------------------------------------------


def narrowing_base() -> ListingState:
    return state(business_body(location=exact()))


def visibility(old: ListingState, mode: str, **location: Any) -> ListingState:
    new, problems = patched(old, location={**exact(visibility=mode), **location})
    assert problems == []
    return new


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        ("exact", "approximate", Change.NARROWING),
        ("exact", "area_only", Change.NARROWING),
        ("approximate", "area_only", Change.NARROWING),
        ("approximate", "exact", Change.MATERIAL),
        ("area_only", "approximate", Change.MATERIAL),
        ("area_only", "exact", Change.MATERIAL),
    ],
)
def test_only_the_three_privacy_narrowings_are_narrowings(
    start: str, end: str, expected: Change
) -> None:
    base = state(
        business_body(location=exact(visibility=start))
        if start != "area_only"
        else business_body(location=area_only(address="Shop 4, Main Market"))
    )
    location = (
        {"visibility": end}
        if end == "area_only"
        else {
            "visibility": end,
            "latitude": 33.123456,
            "longitude": 72.123456,
            "address": "Shop 4, Main Market",
        }
    )
    resend = {
        "block": base.location.block,
        "address": base.location.address,
        "landmark": base.location.landmark,
        **location,
    }
    new, problems = patched(base, location={k: v for k, v in resend.items() if v is not None})

    assert problems == []
    assert classify_change(base, new) is expected


def test_a_narrowing_keeps_the_stored_point_for_approximate_and_clears_it_for_area_only() -> None:
    base = narrowing_base()

    approx = visibility(base, "approximate", block="B", landmark="Opposite the mosque")
    only = replace(
        base,
        location=replace(
            base.location, visibility=LocationVisibility.AREA_ONLY, latitude=None, longitude=None
        ),
    )

    assert (approx.location.latitude, approx.location.longitude) == (
        base.location.latitude,
        base.location.longitude,
    )
    assert classify_change(base, approx) is Change.NARROWING
    assert classify_change(base, only) is Change.NARROWING


@pytest.mark.parametrize(
    ("label", "change"),
    [
        ("moved the pin by one unit of the 6th decimal", {"longitude": 72.123457}),
        ("changed the address", {"address": "Shop 5, Main Market"}),
        ("changed the landmark", {"landmark": "Opposite the school"}),
        ("changed the block", {"block": "C"}),
        ("cleared the address", {"address": None}),
        ("cleared the landmark", {"landmark": None}),
        ("cleared the block", {"block": None}),
    ],
)
def test_a_narrowing_combined_with_any_other_location_change_is_material(
    label: str, change: dict[str, Any]
) -> None:
    base = narrowing_base()
    location = exact(visibility="approximate", **change)
    new, _ = patched(base, location={k: v for k, v in location.items() if v is not None})

    assert classify_change(base, new) is Change.MATERIAL, label


@pytest.mark.parametrize(
    "fields",
    [
        {"name": "A different name"},
        {"description": "A completely rewritten description of the place."},
        {"tags": ["new"]},
        {"image": "/assets/new.png"},
        {"category": "pharmacy"},
        {"area": "B-17"},  # unchanged canonical spelling: NOT a change (checked separately)
    ],
)
def test_a_narrowing_plus_a_content_change_is_material(fields: dict[str, Any]) -> None:
    base = narrowing_base()
    new, _ = patched(base, location=approximate(), **fields)

    expected = Change.NARROWING if fields == {"area": "B-17"} else Change.MATERIAL
    assert classify_change(base, new) is expected


def test_food_and_subtype_changes_make_a_narrowing_material() -> None:
    food = state(food_body())
    food_edits: list[dict[str, Any]] = [
        {"food": {"hoursNote": "Mon-Fri"}},
        {"food": {"menuHighlights": [{"name": "Eclair"}]}},
        {"food": {"serviceOptions": ["takeaway"]}},
        {"food": {"categories": ["cafes", "bakeries"]}},  # reorder = primary changes
        {"food": {"menuImage": "/assets/m.png"}},
    ]
    for fields in food_edits:
        new, problems = patched(food, location=approximate(), **fields)
        assert problems == []
        assert classify_change(food, new) is Change.MATERIAL, fields
    prop = state(property_body())
    property_edits: list[dict[str, Any]] = [
        {"price": "PKR 2.3 Cr"},
        {"bedrooms": 4},
        {"furnished": "Furnished"},
        {"listingType": "rent"},
        {"propertyType": "flat"},
    ]
    for fields in property_edits:
        new, _ = patched(prop, location=approximate(), **fields)
        assert classify_change(prop, new) is Change.MATERIAL, fields


def test_whitespace_and_case_only_differences_are_no_ops() -> None:
    base = state(food_body())

    new, problems = patched(
        base,
        name="  Sweet Crumbs Bakery ",
        area=" b-17",
        tags=["CAKES", " bread "],
        location={**exact(block=" B ", address=" Shop 4, Main Market ")},
        food={"hoursNote": " Daily, 8 AM-10 PM "},
    )

    assert problems == []
    assert classify_change(base, new) is Change.NONE


def test_a_property_narrowing_is_exact_to_approximate_only() -> None:
    base = state(property_body())
    new, _ = patched(base, location=approximate())

    assert classify_change(base, new) is Change.NARROWING
    gone, _ = patched(base, location=area_only())
    assert issues(gone) == [
        ("location.visibility", "not_allowed")
    ]  # invalid result, not a narrowing


def test_is_pure_narrowing_is_directional() -> None:
    wide = narrowing_base()
    narrow = visibility(wide, "approximate", block="B", landmark="Opposite the mosque")

    assert is_pure_narrowing(wide, narrow)
    assert not is_pure_narrowing(narrow, wide)
    assert not is_pure_narrowing(wide, wide)
