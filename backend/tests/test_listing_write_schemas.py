"""The request schemas: shape and type only, strict about everything undeclared
(docs/backend/API_CONTRACT.md §10.1) — and the LOCALITIES setting that feeds ``area`` validation."""

from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.config import Settings
from app.schemas.write import (
    ArchiveRequest,
    ListingCreate,
    ListingPatch,
    ProfessionalProfileRequest,
)
from tests.write_payloads import (
    ALL_BODIES,
    business_body,
    exact,
    food_body,
    property_body,
    provider_body,
)

CREATE = TypeAdapter(ListingCreate)

#: Everything a client must never be able to set (API_CONTRACT §10.1), plus the public coordinates.
SERVER_OWNED = [
    "id",
    "ownerId",
    "userId",
    "status",
    "revision",
    "featured",
    "isFeatured",
    "submittedAt",
    "createdAt",
    "updatedAt",
    "rejectionReason",
    "moderatedBy",
    "approvedAt",
    "rejectedAt",
    "history",
    "roles",
    "admin",
    "emailVerified",
    "planCode",
    "publicLatitude",
    "publicLongitude",
    "searchDocument",
]


def failures(error: ValidationError) -> list[tuple[str, str]]:
    return [(".".join(str(part) for part in e["loc"]), e["type"]) for e in error.errors()]


@pytest.mark.parametrize("name", list(ALL_BODIES))
@pytest.mark.parametrize("field", SERVER_OWNED)
@pytest.mark.parametrize("value", ["x", None])
def test_a_server_owned_field_is_not_allowed_on_create_whatever_its_value(
    name: str, field: str, value: Any
) -> None:
    body = ALL_BODIES[name]()
    body[field] = value

    with pytest.raises(ValidationError) as caught:
        CREATE.validate_python(body)

    kind = body["kind"]
    assert (f"{kind}.{field}", "not_allowed") in failures(caught.value)


def test_an_undeclared_nested_field_is_not_allowed() -> None:
    body = business_body(location=exact(publicLatitude=1.0, coordinates={"latitude": 1}))

    with pytest.raises(ValidationError) as caught:
        CREATE.validate_python(body)

    assert ("business.location.publicLatitude", "not_allowed") in failures(caught.value)
    assert ("business.location.coordinates", "not_allowed") in failures(caught.value)
    food = food_body()
    food["food"]["priceTotal"] = 1
    food["food"]["menuHighlights"][0]["orderable"] = True
    with pytest.raises(ValidationError) as caught:
        CREATE.validate_python(food)
    assert ("business.food.priceTotal", "not_allowed") in failures(caught.value)
    assert ("business.food.menuHighlights.0.orderable", "not_allowed") in failures(caught.value)


def test_only_camel_case_names_are_accepted() -> None:
    with pytest.raises(ValidationError) as caught:
        CREATE.validate_python(property_body() | {"listing_type": "sale"})

    assert ("property.listing_type", "not_allowed") in failures(caught.value)


@pytest.mark.parametrize("kind", [None, "service", "Business", "food", "", 3])
def test_the_kind_is_a_closed_set(kind: Any) -> None:
    with pytest.raises(ValidationError):
        CREATE.validate_python(provider_body(kind=kind))


def test_kind_is_not_accepted_on_patch_and_revision_is_required() -> None:
    with pytest.raises(ValidationError) as caught:
        ListingPatch.model_validate({"revision": 1, "kind": "business", "status": "approved"})
    assert ("kind", "not_allowed") in failures(caught.value)
    assert ("status", "not_allowed") in failures(caught.value)

    with pytest.raises(ValidationError) as caught:
        ListingPatch.model_validate({"name": "Bright Spark"})
    assert ("revision", "missing") in failures(caught.value)


@pytest.mark.parametrize("revision", [0, -1, 2_147_483_648, "1", 1.5, True, None])
def test_the_revision_token_is_a_positive_32_bit_integer(revision: Any) -> None:
    with pytest.raises(ValidationError):
        ListingPatch.model_validate({"revision": revision})
    with pytest.raises(ValidationError):
        ArchiveRequest.model_validate({"revision": revision})


def test_a_valid_revision_is_accepted() -> None:
    assert ListingPatch.model_validate({"revision": 7}).revision == 7
    assert ArchiveRequest.model_validate({"revision": 2_147_483_647}).revision == 2_147_483_647


