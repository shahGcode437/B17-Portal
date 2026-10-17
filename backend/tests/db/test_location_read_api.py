"""Location privacy on every public read surface (docs/backend/LOCATION_MAP.md §7, §9, §16).

Real PostgreSQL, the real app, the deterministic fixtures. For each visibility mode the same
assertions run against the search CARD, the listing DETAIL, the stored SEARCH DOCUMENT and the
SUGGESTIONS, with explicit checks that forbidden keys and values are ABSENT (not merely null).
"""

import json
import re
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Listing
from app.models.enums import LocationVisibility
from app.services.search_index import SearchIndexer
from scripts.dev_fixtures import (
    ARCHIVED_TUTOR_ID,
    BAKERS_ID,
    BIRYANI_ID,
    CAFE_ID,
    ELECTRIC_ID,
    FLAT_ID,
    HOUSE_ID,
    MATH_TUTOR_ID,
    PENDING_FOOD_ID,
    PHARMACY_ID,
    REJECTED_BUSINESS_ID,
    SALON_ID,
    SOLAR_ID,
    TUTOR_ID,
)

SEARCH = "/api/v1/search"
SUGGESTIONS = "/api/v1/search/suggestions"
LISTING = "/api/v1/listings"

#: Text stored privately by the fixtures for non-exact (or hidden) listings.
PRIVATE_TEXT = (
    "Private Cafe Address",
    "Private cafe landmark",
    "Private Home Address",
    "Private home landmark",
    "Private Lane Address",
    "Private lane landmark",
    "Private Workshop Address",
    "Hidden Shop Address",
    "Hidden Food Address",
)
#: The stored (exact) points of the APPROXIMATE fixtures, in every plausible spelling.
PRIVATE_POINTS = ("33.706789", "73.058765", "33.704567", "73.055678")
PUBLIC_FIELDS_OF_A_LOCATION = {"visibility", "block", "address", "landmark", "coordinates"}


def get(client: TestClient, url: str, **params: Any) -> dict[str, Any]:
    response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def detail(client: TestClient, listing_id: Any) -> dict[str, Any]:
    item: dict[str, Any] = get(client, f"{LISTING}/{listing_id}")["data"]
    return item


def card(client: TestClient, title: str) -> dict[str, Any]:
    hits = get(client, SEARCH, q=title, limit=50)["data"]
    (found,) = [
        hit["item"]
        for hit in hits
        if title in (hit["item"].get("name") or hit["item"].get("title"))
    ]
    result: dict[str, Any] = found
    return result


def document(session: Session, listing_id: Any) -> str:
    stored = session.execute(
        text("SELECT search_document FROM listings WHERE id = :id"), {"id": listing_id}
    ).scalar_one()
    return str(stored)


# -- EXACT: map-ready, the address is public ----------------------------------------------------------


def test_exact_detail_exposes_the_point_address_and_landmark(read_client: TestClient) -> None:
    item = detail(read_client, BAKERS_ID)

    assert item["area"] == "B-17"
    assert item["location"] == {
        "visibility": "exact",
        "block": "C",
        "address": "Shop 4, Demo Plaza",
        "landmark": "Next to the demo park",
        "coordinates": {"latitude": 33.701234, "longitude": 73.051234, "precision": "exact"},
    }


def test_exact_card_has_the_point_but_not_the_address(read_client: TestClient) -> None:
    item = card(read_client, "Capital Bakers")

    assert item["location"] == {
        "visibility": "exact",
        "block": "C",
        "coordinates": {"latitude": 33.701234, "longitude": 73.051234, "precision": "exact"},
    }
    assert "address" not in item["location"] and "landmark" not in item["location"]


@pytest.mark.parametrize("listing_id", [BIRYANI_ID, HOUSE_ID, SALON_ID])
def test_every_exact_listing_is_map_ready(read_client: TestClient, listing_id: Any) -> None:
    location = detail(read_client, listing_id)["location"]

    assert location["visibility"] == "exact"
    assert set(location["coordinates"]) == {"latitude", "longitude", "precision"}
    assert location["coordinates"]["precision"] == "exact"
    assert isinstance(location["coordinates"]["latitude"], float)  # a JSON number, not a string
    assert location["address"]


# -- APPROXIMATE: only the rounded point ---------------------------------------------------------------


