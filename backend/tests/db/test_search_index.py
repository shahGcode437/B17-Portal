"""``listings.search_document``: what is in it, that it stays correct, and how it is repaired."""

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db import search_index as search_index_cli
from app.models import FoodMenuItem, Listing
from app.models.enums import CategoryModule, FoodServiceOption
from app.repositories.listing_reads import ListingReadRepository
from app.repositories.taxonomy import CategoryRepository
from app.services.listing_creation import (
    BusinessListingInput,
    FoodInput,
    ListingCreationService,
    MenuItemInput,
)
from app.services.search_document import build_search_document
from app.services.search_index import SearchIndexer
from scripts.dev_fixtures import (
    BAKERS_ID,
    FLAT_ID,
    HOUSE_ID,
    PENDING_PROVIDER_ID,
    PROFESSIONAL_ID,
    REJECTED_BUSINESS_ID,
    SOLAR_ID,
    TUTOR_ID,
)


def document(session: Session, listing_id: object) -> str:
    stored = session.scalar(
        text("SELECT search_document FROM listings WHERE id = :id"), {"id": listing_id}
    )
    assert isinstance(stored, str)
    return stored


# -- composition ------------------------------------------------------------------------------


def test_a_provider_document_has_title_category_description_area_and_tags(
    fixtures_session: Session,
) -> None:
    assert document(fixtures_session, SOLAR_ID) == (
        "sunrise solar solutions solar rooftop solar design and installation for homes in b-17. "
        "b-17, block c (demo area) solar installation net metering"
    )


def test_a_food_business_document_includes_every_category_and_menu_item_name(
    fixtures_session: Session,
) -> None:
    doc = document(fixtures_session, BAKERS_ID)

    for expected in (
        "capital bakers",
        "bakeries",
        "sweets / desserts",
        "fresh milk bread",
        "chocolate fudge cake",
        "chicken patties",
    ):
        assert expected in doc
    assert "pkr 250" not in doc  # menu PRICES are not searched, only names


def test_a_property_document_has_price_beds_furnishing_and_sale_or_rent(
    fixtures_session: Session,
) -> None:
    house, flat = document(fixtures_session, HOUSE_ID), document(fixtures_session, FLAT_ID)

    assert "pkr 2.2 cr" in house and "3 bed" in house and "unfurnished" in house
    assert house.endswith("for sale")
    assert "pkr 55,000 / month" in flat and "2 bed" in flat and flat.endswith("for rent")


def test_a_tutor_document_has_the_grade(fixtures_session: Session) -> None:
    doc = document(fixtures_session, TUTOR_ID)

    assert "grade 9" in doc and "physics" in doc and doc.startswith("sara m.")


def test_documents_are_lowercase_and_single_spaced(fixtures_session: Session) -> None:
    for (doc,) in fixtures_session.execute(text("SELECT search_document FROM listings")):
        assert doc == doc.lower()
        assert "  " not in doc and doc == doc.strip() and "\n" not in doc


def test_a_document_never_contains_private_or_moderation_data(fixtures_session: Session) -> None:
    for (doc,) in fixtures_session.execute(text("SELECT search_document FROM listings")):
        for forbidden in ("fixtures.example", "fixture professional", "fixture admin", "rejection"):
            assert forbidden not in doc
    # a rejected listing's moderation reason is history data, not searchable text
    assert "clearer details" not in document(fixtures_session, REJECTED_BUSINESS_ID)


def test_every_fixture_document_is_current(fixtures_session: Session) -> None:
    assert SearchIndexer(fixtures_session).find_stale() == []


def test_every_listing_has_a_document_even_a_hidden_one(fixtures_session: Session) -> None:
    assert "quokka" in document(fixtures_session, PENDING_PROVIDER_ID)  # indexed, never served


# -- staying correct ------------------------------------------------------------------------------


def food_input(**overrides: object) -> BusinessListingInput:
    values: dict[str, object] = {
        "owner_id": PROFESSIONAL_ID,
        "title": "  Zaika   Grill ",
        "area": "B-17, Block C (Demo Area)",
        "description": "Smoky\nplatters",
        "tags": ["Smoky", " GRILL ", "smoky"],
        "food": FoodInput(
            category_slugs=["bbq"],
            service_options=[FoodServiceOption.TAKEAWAY],
            menu_items=[MenuItemInput(name="Seekh Kebab")],
        ),
    }
    values.update(overrides)
    return BusinessListingInput(**values)  # type: ignore[arg-type]


