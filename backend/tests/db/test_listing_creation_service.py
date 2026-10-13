"""The service owns the transaction (Phase 10C proof) and the cross-row rules the database can't.

Real PostgreSQL, no mocks: the multi-table create either fully commits or leaves nothing behind.
"""

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.db.session import transaction
from app.models import (
    BusinessProfile,
    Category,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    ListingStatusHistory,
    User,
)
from app.models.enums import (
    ActorRole,
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    HistoryAction,
    ListingStatus,
)
from app.repositories.taxonomy import CategoryRepository
from app.services.listing_creation import (
    BusinessListingInput,
    FoodInput,
    ListingCreationService,
    ListingInvariantError,
    MenuItemInput,
    category_structure_problems,
    normalize_tags,
)

DEPENDENT_TABLES = (
    BusinessProfile,
    FoodProfile,
    FoodMenuItem,
    ListingCategory,
    ListingStatusHistory,
)


@pytest.fixture
def owner(db_session: Session) -> User:
    user = User(email=f"owner-{uuid.uuid4().hex[:8]}@example.test", display_name="Sana Baker")
    db_session.add(user)
    db_session.commit()  # committed (a released savepoint) so a later rollback cannot remove it
    return user


def count(session: Session, model: type, owner_id: uuid.UUID | None = None) -> int:
    statement = select(func.count()).select_from(model)
    if owner_id is not None and model is Listing:
        statement = statement.where(Listing.owner_id == owner_id)
    return session.scalar(statement) or 0


def food_input(owner: User, **overrides: object) -> BusinessListingInput:
    food = FoodInput(
        category_slugs=["bakeries", "cafes"],
        service_options=[FoodServiceOption.DELIVERY, FoodServiceOption.TAKEAWAY],
        hours_note="Daily, 8 AM–10 PM",
        menu_items=[
            MenuItemInput("Fudge Cake", section="Cakes", price_text="PKR 1,800"),
            MenuItemInput("Fresh Bread"),
            MenuItemInput("Patties", description="Chicken"),
        ],
    )
    values: dict[str, object] = {
        "owner_id": owner.id,
        "title": "Sweet Crumbs Bakery",
        "area": "B-17, Block B",
        "description": "Fresh cakes and bread baked every morning.",
        "tags": ["Cakes", " bread ", "cakes", ""],
        "food": food,
    } | overrides
    return BusinessListingInput(**values)  # type: ignore[arg-type]


# -- a successful Food listing: every table, one transaction -------------------------------------


def test_a_food_listing_is_created_across_all_its_tables(db_session: Session, owner: User) -> None:
    listing = ListingCreationService(db_session).create_business_listing(food_input(owner))
    db_session.expire_all()

    stored = db_session.get(Listing, listing.id)
    assert stored is not None
    assert (stored.kind.value, stored.status, stored.revision) == (
        "business",
        ListingStatus.PENDING,
        1,
    )
    assert stored.owner_id == owner.id and stored.tags == ["cakes", "bread"]  # normalized
    assert stored.business is not None and stored.business.vertical is BusinessVertical.FOOD

    food = stored.business.food
    assert food is not None
    assert food.service_options == ["takeaway", "delivery"]  # canonical order, whatever the input
    assert food.hours_note == "Daily, 8 AM–10 PM"
    assert [(m.position, m.name) for m in food.menu_items] == [
        (1, "Fudge Cake"),
        (2, "Fresh Bread"),
        (3, "Patties"),
    ]
    # Categories keep the chosen order; position 1 is the primary one.
    assert [(c.position, c.category.slug) for c in stored.categories] == [
        (1, "bakeries"),
        (2, "cafes"),
    ]


def test_creation_writes_the_initial_audit_row_in_the_same_transaction(
    db_session: Session, owner: User
) -> None:
    listing = ListingCreationService(db_session).create_business_listing(food_input(owner))
    db_session.expire_all()

    (entry,) = db_session.scalars(
        select(ListingStatusHistory).where(ListingStatusHistory.listing_id == listing.id)
    ).all()
    assert (entry.from_status, entry.to_status, entry.action) == (
        None,
        ListingStatus.PENDING,
        HistoryAction.SUBMITTED,
    )
    assert (entry.revision, entry.actor_user_id, entry.actor_role) == (1, owner.id, ActorRole.OWNER)