def test_approximate_detail_has_only_the_two_decimal_point(read_client: TestClient) -> None:
    item = detail(read_client, CAFE_ID)

    assert item["location"] == {
        "visibility": "approximate",
        "block": "C",
        "coordinates": {"latitude": 33.71, "longitude": 73.06, "precision": "approximate"},
    }
    assert "address" not in item["location"] and "landmark" not in item["location"]


def test_approximate_card_has_only_the_two_decimal_point(read_client: TestClient) -> None:
    item = card(read_client, "Sara M.")

    assert item["location"] == {
        "visibility": "approximate",
        "block": "C",
        "coordinates": {"latitude": 33.7, "longitude": 73.06, "precision": "approximate"},
    }


# -- AREA_ONLY: no point, no private text --------------------------------------------------------------


@pytest.mark.parametrize("listing_id", [MATH_TUTOR_ID, ELECTRIC_ID])
def test_area_only_detail_has_no_coordinates_and_no_private_text(
    read_client: TestClient, listing_id: Any
) -> None:
    location = detail(read_client, listing_id)["location"]

    assert location["visibility"] == "area_only"
    assert set(location) == {"visibility", "block"}  # no key at all, not even null


def test_area_only_card_has_no_coordinates(read_client: TestClient) -> None:
    assert card(read_client, "Ali R.")["location"] == {"visibility": "area_only", "block": "D"}


# -- LEGACY rows (pre-0005 state) ----------------------------------------------------------------------


@pytest.mark.parametrize("listing_id", [SOLAR_ID, PHARMACY_ID, FLAT_ID])
def test_legacy_rows_are_area_level_only_and_keep_their_old_area_text(
    read_client: TestClient, listing_id: Any
) -> None:
    item = detail(read_client, listing_id)

    assert item["location"] == {"visibility": "area_only"}  # no block, no point, no address
    assert item["area"].startswith("B-17, Block")  # the legacy free text, untouched


def test_a_legacy_property_without_a_point_is_readable_everywhere(read_client: TestClient) -> None:
    hits = get(read_client, SEARCH, type="property", limit=50)["data"]

    flat = [h["item"] for h in hits if h["item"]["title"].startswith("2 Bed Flat")]
    assert flat and flat[0]["location"] == {"visibility": "area_only"}


# -- nothing private leaks anywhere in any public response --------------------------------------------


def test_no_public_response_contains_private_text_or_a_private_point(
    read_client: TestClient,
) -> None:
    responses = [read_client.get(SEARCH, params={"limit": 50}).text]
    for listing_id in (
        BAKERS_ID,
        BIRYANI_ID,
        CAFE_ID,
        TUTOR_ID,
        MATH_TUTOR_ID,
        ELECTRIC_ID,
        HOUSE_ID,
        SALON_ID,
        SOLAR_ID,
        PHARMACY_ID,
        FLAT_ID,
    ):
        responses.append(read_client.get(f"{LISTING}/{listing_id}").text)
    for query in ("private", "address", "lane", "cafe", "hidden", "demo plaza"):
        responses.append(read_client.get(SEARCH, params={"q": query}).text)
        responses.append(read_client.get(SUGGESTIONS, params={"q": query}).text)

    for body in responses:
        for secret in (*PRIVATE_TEXT, *PRIVATE_POINTS):
            assert secret not in body, secret
        for forbidden_key in ('"publicLatitude"', '"latitude": null', '"address": null'):
            assert forbidden_key not in body


def test_every_location_in_the_search_page_has_only_the_public_fields(
    read_client: TestClient,
) -> None:
    hits = get(read_client, SEARCH, limit=50)["data"]

    for hit in hits:
        if hit["kind"] == "news":
            continue
        location = hit["item"]["location"]
        assert set(location) <= PUBLIC_FIELDS_OF_A_LOCATION
        assert "address" not in location and "landmark" not in location  # cards are lightweight
        assert "coordinates" not in location or location["visibility"] != "area_only"


@pytest.mark.parametrize("listing_id", [REJECTED_BUSINESS_ID, PENDING_FOOD_ID, ARCHIVED_TUTOR_ID])
def test_a_located_but_hidden_listing_is_still_a_plain_404(
    read_client: TestClient, listing_id: Any
) -> None:
    response = read_client.get(f"{LISTING}/{listing_id}")

    assert response.status_code == 404
    assert "Hidden" not in response.text and "33.7" not in response.text


# -- the stored search document -------------------------------------------------------------------------


