"""Reference seeds (every environment) are separate from development fixtures (never production)."""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.reference_data import REFERENCE_CATEGORIES
from app.db.seed import seed_reference_data
from app.models import (
    Category,
    FoodMenuItem,
    Listing,
    ListingStatusHistory,
    NewsArticle,
    SavedItem,
    User,
    UserRole,
)
from app.models.enums import CategoryModule, ListingStatus, RoleName
from app.repositories.taxonomy import CategoryRepository
from scripts.dev_fixtures import (
    ADMIN_ID,
    BAKERS_ID,
    HOUSE_ID,
    PHARMACY_ID,
    RESIDENT_ID,
    SOLAR_ID,
    TUTOR_ID,
    ensure_not_production,
    fixture_id,
    load_dev_fixtures,
)

EXPECTED_COUNTS = {
    CategoryModule.SERVICES: 11,
    CategoryModule.FOOD: 11,
    CategoryModule.DIRECTORY: 6,
    CategoryModule.PROPERTY: 3,
    CategoryModule.EDUCATION: 4,
    CategoryModule.NEWS: 4,
}


def slugs(session: Session, module: CategoryModule) -> list[str]:
    return [c.slug for c in CategoryRepository(session).list_by_module(module)]


def total(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


# -- reference taxonomy --------------------------------------------------------------------------


def test_the_reference_taxonomy_matches_the_frontend_sources(db_session: Session) -> None:
    for module, expected in EXPECTED_COUNTS.items():
        assert len(slugs(db_session, module)) == expected, module
    assert total(db_session, Category) == len(REFERENCE_CATEGORIES) == sum(EXPECTED_COUNTS.values())

    # Spot-check the stable ids the frontend URLs/filters rely on (src/config/food.ts,
    # src/data/serviceCategories.ts) — including their display order.
    assert slugs(db_session, CategoryModule.FOOD) == [
        "restaurants", "fast-food", "biryani-rice", "bbq", "pizza-burgers", "cafes",
        "juice-shakes", "bakeries", "sweets-desserts", "desi-food", "tea-snacks",
    ]  # fmt: skip
    assert slugs(db_session, CategoryModule.SERVICES)[:3] == ["construction", "electrical", "solar"]
    assert slugs(db_session, CategoryModule.PROPERTY) == ["house", "flat", "plot"]


def test_every_seeded_category_is_active_and_top_level(db_session: Session) -> None:
    rows = db_session.scalars(select(Category)).all()

    assert all(row.is_active and row.parent_id is None for row in rows)


def test_seeding_is_idempotent(db_session: Session) -> None:
    before = total(db_session, Category)

    assert seed_reference_data(db_session) == 0
    assert seed_reference_data(db_session) == 0

    assert total(db_session, Category) == before


def test_seeding_never_overwrites_an_admins_edits(db_session: Session) -> None:
    bakeries = CategoryRepository(db_session).get_by_slug(CategoryModule.FOOD, "bakeries")
    assert bakeries is not None
    bakeries.name, bakeries.display_order, bakeries.is_active = "Bakery & Cakes", 42, False
    db_session.commit()

    seed_reference_data(db_session)
    db_session.expire_all()

    again = CategoryRepository(db_session).get_by_slug(CategoryModule.FOOD, "bakeries")
    assert again is not None
    assert (again.name, again.display_order, again.is_active) == ("Bakery & Cakes", 42, False)


def test_a_re_run_adds_only_what_is_missing(db_session: Session) -> None:
    removed = CategoryRepository(db_session).get_by_slug(CategoryModule.NEWS, "utilities")
    assert removed is not None
    db_session.delete(removed)
    db_session.commit()

    assert seed_reference_data(db_session) == 1
    assert CategoryRepository(db_session).get_by_slug(CategoryModule.NEWS, "utilities") is not None


def test_the_reference_seed_creates_no_users_listings_or_demo_data(db_session: Session) -> None:
    for model in (User, Listing, NewsArticle, SavedItem, ListingStatusHistory, UserRole):
        assert total(db_session, model) == 0, model.__name__


def test_the_reference_data_has_no_duplicate_slugs_within_a_module() -> None:
    keys = [(seed.module, seed.slug) for seed in REFERENCE_CATEGORIES]

    assert len(keys) == len(set(keys))


# -- development fixtures ----------------------------------------------------------------------


def test_fixture_ids_are_deterministic_genuine_uuids() -> None:
    assert fixture_id("listing:capital-bakers") == BAKERS_ID
    assert fixture_id("listing:capital-bakers") == fixture_id("listing:capital-bakers")
    assert fixture_id("listing:a") != fixture_id("listing:b")
    assert BAKERS_ID.version == 5  # name-based; real data is random UUIDv4, never these
    assert len({ADMIN_ID, RESIDENT_ID, SOLAR_ID, PHARMACY_ID, BAKERS_ID, HOUSE_ID, TUTOR_ID}) == 7


def test_fixtures_load_a_coherent_demo_dataset(db_session: Session) -> None:
    result = load_dev_fixtures(db_session)

    assert (result.users, result.listings, result.news) == (3, 5, 1)
    bakers = db_session.get(Listing, BAKERS_ID)
    assert bakers is not None and bakers.status is ListingStatus.APPROVED
    assert bakers.business is not None and bakers.business.food is not None
    assert [m.position for m in bakers.business.food.menu_items] == [1, 2, 3]
    assert [c.category.slug for c in bakers.categories] == ["bakeries", "sweets-desserts"]
    # each fixture listing carries a believable audit trail: submitted -> approved
    assert [h.action.value for h in bakers.status_history] == ["submitted", "approved"]
    assert db_session.get(UserRole, (ADMIN_ID, RoleName.ADMIN)) is not None
    assert db_session.get(SavedItem, (RESIDENT_ID, BAKERS_ID)) is not None
    assert total(db_session, FoodMenuItem) == 3


def test_fixtures_are_idempotent_and_keep_their_ids(db_session: Session) -> None:
    load_dev_fixtures(db_session)

    again = load_dev_fixtures(db_session)

    assert (again.users, again.listings, again.news) == (0, 0, 0)
    assert total(db_session, Listing) == 5 and total(db_session, User) == 3


def test_fixtures_refuse_to_run_in_production() -> None:
    production = Settings(_env_file=None, environment="production")

    with pytest.raises(SystemExit, match="production"):
        ensure_not_production(production)
    ensure_not_production(Settings(_env_file=None, environment="staging"))  # allowed