@pytest.mark.parametrize("value", ["33.1", True, False, float("nan"), float("inf"), [1], {"v": 1}])
def test_coordinates_must_be_finite_json_numbers(value: Any) -> None:
    with pytest.raises(ValidationError):
        CREATE.validate_python(business_body(location=exact(latitude=value)))
    with pytest.raises(ValidationError):
        CREATE.validate_python(business_body(location=exact(longitude=value)))


def test_integer_and_float_coordinates_are_accepted() -> None:
    CREATE.validate_python(business_body(location=exact(latitude=33, longitude=72.5)))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "A"),
        ("name", "x" * 81),
        ("description", "too short"),
        ("description", "x" * 401),
        ("area", ""),
        ("area", "x" * 101),
        ("category", ""),
        ("category", "x" * 61),
        ("tags", ["t"] * 21),
        ("tags", ["x" * 41]),
        ("image", "x" * 2049),
        ("name", "Bright\x00Spark"),
        ("name", "Bright\nSpark"),
        ("description", "A description with a bell \x07 character in the middle."),
    ],
)
def test_lengths_and_control_characters_are_bounded(field: str, value: Any) -> None:
    with pytest.raises(ValidationError):
        CREATE.validate_python(provider_body(**{field: value}))


def test_a_description_may_contain_line_breaks() -> None:
    CREATE.validate_python(
        provider_body(description="First line of the description.\nSecond line.")
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "A"),
        ("title", "x" * 101),
        ("price", ""),
        ("price", "x" * 41),
        ("bedrooms", -1),
        ("bedrooms", 31),
        ("bedrooms", "3"),
        ("bedrooms", 2.5),
        ("furnished", "furnished"),
        ("listingType", "lease"),
    ],
)
def test_property_fields_are_bounded(field: str, value: Any) -> None:
    with pytest.raises(ValidationError):
        CREATE.validate_python(property_body(**{field: value}))


def test_food_limits_are_bounded_at_the_schema() -> None:
    too_long = food_body()
    too_long["food"]["hoursNote"] = "x" * 81
    with pytest.raises(ValidationError):
        CREATE.validate_python(too_long)

    bad_item = food_body()
    bad_item["food"]["menuHighlights"] = [{"name": "x" * 61}]
    with pytest.raises(ValidationError):
        CREATE.validate_python(bad_item)

    bad_option = food_body()
    bad_option["food"]["serviceOptions"] = ["takeaway", "drone-delivery"]
    with pytest.raises(ValidationError):
        CREATE.validate_python(bad_option)

    for field, value in (("section", "x" * 41), ("description", "x" * 121), ("price", "x" * 25)):
        item = food_body()
        item["food"]["menuHighlights"] = [{"name": "Cake", field: value}]
        with pytest.raises(ValidationError):
            CREATE.validate_python(item)


def test_the_professional_profile_body_has_no_fields() -> None:
    assert ProfessionalProfileRequest.model_validate({}) is not None
    for field in ("planCode", "plan", "userId", "roles", "admin", "verified"):
        with pytest.raises(ValidationError) as caught:
            ProfessionalProfileRequest.model_validate({field: "premium"})
        assert (field, "not_allowed") in failures(caught.value)


# -- the LOCALITIES setting -------------------------------------------------------------------------


def settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def test_localities_default_to_b_17() -> None:
    assert settings().localities == ["B-17"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("B-17", ["B-17"]),
        ("B-17, G-13 ,F-8", ["B-17", "G-13", "F-8"]),
        ('["B-17", "G-13"]', ["B-17", "G-13"]),
        ("b-17,B-17", ["b-17"]),  # case-insensitive duplicates: the first spelling wins
        ("  B-17   Sector ", ["B-17 Sector"]),
    ],
)
def test_localities_parse_from_the_environment(raw: str, expected: list[str]) -> None:
    assert settings(localities=raw).localities == expected


@pytest.mark.parametrize("raw", ["", " , ", "[]", "x" * 101, "B-17\x00"])
def test_a_bad_localities_value_fails_fast(raw: str) -> None:
    with pytest.raises((ValidationError, ValueError)):
        settings(localities=raw)


def test_localities_are_read_from_the_environment_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOCALITIES", "B-17,G-13")

    assert Settings(_env_file=None).localities == ["B-17", "G-13"]