def test_a_general_business_gets_one_directory_category_and_no_food_profile(
    db_session: Session, owner: User
) -> None:
    data = BusinessListingInput(
        owner_id=owner.id, title="Capital Stationers", area="B-17, Block A", category_slug="grocery"
    )

    listing = ListingCreationService(db_session).create_business_listing(data)
    db_session.expire_all()

    stored = db_session.get(Listing, listing.id)
    assert stored is not None and stored.business is not None
    assert stored.business.vertical is BusinessVertical.GENERAL and stored.business.food is None
    assert [(c.position, c.category.slug) for c in stored.categories] == [(1, "grocery")]


def test_the_service_commits_so_the_work_survives_a_session_rollback(
    db_session: Session, owner: User
) -> None:
    listing = ListingCreationService(db_session).create_business_listing(food_input(owner))

    db_session.rollback()  # nothing pending: the service already committed

    assert db_session.get(Listing, listing.id) is not None


# -- the all-or-nothing guarantee --------------------------------------------------------------


def test_a_database_failure_midway_leaves_nothing_behind(db_session: Session, owner: User) -> None:
    """The 3rd menu item breaks a column limit AFTER the listing, business, food profile, the
    categories and the history row have been written (and flushed) — all of it must roll back."""
    too_long = "x" * 61
    bad = food_input(owner)
    assert bad.food is not None
    broken = BusinessListingInput(
        owner_id=owner.id,
        title=bad.title,
        area=bad.area,
        description=bad.description,
        tags=bad.tags,
        food=FoodInput(
            category_slugs=bad.food.category_slugs,
            service_options=bad.food.service_options,
            menu_items=[MenuItemInput("Fine"), MenuItemInput("Also fine"), MenuItemInput(too_long)],
        ),
    )
    before = {model: count(db_session, model) for model in (Listing, *DEPENDENT_TABLES)}

    with pytest.raises(DataError):
        ListingCreationService(db_session).create_business_listing(broken)

    after = {model: count(db_session, model) for model in (Listing, *DEPENDENT_TABLES)}
    assert after == before  # every table is exactly as it was
    assert db_session.scalar(select(func.count()).select_from(User).where(User.id == owner.id)) == 1


def test_the_session_is_usable_after_a_failed_transaction(db_session: Session, owner: User) -> None:
    broken = food_input(
        owner,
        food=FoodInput(
            category_slugs=["bakeries"],
            service_options=[FoodServiceOption.TAKEAWAY],
            menu_items=[MenuItemInput("x" * 61)],
        ),
    )
    with pytest.raises(DataError):
        ListingCreationService(db_session).create_business_listing(broken)

    listing = ListingCreationService(db_session).create_business_listing(food_input(owner))

    assert db_session.get(Listing, listing.id) is not None


def test_the_transaction_helper_commits_on_success_and_rolls_back_on_error(
    db_session: Session, owner: User
) -> None:
    with transaction(db_session):
        db_session.add(Listing(kind="provider", title="Kept", area="B-17", owner_id=owner.id))
    with pytest.raises(RuntimeError), transaction(db_session):
        db_session.add(Listing(kind="provider", title="Discarded", area="B-17", owner_id=owner.id))
        db_session.flush()
        raise RuntimeError("boom")

    titles = db_session.scalars(select(Listing.title).where(Listing.owner_id == owner.id)).all()
    assert titles == ["Kept"]


