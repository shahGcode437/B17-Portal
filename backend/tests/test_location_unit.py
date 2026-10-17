"""Location foundation, no database (docs/backend/LOCATION_MAP.md §7–§9, §15).

The pure public serializer, the search-document location rules, the OpenAPI surface (no private
field, no writable generated column, no new route) and the fixture table's own consistency.
"""

from decimal import Decimal
from typing import Any

import pytest

from app.core.config import Settings
from app.factory import create_app
from app.models import Listing
from app.models.enums import ListingKind, LocationVisibility
from app.services.read_mappers import map_location
from app.services.search_document import build_search_document
from scripts.dev_fixtures import (
    DEMO_LOCATIONS,
    FIXTURE_LISTING_IDS,
    LEGACY_FIXTURE_IDS,
)

D = Decimal
EXACT = LocationVisibility.EXACT
APPROXIMATE = LocationVisibility.APPROXIMATE
AREA_ONLY = LocationVisibility.AREA_ONLY


def listing(
    visibility: LocationVisibility | None = AREA_ONLY,
    *,
    public: tuple[str, str] | None = None,
    address: str | None = None,
    landmark: str | None = None,
    block: str | None = "C",
    stored: tuple[str, str] | None = None,
) -> Listing:
    """An in-memory listing as a public query would hand it to the mapper."""
    result = Listing(
        kind=ListingKind.PROVIDER,
        title="Placeholder",
        area="B-17",
        description="d",
        tags=[],
        block=block,
        address=address,
        landmark=landmark,
        location_visibility=visibility,
        latitude=D(stored[0]) if stored else None,
        longitude=D(stored[1]) if stored else None,
    )
    if public:
        result.public_latitude, result.public_longitude = D(public[0]), D(public[1])
    result.public_address = address if visibility is EXACT else None
    result.public_landmark = landmark if visibility is EXACT else None
    return result


def dump(listing_: Listing, *, detail: bool) -> dict[str, Any]:
    return map_location(listing_, detail=detail).model_dump(by_alias=True, exclude_none=True)


# -- the pure public serializer -------------------------------------------------------------------------


def test_exact_detail_has_every_public_field() -> None:
    result = dump(
        listing(EXACT, public=("33.701234", "73.051234"), address="Shop 4", landmark="Near"),
        detail=True,
    )

    assert result == {
        "visibility": "exact",
        "block": "C",
        "address": "Shop 4",
        "landmark": "Near",
        "coordinates": {"latitude": 33.701234, "longitude": 73.051234, "precision": "exact"},
    }


def test_exact_card_omits_the_address_and_landmark() -> None:
    result = dump(
        listing(EXACT, public=("33.701234", "73.051234"), address="Shop 4", landmark="Near"),
        detail=False,
    )

    assert set(result) == {"visibility", "block", "coordinates"}


@pytest.mark.parametrize("detail", [True, False])
def test_approximate_never_carries_the_address_or_the_stored_point(detail: bool) -> None:
    result = dump(
        listing(
            APPROXIMATE,
            public=("33.70", "73.06"),
            address="Private home",
            landmark="Private landmark",
            stored=("33.704567", "73.055678"),
        ),
        detail=detail,
    )

    assert result == {
        "visibility": "approximate",
        "block": "C",
        "coordinates": {"latitude": 33.7, "longitude": 73.06, "precision": "approximate"},
    }
    flat = str(result)
    assert "Private" not in flat and "33.7045" not in flat and "73.0556" not in flat


@pytest.mark.parametrize("detail", [True, False])
def test_area_only_has_no_coordinates_even_if_a_public_point_were_present(detail: bool) -> None:
    """Defence in depth: the serializer itself refuses to emit a point for ``area_only``."""
    result = dump(
        listing(AREA_ONLY, public=("33.7", "73.05"), address="Private", block=None), detail=detail
    )

    assert result == {"visibility": "area_only"}


def test_a_legacy_row_serializes_as_bare_area_only() -> None:
    assert dump(listing(AREA_ONLY, block=None), detail=True) == {"visibility": "area_only"}


def test_a_listing_with_no_visibility_yet_is_treated_as_area_only_not_exact() -> None:
    result = map_location(listing(None, block=None, public=("33.7", "73.05")), detail=True)

    assert result.visibility is AREA_ONLY and result.coordinates is None


def test_coordinates_serialize_as_json_numbers() -> None:
    model = map_location(listing(EXACT, public=("33.700000", "73.050000")), detail=False)

    assert isinstance(model.coordinates and model.coordinates.latitude, float)
    assert model.model_dump_json(exclude_none=True, by_alias=True).count('"') > 0
    assert '"latitude":33.7' in model.model_dump_json(exclude_none=True, by_alias=True)


# -- the search document -------------------------------------------------------------------------------


def doc(visibility: LocationVisibility, **fields: Any) -> str:
    base = Listing(
        kind=ListingKind.PROVIDER,
        title="Plain",
        area="B-17",
        description="desc",
        tags=["t"],
        location_visibility=visibility,
        **fields,
    )
    return build_search_document(base)