def test_creating_a_listing_stores_its_document_in_the_same_transaction(
    fixtures_session: Session,
) -> None:
    listing = ListingCreationService(fixtures_session).create_business_listing(food_input())

    stored = document(fixtures_session, listing.id)
    assert (
        stored == "zaika grill bbq smoky platters b-17, block c (demo area) smoky grill seekh kebab"
    )
    assert SearchIndexer(fixtures_session).find_stale() == []


def test_a_failed_creation_leaves_no_listing_and_no_document(fixtures_session: Session) -> None:
    before = fixtures_session.scalar(text("SELECT count(*) FROM listings"))

    with pytest.raises(AppError):
        ListingCreationService(fixtures_session).create_business_listing(
            food_input(food=FoodInput(category_slugs=["no-such"], service_options=[]))
        )

    assert fixtures_session.scalar(text("SELECT count(*) FROM listings")) == before


def test_a_new_pending_listing_is_indexed_but_not_publicly_searchable(
    fixtures_session: Session, read_client: object
) -> None:
    from fastapi.testclient import TestClient

    assert isinstance(read_client, TestClient)
    ListingCreationService(fixtures_session).create_business_listing(food_input())

    assert read_client.get("/api/v1/search", params={"q": "zaika"}).json()["data"] == []


def test_find_stale_detects_a_change_that_skipped_the_indexer(fixtures_session: Session) -> None:
    listing = fixtures_session.get(Listing, SOLAR_ID)
    assert listing is not None
    listing.title = "Moonrise Solar"
    fixtures_session.flush()

    assert SearchIndexer(fixtures_session).find_stale() == [SOLAR_ID]


def test_refresh_repairs_a_stale_document(fixtures_session: Session) -> None:
    listing = fixtures_session.get(Listing, SOLAR_ID)
    assert listing is not None
    listing.title = "Moonrise Solar"
    indexer = SearchIndexer(fixtures_session)

    indexer.refresh(listing)

    assert document(fixtures_session, SOLAR_ID).startswith("moonrise solar")
    assert indexer.find_stale() == []


def test_a_menu_item_change_followed_by_refresh_updates_the_document(
    fixtures_session: Session,
) -> None:
    listing = fixtures_session.get(Listing, BAKERS_ID)
    assert listing is not None and listing.business is not None and listing.business.food
    listing.business.food.menu_items.append(FoodMenuItem(position=4, name="Sourdough Loaf"))
    fixtures_session.flush()
    assert "sourdough" not in document(fixtures_session, BAKERS_ID)

    SearchIndexer(fixtures_session).refresh(listing)

    assert "sourdough loaf" in document(fixtures_session, BAKERS_ID)


def test_renaming_a_category_and_reindexing_updates_every_member_listing(
    fixtures_session: Session,
) -> None:
    category = CategoryRepository(fixtures_session).get_by_slug(CategoryModule.FOOD, "bakeries")
    assert category is not None
    category.name = "Artisan Bakeries"
    fixtures_session.flush()
    indexer = SearchIndexer(fixtures_session)
    assert indexer.find_stale() == [BAKERS_ID]

    assert indexer.reindex_category(category.id) == 1

    assert "artisan bakeries" in document(fixtures_session, BAKERS_ID)
    assert indexer.find_stale() == []


def test_rebuild_all_repairs_everything_including_empty_documents(
    fixtures_session: Session,
) -> None:
    fixtures_session.execute(text("UPDATE listings SET search_document = ''"))  # a fresh migration
    indexer = SearchIndexer(fixtures_session)
    assert len(indexer.find_stale()) == 15

    assert indexer.rebuild_all() == 15

    assert indexer.find_stale() == []
    assert document(fixtures_session, TUTOR_ID).startswith("sara m.")


def stored_documents(session: Session) -> dict[object, str]:
    rows = session.execute(text("SELECT id, search_document FROM listings")).all()
    return {row.id: row.search_document for row in rows}


def test_rebuilding_twice_changes_nothing(fixtures_session: Session) -> None:
    indexer = SearchIndexer(fixtures_session)
    indexer.rebuild_all()
    first = stored_documents(fixtures_session)

    indexer.rebuild_all()

    assert stored_documents(fixtures_session) == first


def test_the_builder_is_pure_and_matches_the_stored_value(fixtures_session: Session) -> None:
    repository = ListingReadRepository(fixtures_session)
    for listing in repository.get_for_indexing(repository.all_ids()):
        assert build_search_document(listing) == listing.search_document


def test_the_cli_validates_its_arguments_and_needs_a_database(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert search_index_cli.main([]) == 2
    assert search_index_cli.main(["explode"]) == 2
    assert "usage" in capsys.readouterr().err
    assert search_index_cli.main(["check"]) == 1  # DATABASE_URL is cleared for every test
    assert "DATABASE_URL is not set" in capsys.readouterr().err