# -- rules the database cannot express: enforced by the service ------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        (
            {"food": FoodInput(category_slugs=[], service_options=[FoodServiceOption.TAKEAWAY])},
            "food.categories",
        ),
        (
            {
                "food": FoodInput(
                    category_slugs=["bakeries", "cafes", "bbq", "fast-food"],
                    service_options=[FoodServiceOption.TAKEAWAY],
                )
            },
            "food.categories",
        ),
        (
            {
                "food": FoodInput(
                    category_slugs=["bakeries", "bakeries"],
                    service_options=[FoodServiceOption.TAKEAWAY],
                )
            },
            "food.categories",
        ),
        (
            {
                "food": FoodInput(
                    category_slugs=["no-such-category"],
                    service_options=[FoodServiceOption.TAKEAWAY],
                )
            },
            "food.categories",
        ),
        # a Directory slug is not a Food category, even though it exists in the database
        (
            {
                "food": FoodInput(
                    category_slugs=["pharmacy"], service_options=[FoodServiceOption.TAKEAWAY]
                )
            },
            "food.categories",
        ),
        (
            {"food": FoodInput(category_slugs=["bakeries"], service_options=[])},
            "food.serviceOptions",
        ),
        (
            {
                "food": FoodInput(
                    category_slugs=["bakeries"],
                    service_options=[FoodServiceOption.TAKEAWAY],
                    menu_items=[MenuItemInput(f"i{n}") for n in range(9)],
                )
            },
            "food.menuHighlights",
        ),
        ({"category_slug": "pharmacy"}, "categorySlug"),  # a Food business has no typed category
    ],
)
def test_food_rules_are_enforced_and_nothing_is_written_on_failure(
    db_session: Session, owner: User, overrides: dict[str, object], field: str
) -> None:
    before = count(db_session, Listing)

    with pytest.raises(AppError) as error:
        ListingCreationService(db_session).create_business_listing(food_input(owner, **overrides))

    assert error.value.code is ErrorCode.VALIDATION_ERROR and error.value.status_code == 422
    assert error.value.details is not None
    assert field in {detail.field for detail in error.value.details}
    assert count(db_session, Listing) == before


@pytest.mark.parametrize(
    ("category_slug", "food"),
    [
        (None, None),  # a General business needs a category
        ("unknown", None),
        ("bakeries", None),  # a Food slug is not a Directory category
    ],
)
def test_general_business_rules_are_enforced(
    db_session: Session, owner: User, category_slug: str | None, food: FoodInput | None
) -> None:
    data = BusinessListingInput(
        owner_id=owner.id, title="Shop", area="B-17", category_slug=category_slug, food=food
    )

    with pytest.raises(AppError) as error:
        ListingCreationService(db_session).create_business_listing(data)

    assert error.value.code is ErrorCode.VALIDATION_ERROR


def test_an_inactive_category_cannot_be_chosen_for_a_new_listing(
    db_session: Session, owner: User
) -> None:
    from app.models import Category
    from app.models.enums import CategoryModule

    bakeries = db_session.scalars(
        select(Category).where(Category.module == CategoryModule.FOOD, Category.slug == "bakeries")
    ).one()
    bakeries.is_active = False
    db_session.commit()

    with pytest.raises(AppError):
        ListingCreationService(db_session).create_business_listing(
            food_input(
                owner,
                food=FoodInput(
                    category_slugs=["bakeries"], service_options=[FoodServiceOption.TAKEAWAY]
                ),
            )
        )


def test_tag_normalization_matches_the_frontend_rule() -> None:
    assert normalize_tags(["  Solar ", "net metering", "SOLAR", "", "  "]) == [
        "solar",
        "net metering",
    ]


# -- Food's category rules (1..3, a primary, the food module) are SERVICE invariants ---------------


@pytest.mark.parametrize(
    ("vertical", "rows", "expected"),
    [
        (BusinessVertical.FOOD, [(1, CategoryModule.FOOD)], []),
        (BusinessVertical.FOOD, [(n, CategoryModule.FOOD) for n in (1, 2, 3)], []),
        (BusinessVertical.GENERAL, [(1, CategoryModule.DIRECTORY)], []),
        (BusinessVertical.FOOD, [], ["needs 1 to 3 categories"]),
        (BusinessVertical.FOOD, [(n, CategoryModule.FOOD) for n in (1, 2, 3, 4)], ["needs 1 to 3"]),
        (BusinessVertical.FOOD, [(2, CategoryModule.FOOD)], ["positions"]),  # no primary
        (
            BusinessVertical.FOOD,
            [(1, CategoryModule.FOOD), (3, CategoryModule.FOOD)],
            ["positions"],
        ),
        (BusinessVertical.FOOD, [(1, CategoryModule.DIRECTORY)], ["'food' module"]),
        (BusinessVertical.GENERAL, [(1, CategoryModule.FOOD)], ["'directory' module"]),
        (BusinessVertical.GENERAL, [], ["exactly 1 category"]),
        (BusinessVertical.GENERAL, [(n, CategoryModule.DIRECTORY) for n in (1, 2)], ["exactly 1"]),
    ],
)
def test_the_category_structure_rules(
    vertical: BusinessVertical, rows: list[tuple[int, CategoryModule]], expected: list[str]
) -> None:
    problems = category_structure_problems(vertical, rows)

    assert len(problems) >= len(expected)
    for fragment in expected:
        assert any(fragment in problem for problem in problems), (fragment, problems)
    if not expected:
        assert problems == []