def test_the_document_of_an_exact_listing_has_the_public_address_and_block(
    fixtures_session: Session,
) -> None:
    doc = document(fixtures_session, BAKERS_ID)

    assert "shop 4, demo plaza" in doc and "next to the demo park" in doc
    assert " c " in f" {doc} " and "block c" in doc


@pytest.mark.parametrize("listing_id", [CAFE_ID, TUTOR_ID, MATH_TUTOR_ID, ELECTRIC_ID])
def test_the_document_of_a_non_exact_listing_has_no_private_address_or_landmark(
    fixtures_session: Session, listing_id: Any
) -> None:
    doc = document(fixtures_session, listing_id)

    for secret in PRIVATE_TEXT:
        assert secret.lower() not in doc
    assert "block" in doc  # the block is public in every mode


def test_no_document_contains_a_coordinate(fixtures_session: Session) -> None:
    documents = fixtures_session.scalars(text("SELECT search_document FROM listings")).all()

    for doc in documents:
        for point in (*PRIVATE_POINTS, "33.701234", "73.051234", "33.71", "73.06"):
            assert point not in doc


def test_an_exact_address_is_searchable_a_private_one_is_not(read_client: TestClient) -> None:
    def names(q: str) -> set[str]:
        return {
            h["item"].get("name") or h["item"]["title"]
            for h in get(read_client, SEARCH, q=q)["data"]
        }

    assert names("demo plaza") == {"Capital Bakers"}  # exact: its public address
    assert names("private cafe") == set() and names("private lane") == set()
    assert "Mocha Corner Cafe" in names("block c")  # the block is public even when approximate
    assert names("hidden") == set()


def test_suggestions_never_draw_on_location_text(read_client: TestClient) -> None:
    for q in ("shop 4", "demo plaza", "private", "next to the demo", "lane"):
        assert get(read_client, SUGGESTIONS, q=q)["data"] == [], q


# -- visibility changes rebuild the document (no trigger, the indexer owns it) ---------------------------


def test_narrowing_visibility_removes_the_address_from_the_document_on_refresh(
    fixtures_session: Session,
) -> None:
    listing = fixtures_session.get(Listing, BAKERS_ID)
    assert listing is not None
    assert "shop 4, demo plaza" in document(fixtures_session, BAKERS_ID)

    listing.location_visibility = LocationVisibility.APPROXIMATE
    fixtures_session.flush()
    indexer = SearchIndexer(fixtures_session)
    assert BAKERS_ID in indexer.find_stale()  # the old document was built under `exact`

    indexer.refresh(listing)

    doc = document(fixtures_session, BAKERS_ID)
    assert "shop 4" not in doc and "next to the demo park" not in doc and "block c" in doc
    assert indexer.find_stale() == []


def test_widening_visibility_adds_the_address_back_on_refresh(fixtures_session: Session) -> None:
    listing = fixtures_session.get(Listing, CAFE_ID)
    assert listing is not None
    assert "private cafe address" not in document(fixtures_session, CAFE_ID)

    listing.location_visibility = LocationVisibility.EXACT
    fixtures_session.flush()
    SearchIndexer(fixtures_session).refresh(listing)

    assert "private cafe address" in document(fixtures_session, CAFE_ID)


# -- the response contract ----------------------------------------------------------------------------------


def test_the_location_serialization_uses_camel_case_numbers_and_omits_nulls(
    read_client: TestClient,
) -> None:
    text_body = read_client.get(f"{LISTING}/{BAKERS_ID}").text
    location = json.loads(text_body)["data"]["location"]

    assert list(location) == ["visibility", "block", "address", "landmark", "coordinates"]
    assert all(value is not None for value in location.values())
    assert "location_visibility" not in text_body and "public_latitude" not in text_body


def test_location_adds_no_queries_to_a_search_page(
    read_client: TestClient, fixtures_session: Session
) -> None:
    from tests.db.test_read_performance_and_indexes import count_statements

    with count_statements(fixtures_session) as one:
        get(read_client, SEARCH, type="business", limit=1)
    fixtures_session.expunge_all()
    with count_statements(fixtures_session) as many:
        get(read_client, SEARCH, type="business", limit=50)

    assert len(many) == len(one)  # a fixed number of statements however many cards are shown


# -- the fixture loader (explicit, idempotent, never the migration) -------------------------------------------


