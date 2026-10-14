"""Listing detail, news and categories: shapes, visibility and the single public 404."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Listing, NewsArticle
from app.models.enums import ListingStatus, NewsStatus
from scripts.dev_fixtures import (
    ARCHIVED_TUTOR_ID,
    BAKERS_ID,
    BIRYANI_ID,
    DRAFT_NEWS_ID,
    FLAT_ID,
    HOUSE_ID,
    NEWS_ID,
    PENDING_FOOD_ID,
    PENDING_PROVIDER_ID,
    PHARMACY_ID,
    REJECTED_BUSINESS_ID,
    SOLAR_ID,
    TUTOR_ID,
    UPDATE_ID,
)

LISTING = "/api/v1/listings"
NEWS = "/api/v1/news"
CATEGORIES = "/api/v1/categories"


def get(client: TestClient, url: str) -> dict[str, Any]:
    response = client.get(url)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def assert_public_not_found(response: Any) -> None:
    assert response.status_code == 404
    body = response.json()
    assert body == {
        "error": {
            "code": "not_found",
            "message": "Resource not found.",
            "requestId": response.headers["x-request-id"],
        }
    }


# -- listing detail ---------------------------------------------------------------------------


def test_a_food_business_detail_has_the_full_menu_and_food_profile(
    read_client: TestClient,
) -> None:
    item = get(read_client, f"{LISTING}/{BAKERS_ID}")["data"]

    assert item["kind"] == "business" and item["vertical"] == "food"
    assert item["name"] == "Capital Bakers" and item["category"] == "Bakeries"
    food = item["food"]
    assert food["categories"] == ["bakeries", "sweets-desserts"]
    assert food["serviceOptions"] == ["takeaway", "delivery"]
    assert food["hoursNote"] == "Daily, 8 AM–10 PM"
    assert [m["name"] for m in food["menuHighlights"]] == [
        "Fresh Milk Bread",
        "Chocolate Fudge Cake",
        "Chicken Patties",
    ]
    assert food["menuHighlights"][1]["description"] == "Made fresh daily."
    assert food["menuHighlights"][0]["price"] == "PKR 250"
    assert item["categories"] == [
        {"slug": "bakeries", "name": "Bakeries", "isPrimary": True},
        {"slug": "sweets-desserts", "name": "Sweets / Desserts", "isPrimary": False},
    ]


def test_a_general_business_has_no_food_section(read_client: TestClient) -> None:
    item = get(read_client, f"{LISTING}/{PHARMACY_ID}")["data"]

    assert item["vertical"] == "general" and "food" not in item
    assert item["featured"] is True
    assert item["category"] == "Pharmacy"


def test_a_provider_detail(read_client: TestClient) -> None:
    item = get(read_client, f"{LISTING}/{SOLAR_ID}")["data"]

    assert item["kind"] == "provider" and item["name"] == "Sunrise Solar Solutions"
    assert item["category"] == "solar" and item["categoryLabel"] == "Solar"
    assert item["tags"] == ["solar", "installation", "net metering"]
    assert item["featured"] is True and item["area"] == "B-17, Block C (Demo Area)"


def test_a_tutor_detail(read_client: TestClient) -> None:
    item = get(read_client, f"{LISTING}/{TUTOR_ID}")["data"]

    assert item["kind"] == "tutor" and item["subject"] == "Physics" and item["grade"] == "Grade 9"
    assert item["bio"].startswith("Physics tutor")
    assert "featured" not in item


def test_a_property_detail(read_client: TestClient) -> None:
    house = get(read_client, f"{LISTING}/{HOUSE_ID}")["data"]
    flat = get(read_client, f"{LISTING}/{FLAT_ID}")["data"]

    assert house["listingType"] == "sale" and house["bedrooms"] == 3
    assert house["furnished"] == "Unfurnished" and house["propertyType"] == "House"
    assert flat["listingType"] == "rent" and flat["price"] == "PKR 55,000 / month"


def test_detail_never_exposes_private_or_moderation_data(read_client: TestClient) -> None:
    for listing_id in (BAKERS_ID, SOLAR_ID, TUTOR_ID, HOUSE_ID, PHARMACY_ID):
        text = read_client.get(f"{LISTING}/{listing_id}").text
        for forbidden in (
            "owner",
            "searchDocument",
            "revision",
            "history",
            "reason",
            "createdAt",
            "updatedAt",
            "status",
            "isFeatured",
        ):
            assert forbidden not in text, (listing_id, forbidden)


@pytest.mark.parametrize(
    "listing_id",
    [PENDING_PROVIDER_ID, REJECTED_BUSINESS_ID, ARCHIVED_TUTOR_ID, PENDING_FOOD_ID],
)
def test_pending_rejected_and_archived_listings_are_a_public_404(
    read_client: TestClient, listing_id: uuid.UUID
) -> None:
    assert_public_not_found(read_client.get(f"{LISTING}/{listing_id}"))


def test_hidden_unknown_and_malformed_ids_are_indistinguishable(read_client: TestClient) -> None:
    hidden = read_client.get(f"{LISTING}/{PENDING_PROVIDER_ID}")
    unknown = read_client.get(f"{LISTING}/{uuid.uuid4()}")
    malformed = read_client.get(f"{LISTING}/not-a-uuid")
    news_id = read_client.get(f"{LISTING}/{NEWS_ID}")  # a news id is not a listing id

    for response in (hidden, unknown, malformed, news_id):
        assert_public_not_found(response)
        assert response.json()["error"].keys() == {"code", "message", "requestId"}


@pytest.mark.parametrize("raw", ["0", "../etc/passwd", "%00", "1" * 400, "' OR 1=1 --", "null"])
def test_odd_ids_are_just_not_found(read_client: TestClient, raw: str) -> None:
    response = read_client.get(f"{LISTING}/{raw}")

    assert response.status_code in {404}


def test_a_listing_that_is_unapproved_after_loading_disappears(
    read_client: TestClient, fixtures_session: Session
) -> None:
    assert read_client.get(f"{LISTING}/{SOLAR_ID}").status_code == 200
    listing = fixtures_session.get(Listing, SOLAR_ID)
    assert listing is not None
    listing.status = ListingStatus.REJECTED
    fixtures_session.flush()

    assert_public_not_found(read_client.get(f"{LISTING}/{SOLAR_ID}"))


def test_detail_does_not_depend_on_a_trailing_slash_or_case(read_client: TestClient) -> None:
    upper = str(BIRYANI_ID).upper()

    assert read_client.get(f"{LISTING}/{upper}").status_code == 200


# -- news -------------------------------------------------------------------------------------


def test_news_lists_only_published_items_newest_first(read_client: TestClient) -> None:
    body = get(read_client, NEWS)

    assert [n["id"] for n in body["data"]] == [str(UPDATE_ID), str(NEWS_ID)]
    assert body["meta"] == {"total": 2, "limit": 12, "offset": 0}
    assert all(n["status"] == "published" for n in body["data"])


def test_a_news_item_has_the_frontend_shape(read_client: TestClient) -> None:
    item = get(read_client, f"{NEWS}/{NEWS_ID}")["data"]

    assert item == {
        "id": str(NEWS_ID),
        "kind": "news",
        "status": "published",
        "title": "B-17 Community Park Cleanup Drive This Weekend",
        "category": "Community",
        "categorySlug": "community",
        "summary": item["summary"],
        "image": "/images/news/community.jpg",
        "publishedAt": "2026-09-05",
        "tags": ["community", "event", "cleanup"],
    }


def test_an_item_without_an_image_omits_the_field(read_client: TestClient) -> None:
    item = get(read_client, f"{NEWS}/{UPDATE_ID}")["data"]

    assert item["kind"] == "update" and "image" not in item


@pytest.mark.parametrize(("kind", "expected"), [("news", [NEWS_ID]), ("update", [UPDATE_ID])])
def test_news_can_be_filtered_by_kind(
    read_client: TestClient, kind: str, expected: list[uuid.UUID]
) -> None:
    body = get(read_client, f"{NEWS}?kind={kind}")

    assert [n["id"] for n in body["data"]] == [str(i) for i in expected]
    assert body["meta"]["total"] == 1


def test_news_pagination(read_client: TestClient) -> None:
    first = get(read_client, f"{NEWS}?limit=1&offset=0")
    second = get(read_client, f"{NEWS}?limit=1&offset=1")
    beyond = get(read_client, f"{NEWS}?limit=1&offset=5")

    assert [n["id"] for n in first["data"]] == [str(UPDATE_ID)]
    assert [n["id"] for n in second["data"]] == [str(NEWS_ID)]
    assert beyond["data"] == [] and beyond["meta"] == {"total": 2, "limit": 1, "offset": 5}


@pytest.mark.parametrize("query", ["limit=0", "limit=51", "offset=-1", "kind=other", "limit=x"])
def test_news_rejects_invalid_parameters(read_client: TestClient, query: str) -> None:
    response = read_client.get(f"{NEWS}?{query}")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_draft_is_a_public_404_and_never_listed(read_client: TestClient) -> None:
    assert_public_not_found(read_client.get(f"{NEWS}/{DRAFT_NEWS_ID}"))
    assert str(DRAFT_NEWS_ID) not in read_client.get(NEWS).text
    assert "Narwhal" not in read_client.get(NEWS).text


def test_unknown_and_malformed_news_ids_are_the_same_404(read_client: TestClient) -> None:
    assert_public_not_found(read_client.get(f"{NEWS}/{uuid.uuid4()}"))
    assert_public_not_found(read_client.get(f"{NEWS}/not-a-uuid"))
    assert_public_not_found(read_client.get(f"{NEWS}/{SOLAR_ID}"))  # a listing id is not news


def test_news_expose_no_authoring_data(read_client: TestClient) -> None:
    text = read_client.get(NEWS).text

    for forbidden in ("createdBy", "created_by", "categoryId", "category_module", "draft"):
        assert forbidden not in text


def test_a_published_item_that_becomes_a_draft_disappears(
    read_client: TestClient, fixtures_session: Session
) -> None:
    article = fixtures_session.get(NewsArticle, NEWS_ID)
    assert article is not None
    article.status = NewsStatus.DRAFT
    fixtures_session.flush()

    assert_public_not_found(read_client.get(f"{NEWS}/{NEWS_ID}"))
    assert [n["id"] for n in get(read_client, NEWS)["data"]] == [str(UPDATE_ID)]


# -- categories -------------------------------------------------------------------------------


def test_categories_list_every_active_category_grouped_by_module_in_display_order(
    read_client: TestClient, reference_category_count: int
) -> None:
    body = get(read_client, CATEGORIES)

    assert len(body["data"]) == reference_category_count
    keys = [(c["module"], c["displayOrder"]) for c in body["data"]]
    assert keys == sorted(keys)
    assert {"module", "slug", "name", "id", "displayOrder"} <= set(body["data"][0])


@pytest.mark.parametrize(
    ("module", "first", "count"),
    [
        ("services", "construction", 11),
        ("food", "restaurants", 11),
        ("directory", "pharmacy", 6),
        ("property", "house", 3),
        ("education", "physics", 4),
        ("news", "community", 4),
    ],
)
def test_categories_can_be_scoped_to_a_module(
    read_client: TestClient, module: str, first: str, count: int
) -> None:
    body = get(read_client, f"{CATEGORIES}?module={module}")

    assert len(body["data"]) == count
    assert body["data"][0]["slug"] == first
    assert {c["module"] for c in body["data"]} == {module}


def test_food_categories_are_exactly_the_eleven_the_frontend_lists(
    read_client: TestClient,
) -> None:
    slugs = [c["slug"] for c in get(read_client, f"{CATEGORIES}?module=food")["data"]]

    assert slugs == [
        "restaurants",
        "fast-food",
        "biryani-rice",
        "bbq",
        "pizza-burgers",
        "cafes",
        "juice-shakes",
        "bakeries",
        "sweets-desserts",
        "desi-food",
        "tea-snacks",
    ]


def test_an_unknown_module_is_a_validation_error(read_client: TestClient) -> None:
    response = read_client.get(f"{CATEGORIES}?module=pharmacy")

    assert response.status_code == 422


def test_inactive_categories_are_not_listed(
    read_client: TestClient, fixtures_session: Session
) -> None:
    from app.models.enums import CategoryModule
    from app.repositories.taxonomy import CategoryRepository

    category = CategoryRepository(fixtures_session).get_by_slug(CategoryModule.FOOD, "bbq")
    assert category is not None
    category.is_active = False
    fixtures_session.flush()

    slugs = [c["slug"] for c in get(read_client, f"{CATEGORIES}?module=food")["data"]]
    assert "bbq" not in slugs and len(slugs) == 10


def test_categories_expose_no_internal_columns(read_client: TestClient) -> None:
    text = read_client.get(CATEGORIES).text

    for forbidden in ("isActive", "createdAt", "updatedAt", "is_active"):
        assert forbidden not in text