def _every_table_count(session: Session) -> dict[type, int]:
    return {model: count(session, model) for model in (Listing, *DEPENDENT_TABLES)}


def _food_categories(session: Session, *slugs: str) -> dict[str, "Category"]:
    return CategoryRepository(session).list_by_slugs(CategoryModule.FOOD, list(slugs))


@pytest.mark.parametrize(
    "broken",
    [
        # (position, food-category slug) rows the service is forced to write, bypassing its own
        # pre-validation, to prove the post-write check is a real, independent guarantee:
        [(2, "bakeries"), (3, "cafes")],  # no position 1 -> there is no primary category
        [(1, "bakeries"), (3, "cafes")],  # a gap in the positions
        [(1, "bakeries"), (2, "cafes"), (3, "bbq"), (4, "fast-food")],  # a 4th Food category
    ],
    ids=["no-primary", "position-gap", "fourth-category"],
)
def test_a_broken_food_category_structure_rolls_back_the_whole_transaction(
    db_session: Session, owner: User, monkeypatch: pytest.MonkeyPatch, broken: list[tuple[int, str]]
) -> None:
    categories = _food_categories(db_session, *[slug for _, slug in broken])
    forced = [
        ListingCategory(position=position, category_id=categories[slug].id)
        for position, slug in broken
    ]
    monkeypatch.setattr(
        ListingCreationService, "_food_categories", lambda self, food, problems: forced
    )
    before = _every_table_count(db_session)

    # The DATABASE accepts these rows (the generic table has no Food rule)...
    with pytest.raises(ListingInvariantError):  # ...the SERVICE does not, and rolls back
        ListingCreationService(db_session).create_business_listing(food_input(owner))

    assert _every_table_count(db_session) == before  # listing, profiles, menu, history: all gone


def test_a_food_listing_with_a_category_from_another_module_rolls_back(
    db_session: Session, owner: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models import Category

    directory = db_session.scalars(
        select(Category).where(
            Category.module == CategoryModule.DIRECTORY, Category.slug == "pharmacy"
        )
    ).one()
    monkeypatch.setattr(
        ListingCreationService,
        "_food_categories",
        lambda self, food, problems: [ListingCategory(position=1, category_id=directory.id)],
    )
    before = _every_table_count(db_session)

    with pytest.raises(ListingInvariantError, match="'food' module"):
        ListingCreationService(db_session).create_business_listing(food_input(owner))

    assert _every_table_count(db_session) == before


def test_a_general_business_with_two_categories_rolls_back(
    db_session: Session, owner: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models import Category

    pair = db_session.scalars(
        select(Category).where(
            Category.module == CategoryModule.DIRECTORY, Category.slug.in_(["pharmacy", "grocery"])
        )
    ).all()
    monkeypatch.setattr(
        ListingCreationService,
        "_directory_category",
        lambda self, slug, problems: [
            ListingCategory(position=n, category_id=c.id) for n, c in enumerate(pair, start=1)
        ],
    )
    data = BusinessListingInput(
        owner_id=owner.id, title="Shop", area="B-17", category_slug="pharmacy"
    )
    before = _every_table_count(db_session)

    with pytest.raises(ListingInvariantError, match="exactly 1 category"):
        ListingCreationService(db_session).create_business_listing(data)

    assert _every_table_count(db_session) == before


def test_a_valid_food_listing_has_a_primary_category_at_position_1_and_nothing_beyond_three(
    db_session: Session, owner: User
) -> None:
    three = food_input(
        owner,
        food=FoodInput(
            category_slugs=["bbq", "cafes", "bakeries"],
            service_options=[FoodServiceOption.DINE_IN],
        ),
    )

    listing = ListingCreationService(db_session).create_business_listing(three)
    stored = CategoryRepository(db_session).list_for_listing(listing.id)

    assert stored == [(1, CategoryModule.FOOD), (2, CategoryModule.FOOD), (3, CategoryModule.FOOD)]
    assert [c.category.slug for c in listing.categories] == [
        "bbq",
        "cafes",
        "bakeries",
    ]  # primary: bbq
