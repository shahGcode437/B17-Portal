"""Write -> read: what the write API stores is exactly what the existing public read APIs serve
(Phase 12D). Only APPROVED listings are public; pending, rejected and archived never are."""

from typing import Any

import pytest

from app.models.enums import ListingStatus, PlanCode
from app.services.search_index import SearchIndexer
from tests.db.auth_helpers import AuthEnv
from tests.db.write_helpers import (
    approximate,
    archive,
    business_body,
    created_id,
    food_body,
    patch,
    property_body,
    provider_body,
    set_status,
    signed_in,
    tutor_body,
)


def public_hits(env: AuthEnv, **params: Any) -> list[dict[str, Any]]:
    response = env.client().get("/search", params=params)
    assert response.status_code == 200, response.text
    data: list[dict[str, Any]] = response.json()["data"]
    return data


@pytest.mark.parametrize(
    "status", [ListingStatus.PENDING, ListingStatus.REJECTED, ListingStatus.ARCHIVED]
)
def test_only_approved_listings_are_public(auth_env: AuthEnv, status: ListingStatus) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    anonymous = auth_env.client()
    listing_id = created_id(api, food_body(name="Status Probe Bakery"))
    set_status(auth_env.session, listing_id, status)

    assert anonymous.get(f"/listings/{listing_id}").status_code == 404
    assert public_hits(auth_env, q="Status Probe") == []
    assert public_hits(auth_env, q="bakeries", vertical="food") == []
    assert anonymous.get("/search/suggestions", params={"q": "Status Probe"}).json()["data"] == []


def test_a_listing_created_through_the_api_is_served_by_the_read_apis_once_approved(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    anonymous = auth_env.client()
    ids = {
        "provider": created_id(api, provider_body(name="Zeta Provider")),
        "general": created_id(api, business_body(name="Zeta General Shop")),
        "food": created_id(api, food_body(name="Zeta Bakery")),
        "tutor": created_id(api, tutor_body(name="Zeta Tutor")),
        "property": created_id(api, property_body(title="Zeta House")),
    }
    for listing_id in ids.values():
        set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    provider = anonymous.get(f"/listings/{ids['provider']}").json()["data"]
    general = anonymous.get(f"/listings/{ids['general']}").json()["data"]
    food = anonymous.get(f"/listings/{ids['food']}").json()["data"]
    tutor = anonymous.get(f"/listings/{ids['tutor']}").json()["data"]
    prop = anonymous.get(f"/listings/{ids['property']}").json()["data"]

    assert (provider["kind"], provider["name"], provider["category"]) == (
        "provider",
        "Zeta Provider",
        "electrical",
    )
    assert (general["kind"], general["vertical"], general["category"]) == (
        "business",
        "general",
        "Grocery",
    )
    assert (food["vertical"], food["category"], food["food"]["categories"]) == (
        "food",
        "Bakeries",
        ["bakeries", "cafes"],
    )
    assert [m["name"] for m in food["food"]["menuHighlights"]] == ["Fudge Cake", "Sourdough"]
    assert (tutor["subject"], tutor["grade"]) == ("Physics", "Matric / A-Levels")
    assert (
        prop["title"],
        prop["listingType"],
        prop["propertyType"],
        prop["price"],
        prop["bedrooms"],
        prop["furnished"],
    ) == ("Zeta House", "sale", "House", "PKR 2.2 Cr", 3, "Unfurnished")
    for item in (provider, general, food, tutor, prop):
        assert "ownerId" not in item and "status" not in item and "revision" not in item
    assert len(public_hits(auth_env, q="Zeta")) == 5


def test_the_existing_search_filters_find_api_created_listings(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    food_id = created_id(api, food_body(name="Filter Bakery"))
    property_id = created_id(api, property_body(title="Filter House"))
    for listing_id in (food_id, property_id):
        set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    food_hits = public_hits(
        auth_env, type="business", vertical="food", foodCategory="bakeries", service="delivery"
    )
    property_hits = public_hits(
        auth_env,
        type="property",
        listingType="sale",
        propertyType="house",
        bedrooms=3,
        furnished="Unfurnished",
    )
    area_hits = public_hits(auth_env, q="Filter", area="B-17")

    assert [h["item"]["name"] for h in food_hits] == ["Filter Bakery"]
    assert [h["item"]["title"] for h in property_hits] == ["Filter House"]
    assert {h["kind"] for h in area_hits} == {"business", "property"}
    suggestions = (
        auth_env.client().get("/search/suggestions", params={"q": "Filter"}).json()["data"]
    )
    assert {s["label"] for s in suggestions} >= {"Filter Bakery", "Filter House"}


def test_location_text_found_by_search_follows_the_visibility_chosen_at_creation(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    exact_id = created_id(
        api,
        business_body(
            name="Exact Place",
            location={**approximate(), "visibility": "exact", "address": "Gulab Lane 12"},
        ),
    )
    hidden_id = created_id(
        api, business_body(name="Hidden Place", location=approximate(address="Jasmine Lane 99"))
    )
    for listing_id in (exact_id, hidden_id):
        set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    assert [h["item"]["name"] for h in public_hits(auth_env, q="Gulab Lane")] == ["Exact Place"]
    assert public_hits(auth_env, q="Jasmine Lane") == []


def test_the_whole_write_lifecycle_keeps_the_search_index_clean(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    listing_id = created_id(api, food_body())
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    assert patch(api, listing_id, 1, location=approximate()).status_code == 200  # narrowing
    assert patch(api, listing_id, 2, food={"menuHighlights": [{"name": "Tart"}]}).status_code == 200
    assert patch(api, listing_id, 3, vertical="general", category="grocery").status_code == 200
    assert archive(api, listing_id, 4).status_code == 200

    assert SearchIndexer(auth_env.session).find_stale() == []