def test_the_fixture_loader_reapplies_demo_locations_idempotently_and_keeps_legacy_rows(
    fixtures_session: Session,
) -> None:
    from scripts.dev_fixtures import DEMO_LOCATIONS, load_dev_fixtures

    # an already-seeded, pre-0005-style fixture row ...
    fixtures_session.execute(
        text(
            "UPDATE listings SET area = 'B-17, Block C (Demo Area)', block = NULL, "
            "address = NULL, landmark = NULL, latitude = NULL, longitude = NULL, "
            "location_visibility = 'area_only' WHERE id = :id"
        ),
        {"id": BAKERS_ID},
    )
    fixtures_session.expire_all()

    first = load_dev_fixtures(fixtures_session)
    second = load_dev_fixtures(fixtures_session)

    assert first.locations == second.locations == len(DEMO_LOCATIONS)
    row = fixtures_session.execute(
        text(
            "SELECT area, block, address, location_visibility, public_latitude, public_longitude "
            "FROM listings WHERE id = :id"
        ),
        {"id": BAKERS_ID},
    ).one()
    assert tuple(row) == (
        "B-17",
        "C",
        "Shop 4, Demo Plaza",
        "exact",
        Decimal("33.701234"),
        Decimal("73.051234"),
    )
    legacy = fixtures_session.execute(
        text("SELECT area, location_visibility FROM listings WHERE id = :id"), {"id": PHARMACY_ID}
    ).one()
    assert tuple(legacy) == ("B-17, Block C (Demo Area)", "area_only")  # never modernised
    assert SearchIndexer(fixtures_session).find_stale() == []


# -- the wire format of coordinates: JSON numbers, never strings --------------------------------------------


def raw_coordinates(body: bytes) -> list[tuple[bytes, bytes]]:
    """Every ``"latitude"`` / ``"longitude"`` value as it appears in the raw response BYTES."""
    pattern = rb'"latitude":\s*([^,}\s]+)\s*,\s*"longitude":\s*([^,}\s]+)'
    return re.findall(pattern, body)


def is_json_number(token: bytes) -> bool:
    return re.fullmatch(rb"-?\d+(\.\d+)?", token) is not None  # no quotes, no wrapper


def test_exact_coordinates_are_json_numbers_in_the_raw_detail_bytes(
    read_client: TestClient,
) -> None:
    response = read_client.get(f"{LISTING}/{BAKERS_ID}")

    pairs = raw_coordinates(response.content)
    assert pairs == [(b"33.701234", b"73.051234")]
    assert all(is_json_number(lat) and is_json_number(lng) for lat, lng in pairs)
    coordinates = response.json()["data"]["location"]["coordinates"]
    assert type(coordinates["latitude"]) is float and type(coordinates["longitude"]) is float
    assert b'"latitude":"' not in response.content and b'"longitude":"' not in response.content


def test_approximate_coordinates_are_json_numbers_in_the_raw_detail_bytes(
    read_client: TestClient,
) -> None:
    response = read_client.get(f"{LISTING}/{CAFE_ID}")

    assert raw_coordinates(response.content) == [(b"33.71", b"73.06")]
    coordinates = response.json()["data"]["location"]["coordinates"]
    assert type(coordinates["latitude"]) is float and type(coordinates["longitude"]) is float
    assert coordinates["precision"] == "approximate"


def test_every_coordinate_in_a_search_page_is_a_json_number(read_client: TestClient) -> None:
    response = read_client.get(SEARCH, params={"limit": 50})

    pairs = raw_coordinates(response.content)
    assert len(pairs) == 6  # 4 exact + 2 approximate public fixtures
    assert all(is_json_number(lat) and is_json_number(lng) for lat, lng in pairs)
    for hit in response.json()["data"]:
        if hit["kind"] == "news":
            continue
        coordinates = hit["item"]["location"].get("coordinates")
        if coordinates is not None:
            assert type(coordinates["latitude"]) is float
            assert type(coordinates["longitude"]) is float
            assert isinstance(coordinates["precision"], str)


def test_area_only_and_legacy_listings_have_no_coordinates_key_in_the_raw_bytes(
    read_client: TestClient,
) -> None:
    for listing_id in (MATH_TUTOR_ID, ELECTRIC_ID, SOLAR_ID, FLAT_ID):
        body = read_client.get(f"{LISTING}/{listing_id}").content

        assert b'"coordinates"' not in body and raw_coordinates(body) == []