def test_the_document_of_a_legacy_listing_is_unchanged() -> None:
    assert doc(AREA_ONLY) == "plain desc b-17 t"  # nothing new for a row without a block


def test_the_block_is_always_searchable_and_findable_as_block_x() -> None:
    for visibility in LocationVisibility:
        text = doc(visibility, block="C")
        assert " c " in f" {text} " and "block c" in text
    assert doc(AREA_ONLY, block="Block D").count("block d") == 1  # not duplicated


def test_address_and_landmark_enter_the_document_only_when_exact() -> None:
    fields = {"block": "C", "address": "Shop 4, Demo Plaza", "landmark": "Near the park"}

    exact = doc(EXACT, latitude=D("33.7"), longitude=D("73.05"), **fields)
    approximate = doc(APPROXIMATE, latitude=D("33.7"), longitude=D("73.05"), **fields)
    area_only = doc(AREA_ONLY, **fields)

    assert "shop 4, demo plaza" in exact and "near the park" in exact
    for private in (approximate, area_only):
        assert "shop 4" not in private and "near the park" not in private
        assert "block c" in private


def test_the_stored_point_never_appears_in_a_document() -> None:
    text = doc(EXACT, latitude=D("33.701234"), longitude=D("73.051234"), address="a")

    assert "33.70" not in text and "73.05" not in text


# -- the fixture table ----------------------------------------------------------------------------------


def test_every_demo_location_is_consistent_with_the_database_rules() -> None:
    for demo in DEMO_LOCATIONS.values():
        assert (demo.visibility is AREA_ONLY) == (demo.point is None)
        assert demo.area == "B-17" and demo.block
        if demo.point:
            lat, lng = demo.point
            assert D(-90) <= lat <= D(90) and D(-180) <= lng <= D(180)
            assert lat.as_tuple().exponent == -6 or lat == lat.quantize(D("0.000001"))


def test_the_fixtures_cover_all_three_modes_and_keep_legacy_rows() -> None:
    modes = {demo.visibility for demo in DEMO_LOCATIONS.values()}
    assert modes == {EXACT, APPROXIMATE, AREA_ONLY}
    assert set(DEMO_LOCATIONS) | set(LEGACY_FIXTURE_IDS) == set(FIXTURE_LISTING_IDS)
    assert not set(DEMO_LOCATIONS) & set(LEGACY_FIXTURE_IDS)
    assert len(LEGACY_FIXTURE_IDS) >= 2  # at least a General business and a Property stay legacy


# -- the OpenAPI surface (no new route, no private or writable location field) ---------------------------

#: Everything a client could send or receive about location, by schema name.
LOCATION_SCHEMAS = {"LocationRead", "CoordinatesRead"}


def openapi() -> dict[str, Any]:
    app = create_app(Settings(_env_file=None, environment="test", app_version="0.0.0-test"))
    schema: dict[str, Any] = app.openapi()
    return schema


def test_the_openapi_location_schemas_have_exactly_the_public_fields() -> None:
    schemas = openapi()["components"]["schemas"]

    assert set(schemas["LocationRead"]["properties"]) == {
        "visibility",
        "block",
        "address",
        "landmark",
        "coordinates",
    }
    assert set(schemas["CoordinatesRead"]["properties"]) == {"latitude", "longitude", "precision"}


def test_no_other_schema_exposes_a_location_field() -> None:
    schemas = openapi()["components"]["schemas"]
    forbidden = {
        "publicLatitude",
        "publicLongitude",
        "latitude",
        "longitude",
        "address",
        "landmark",
        "locationVisibility",
        "location_visibility",
        "public_latitude",
        "public_longitude",
        "publicAddress",
        "publicLandmark",
    }

    for name, schema in schemas.items():
        if name in LOCATION_SCHEMAS:
            continue
        leaked = forbidden & set(schema.get("properties", {}))
        assert not leaked, (name, leaked)


def test_phase_12b_adds_no_route_and_no_request_body_for_location() -> None:
    document = openapi()
    paths = document["paths"]

    assert not any(
        path.startswith(("/api/v1/admin", "/api/v1/saved", "/api/v1/requests")) for path in paths
    )
    assert set(paths["/api/v1/listings/{listing_id}"]) == {"get"}  # still read-only
    for path, methods in paths.items():
        for method, operation in methods.items():
            body = operation.get("requestBody")
            if body and path.startswith("/api/v1/listings"):
                pytest.fail(f"{method} {path} takes a body")


def test_openapi_describes_public_coordinates_as_plain_numbers_not_decimal_strings() -> None:
    schemas = openapi()["components"]["schemas"]
    properties = schemas["CoordinatesRead"]["properties"]

    for axis in ("latitude", "longitude"):
        assert properties[axis]["type"] == "number"  # a JSON number, no string/decimal union
        assert "anyOf" not in properties[axis] and "format" not in properties[axis]
    assert set(schemas["CoordinatesRead"]["required"]) == {"latitude", "longitude", "precision"}
    assert properties["precision"]["enum"] == ["exact", "approximate"]
