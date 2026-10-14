"""GET /api/v1/search against real PostgreSQL and the deterministic development fixtures.

Public fixture content (11 listings + 2 published news = 13 hits with no filters):

  providers  Sunrise Solar Solutions (solar, featured)   Bright Electric Works (electrical, Block D)
  business   B-17 Family Pharmacy (general, featured)    Glow Salon (general, Block D)
             Capital Bakers (food: bakeries, sweets-desserts; takeaway, delivery)
             Karachi Biryani House (food: biryani-rice, desi-food; dine-in, delivery)
             Mocha Corner Cafe (food: cafes; dine-in, takeaway)
  tutors     Sara M. (physics, Grade 9)                  Ali R. (mathematics, Grade 10, Block D)
  property   5 Marla House (house, sale, 3 bed, Unfurnished)
             2 Bed Flat for Rent (flat, rent, 2 bed, Furnished, Block D)
  news       Water Supply Schedule Update (update, utilities)   Community Park Cleanup (community)

Never public: Quokka (pending), Wombat (rejected), Platypus (archived), Echidna (pending Food) and
the Narwhal news draft.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

SEARCH = "/api/v1/search"
BLOCK_C = "B-17, Block C (Demo Area)"
BLOCK_D = "B-17, Block D (Demo Area)"

SOLAR = "Sunrise Solar Solutions"
ELECTRIC = "Bright Electric Works"
PHARMACY = "B-17 Family Pharmacy"
SALON = "Glow Salon"
BAKERS = "Capital Bakers"
BIRYANI = "Karachi Biryani House"
CAFE = "Mocha Corner Cafe"
SARA = "Sara M."
ALI = "Ali R."
HOUSE = "5 Marla House — B-17 Block C"
FLAT = "2 Bed Flat for Rent — B-17 Block D"
WATER = "Water Supply Schedule Update for Block D"
PARK = "B-17 Community Park Cleanup Drive This Weekend"

ALL_PUBLIC = {
    SOLAR,
    ELECTRIC,
    PHARMACY,
    SALON,
    BAKERS,
    BIRYANI,
    CAFE,
    SARA,
    ALI,
    HOUSE,
    FLAT,
    WATER,
    PARK,
}
HIDDEN_WORDS = ("quokka", "wombat", "platypus", "echidna", "narwhal")


def search(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get(SEARCH, params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def title(hit: dict[str, Any]) -> str:
    item = hit["item"]
    return str(item["name"] if "name" in item else item["title"])


def titles(body: dict[str, Any]) -> list[str]:
    return [title(hit) for hit in body["data"]]


def found(client: TestClient, **params: Any) -> set[str]:
    params.setdefault("limit", 50)
    return set(titles(search(client, **params)))


# -- shape ------------------------------------------------------------------------------------


def test_an_empty_search_browses_every_public_record_and_nothing_else(
    read_client: TestClient,
) -> None:
    body = search(read_client, limit=50)

    assert set(titles(body)) == ALL_PUBLIC
    assert body["meta"] == {"total": 13, "limit": 50, "offset": 0}


def test_browse_order_groups_by_kind_in_the_frontend_order(read_client: TestClient) -> None:
    body = search(read_client, limit=50)

    kinds = [hit["kind"] for hit in body["data"]]
    assert kinds == sorted(kinds, key=["provider", "business", "tutor", "property", "news"].index)


def test_the_same_request_returns_the_same_order_every_time(read_client: TestClient) -> None:
    assert titles(search(read_client, limit=50)) == titles(search(read_client, limit=50))
    assert titles(search(read_client, q="a", limit=50)) == titles(
        search(read_client, q="a", limit=50)
    )


def test_every_hit_is_a_discriminated_union_member_with_camel_case_and_no_nulls(
    read_client: TestClient,
) -> None:
    body = search(read_client, limit=50)

    def walk(value: object) -> None:
        if isinstance(value, dict):
            for key, inner in value.items():
                assert inner is not None, key  # null fields are omitted
                assert "_" not in key, key  # camelCase only
                walk(inner)
        elif isinstance(value, list):
            for inner in value:
                walk(inner)

    walk(body)
    for hit in body["data"]:
        assert set(hit) == {"kind", "item"}
        if hit["kind"] == "news":  # a news hit's item kind is "news" or "update"
            assert hit["item"]["kind"] in {"news", "update"}
            assert hit["item"]["status"] == "published"
        else:
            assert hit["item"]["kind"] == hit["kind"]


def test_hits_expose_no_private_or_moderation_fields(read_client: TestClient) -> None:
    text = read_client.get(SEARCH, params={"limit": 50}).text

    for forbidden in (
        "ownerId",
        "owner_id",
        "searchDocument",
        "search_document",
        "revision",
        "rejection",
        "reason",
        "createdBy",
        "createdAt",
        "updatedAt",
        "history",
        "pending",
        "rejected",
    ):
        assert forbidden not in text, forbidden


def test_search_cards_do_not_carry_the_menu_but_keep_the_food_summary(
    read_client: TestClient,
) -> None:
    body = search(read_client, q="bakers")

    food = body["data"][0]["item"]["food"]
    assert food["serviceOptions"] == ["takeaway", "delivery"]
    assert food["categories"] == ["bakeries", "sweets-desserts"]
    assert "menuHighlights" not in food


def test_a_property_card_has_its_typed_fields(read_client: TestClient) -> None:
    flat = next(h for h in search(read_client, type="property")["data"] if "Flat" in title(h))

    item = flat["item"]
    assert item["listingType"] == "rent"
    assert item["propertyType"] == "Flat"
    assert item["bedrooms"] == 2
    assert item["furnished"] == "Furnished"
    assert item["price"] == "PKR 55,000 / month"


def test_a_tutor_card_has_subject_and_grade(read_client: TestClient) -> None:
    sara = search(read_client, q="sara")["data"][0]["item"]

    assert sara["subject"] == "Physics" and sara["grade"] == "Grade 9"
    assert sara["bio"].startswith("Physics tutor")


# -- text matching ------------------------------------------------------------------------------


@pytest.mark.parametrize("q", ["solar", "SOLAR", "SoLaR", "  solar  "])
def test_matching_is_case_insensitive_and_trimmed(read_client: TestClient, q: str) -> None:
    assert SOLAR in found(read_client, q=q)


@pytest.mark.parametrize(
    ("q", "expected"),
    [
        ("pulao", {BIRYANI}),  # a Food menu item name
        ("cold brew", {CAFE}),  # a Food menu item with a space
        ("net metering", {SOLAR}),  # a tag
        ("hairdressing", {SALON}),  # a category name
        ("grade 10", {ALI}),  # a tutor grade
        ("for sale", {HOUSE}),  # the property type label
        ("3 bed", {HOUSE}),
        ("unfurnished", {HOUSE}),
        ("demo area", ALL_PUBLIC - {WATER, PARK}),  # the area text
        ("pipe work", {WATER}),  # a news summary
    ],
)
def test_search_documents_cover_the_visible_text_of_a_record(
    read_client: TestClient, q: str, expected: set[str]
) -> None:
    assert found(read_client, q=q) == expected


def test_a_shared_menu_item_finds_every_restaurant_serving_it(read_client: TestClient) -> None:
    assert found(read_client, q="chicken patties") == {BAKERS, CAFE}


@pytest.mark.parametrize("hidden", HIDDEN_WORDS)
def test_pending_rejected_archived_and_draft_content_never_matches(
    read_client: TestClient, hidden: str
) -> None:
    body = search(read_client, q=hidden)

    assert body["data"] == [] and body["meta"]["total"] == 0


@pytest.mark.parametrize("hidden", HIDDEN_WORDS)
def test_hidden_content_does_not_leak_through_any_scope_or_filter(
    read_client: TestClient, hidden: str
) -> None:
    for kind in ("all", "provider", "business", "tutor", "property", "news"):
        assert search(read_client, q=hidden, type=kind)["data"] == []


@pytest.mark.parametrize("q", ["%", "_", "\\", "%%", "a%b", "so_ar", "'; DROP TABLE listings;--"])
def test_wildcards_and_sql_metacharacters_are_matched_literally(
    read_client: TestClient, q: str
) -> None:
    body = search(read_client, q=q)

    assert body["data"] == [] and body["meta"]["total"] == 0  # nothing contains them literally


def test_punctuation_in_a_real_title_still_matches(read_client: TestClient) -> None:
    # "ali r." is a literal substring of the title "Ali R."
    assert found(read_client, q="ali r.") == {ALI}


def test_a_query_with_no_match_is_an_empty_success_not_an_error(read_client: TestClient) -> None:
    response = read_client.get(SEARCH, params={"q": "zzzznotathing"})

    assert response.status_code == 200
    assert response.json() == {"data": [], "meta": {"total": 0, "limit": 12, "offset": 0}}


def test_a_blank_query_means_browse(read_client: TestClient) -> None:
    assert found(read_client, q="   ") == ALL_PUBLIC
    assert found(read_client, q="") == ALL_PUBLIC


def test_unicode_queries_are_accepted(read_client: TestClient) -> None:
    assert found(read_client, q="—") >= {HOUSE, FLAT}  # the em dash in two titles
    assert search(read_client, q="دکان")["data"] == []


# -- ranking ------------------------------------------------------------------------------------


def test_titles_rank_exact_then_prefix_then_word_prefix_then_contains_then_elsewhere(
    read_client: TestClient,
) -> None:
    # "glow salon": exact match first
    assert titles(search(read_client, q="glow salon"))[0] == SALON
    # "b-17": starts-with beats a mid-title mention
    ordered = titles(search(read_client, q="b-17", limit=50))
    assert ordered[0] == PHARMACY or ordered[0] == PARK  # titles that start with "b-17"
    start_with = {t for t in ordered if t.lower().startswith("b-17")}
    assert set(ordered[: len(start_with)]) == start_with
    # word-prefix ("block" starts a word in the flat/house titles) precedes pure containment
    assert titles(search(read_client, q="rent", limit=50))[0] == FLAT


def test_a_title_match_outranks_a_match_found_only_in_other_fields(
    read_client: TestClient,
) -> None:
    ordered = titles(search(read_client, q="cake", limit=50))

    assert ordered == [BAKERS]  # description/menu match is still found
    ordered = titles(search(read_client, q="patties", limit=50))
    assert set(ordered) == {BAKERS, CAFE}


def test_sort_newest_puts_dated_news_first_newest_date_first(read_client: TestClient) -> None:
    ordered = titles(search(read_client, sort="newest", limit=50))

    assert ordered[:2] == [WATER, PARK]  # 2026-09-12 then 2026-09-05; undated listings after


# -- scopes -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("provider", {SOLAR, ELECTRIC}),
        ("business", {PHARMACY, SALON, BAKERS, BIRYANI, CAFE}),
        ("tutor", {SARA, ALI}),
        ("property", {HOUSE, FLAT}),
        ("news", {WATER, PARK}),
    ],
)
def test_each_type_scope_returns_only_that_kind(
    read_client: TestClient, kind: str, expected: set[str]
) -> None:
    body = search(read_client, type=kind, limit=50)

    assert set(titles(body)) == expected
    assert {hit["kind"] for hit in body["data"]} == {kind}


def test_an_unknown_type_is_a_validation_error(read_client: TestClient) -> None:
    response = read_client.get(SEARCH, params={"type": "pharmacy"})

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "type"


# -- filters ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"area": BLOCK_D}, {ELECTRIC, SALON, ALI, FLAT, WATER, PARK}),  # news has no area: kept
        ({"area": BLOCK_D, "type": "business"}, {SALON}),
        ({"area": "Nowhere"}, {WATER, PARK}),
        ({"area": "Nowhere", "type": "business"}, set()),
        ({"category": "solar", "type": "provider"}, {SOLAR}),
        ({"category": "pharmacy", "type": "business"}, {PHARMACY}),
        ({"subject": "physics", "type": "tutor"}, {SARA}),
        ({"grade": "Grade 10", "type": "tutor"}, {ALI}),
        ({"propertyType": "flat", "type": "property"}, {FLAT}),
        ({"listingType": "sale", "type": "property"}, {HOUSE}),
        ({"listingType": "rent", "type": "property"}, {FLAT}),
        ({"bedrooms": 3, "type": "property"}, {HOUSE}),
        ({"bedrooms": 2, "type": "property"}, {HOUSE, FLAT}),
        ({"furnished": "Furnished", "type": "property"}, {FLAT}),
        ({"furnished": "Unfurnished", "type": "property"}, {HOUSE}),
        ({"furnished": "Semi-Furnished", "type": "property"}, set()),
    ],
)
def test_each_filter_narrows_within_its_scope(
    read_client: TestClient, params: dict[str, Any], expected: set[str]
) -> None:
    assert found(read_client, **params) == expected


def test_a_kind_specific_filter_does_not_exclude_other_kinds(read_client: TestClient) -> None:
    """The frontend rule: a filter applies only to records that have that field."""
    result = found(read_client, grade="Grade 10")

    assert ALI in result
    assert {SOLAR, PHARMACY, HOUSE, WATER} <= result  # providers, businesses, property, news stay
    assert SARA not in result  # the only tutor with another grade is excluded
    # the same rule for the other kind-specific filters (category: provider/business/news only)
    assert found(read_client, category="solar") == {SOLAR, SARA, ALI, HOUSE, FLAT}


def test_a_filter_value_that_matches_nothing_is_an_empty_success(read_client: TestClient) -> None:
    body = search(read_client, category="Has Spaces", type="provider")

    assert body["data"] == [] and body["meta"]["total"] == 0


def test_an_overlong_filter_value_is_a_validation_error(read_client: TestClient) -> None:
    assert read_client.get(SEARCH, params={"category": "x" * 101}).status_code == 422
    assert read_client.get(SEARCH, params={"area": "x" * 201}).status_code == 422


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"vertical": "food"}, {BAKERS, BIRYANI, CAFE}),
        ({"vertical": "general"}, {PHARMACY, SALON}),
        ({"foodCategory": "bakeries"}, {BAKERS}),
        ({"foodCategory": "sweets-desserts"}, {BAKERS}),  # a non-primary category still matches
        ({"foodCategory": "desi-food"}, {BIRYANI}),
        ({"foodCategory": "cafes"}, {CAFE}),
        ({"foodCategory": "bbq"}, set()),  # only the pending (hidden) Echidna is BBQ
        ({"service": "delivery"}, {BAKERS, BIRYANI}),
        ({"service": "takeaway"}, {BAKERS, CAFE}),
        ({"service": "dine-in"}, {BIRYANI, CAFE}),
        ({"vertical": "food", "service": "dine-in", "foodCategory": "cafes"}, {CAFE}),
        ({"vertical": "food", "service": "delivery", "foodCategory": "cafes"}, set()),
    ],
)
def test_food_filters_compose_and_work_on_the_business_kind(
    read_client: TestClient, params: dict[str, Any], expected: set[str]
) -> None:
    businesses = found(read_client, type="business", **params)

    assert businesses == expected or (not expected and not businesses)


def test_food_filters_respect_food_general_isolation(read_client: TestClient) -> None:
    food = found(read_client, type="business", vertical="food")
    general = found(read_client, type="business", vertical="general")

    assert food.isdisjoint(general)
    assert food | general == {PHARMACY, SALON, BAKERS, BIRYANI, CAFE}
    # a food category never matches a General business, and vice versa
    assert PHARMACY not in found(read_client, type="business", foodCategory="cafes")
    assert found(read_client, type="business", category="pharmacy") == {PHARMACY}
    assert BAKERS not in found(read_client, type="business", category="pharmacy")


BUSINESSES = {PHARMACY, SALON, BAKERS, BIRYANI, CAFE}


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"vertical": "food"}, {BAKERS, BIRYANI, CAFE}),
        ({"vertical": "general"}, {PHARMACY, SALON}),
        ({"service": "dine-in"}, {BIRYANI, CAFE}),
        ({"service": "takeaway"}, {BAKERS, CAFE}),
        ({"service": "delivery"}, {BAKERS, BIRYANI}),
    ],
)
def test_a_known_finite_value_applies_its_filter(
    read_client: TestClient, params: dict[str, Any], expected: set[str]
) -> None:
    assert found(read_client, type="business", **params) == expected


@pytest.mark.parametrize(
    ("param", "value"),
    [
        ("vertical", "retail"),
        ("vertical", "FOOD"),
        ("vertical", "Food "),
        ("vertical", "food,general"),
        ("service", "curbside"),
        ("service", "x"),
        ("service", "Delivery"),
        ("service", "dine_in"),
        ("furnished", "Partly"),
        ("furnished", "furnished"),
        ("listingType", "lease"),
        ("listingType", "SALE"),
        ("type", "pharmacy"),
        ("sort", "price"),
    ],
)
def test_an_unknown_finite_value_is_a_validation_error_never_a_broader_query(
    read_client: TestClient, param: str, value: str
) -> None:
    response = read_client.get(SEARCH, params={"type": "business", param: value})
    if param == "type":
        response = read_client.get(SEARCH, params={param: value})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["requestId"] == response.headers["x-request-id"]
    assert [d["field"] for d in error["details"]] == [param]
    assert "data" not in response.json()  # no results at all, in particular not the unfiltered set


def test_a_blank_finite_value_still_means_no_filter(read_client: TestClient) -> None:
    assert found(read_client, type="business", vertical="", service="") == BUSINESSES


def test_the_suggestions_type_is_validated_the_same_way(read_client: TestClient) -> None:
    response = read_client.get("/api/v1/search/suggestions", params={"q": "bi", "type": "food"})

    assert response.status_code == 422


def test_an_unknown_food_category_slug_matches_nothing(read_client: TestClient) -> None:
    assert found(read_client, type="business", foodCategory="no-such-category") == set()


def test_filters_combine_with_text(read_client: TestClient) -> None:
    assert found(read_client, q="chicken", type="business", service="dine-in") == {CAFE, BIRYANI}
    assert found(
        read_client, q="chicken", type="business", vertical="food", foodCategory="cafes"
    ) == {CAFE}
    assert found(read_client, q="flat", type="property", listingType="rent", bedrooms=2) == {FLAT}
    assert found(read_client, q="flat", type="property", listingType="sale") == set()


def test_news_is_filtered_by_category_slug(read_client: TestClient) -> None:
    assert found(read_client, type="news", category="utilities") == {WATER}
    assert found(read_client, type="news", category="community") == {PARK}


@pytest.mark.parametrize(
    "params",
    [
        {"bedrooms": 0},
        {"bedrooms": 21},
        {"bedrooms": "many"},
        {"furnished": "Partly"},
        {"listingType": "lease"},
        {"limit": 0},
        {"limit": 51},
        {"limit": "ten"},
        {"offset": -1},
        {"offset": 100001},
        {"sort": "price"},
        {"q": "x" * 101},
    ],
)
def test_invalid_parameters_are_rejected_with_the_validation_envelope(
    read_client: TestClient, params: dict[str, Any]
) -> None:
    response = read_client.get(SEARCH, params=params)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["requestId"] == response.headers["x-request-id"]
    assert error["details"]


# -- pagination ---------------------------------------------------------------------------------


def test_pages_are_disjoint_complete_and_in_a_stable_order(read_client: TestClient) -> None:
    everything = titles(search(read_client, limit=50))
    pages: list[str] = []
    for offset in range(0, 13, 5):
        page = search(read_client, limit=5, offset=offset)
        assert page["meta"] == {"total": 13, "limit": 5, "offset": offset}
        pages.extend(titles(page))

    assert pages == everything
    assert len(set(pages)) == 13


def test_an_offset_past_the_end_is_an_empty_page_with_the_true_total(
    read_client: TestClient,
) -> None:
    body = search(read_client, limit=5, offset=500)

    assert body["data"] == [] and body["meta"] == {"total": 13, "limit": 5, "offset": 500}


def test_the_default_limit_is_twelve_and_the_maximum_fifty(read_client: TestClient) -> None:
    assert len(search(read_client)["data"]) == 12
    assert search(read_client)["meta"]["limit"] == 12
    assert len(search(read_client, limit=50)["data"]) == 13


def test_pagination_applies_to_ranked_text_results_too(read_client: TestClient) -> None:
    first = titles(search(read_client, q="a", limit=3, offset=0))
    second = titles(search(read_client, q="a", limit=3, offset=3))
    both = titles(search(read_client, q="a", limit=6, offset=0))

    assert first + second == both


# -- robustness ---------------------------------------------------------------------------------


def test_search_works_after_a_listing_changes_visibility(
    read_client: TestClient, fixtures_session: Any
) -> None:
    from app.models import Listing
    from app.models.enums import ListingStatus
    from scripts.dev_fixtures import SOLAR_ID

    assert SOLAR in found(read_client)
    solar = fixtures_session.get(Listing, SOLAR_ID)
    solar.status = ListingStatus.ARCHIVED
    fixtures_session.flush()

    assert SOLAR not in found(read_client)
    assert SOLAR not in found(read_client, q="solar")
