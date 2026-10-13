"""Dynamic, module-scoped taxonomy and the normalized listing<->category relation.

Structurally guaranteed by PostgreSQL (tested here): module-scoped unique slugs, a parent in the
same module, valid references, no category twice on a listing, no position twice, position >= 1.
The relation is GENERIC: it serves every listing kind, so it imposes no maximum number of
categories (Food's "1..3" is a Food rule, enforced by the service).
NOT guaranteed by PostgreSQL (the service's job, tested in test_listing_creation_service): at least
one category, the per-kind count (Food 1..3, others exactly 1), contiguous positions from 1 so a
primary exists, and that a listing's categories belong to the right module.
"""

import uuid

import pytest
from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.models import Category, ListingCategory
from app.models.enums import CategoryModule, ListingKind
from app.repositories.taxonomy import CategoryRepository
from tests.db.helpers import attach_category, category, make_listing, raw_insert, violates


def new_category(
    session: Session,
    *,
    module: CategoryModule = CategoryModule.DIRECTORY,
    slug: str | None = None,
    **extra: object,
) -> Category:
    row = Category(
        module=module, slug=slug or f"cat-{uuid.uuid4().hex[:8]}", name="Test category", **extra
    )
    session.add(row)
    session.flush()
    return row


# -- categories ----------------------------------------------------------------------------------


def test_slugs_are_unique_per_module_not_globally(db_session: Session) -> None:
    new_category(db_session, module=CategoryModule.FOOD, slug="special")

    new_category(db_session, module=CategoryModule.DIRECTORY, slug="special")  # other module: fine
    with violates(db_session, "uq_categories_module_slug"):
        db_session.add(Category(module=CategoryModule.FOOD, slug="special", name="Duplicate"))


@pytest.mark.parametrize(
    "slug", ["Bakeries", "has space", "trailing-", "-leading", "double--dash", "under_score", ""]
)
def test_slug_format_is_enforced(db_session: Session, slug: str) -> None:
    with violates(db_session, "ck_categories_slug_format"):
        db_session.add(Category(module=CategoryModule.FOOD, slug=slug, name="Bad"))


def test_the_module_must_be_one_of_the_code_defined_modules(db_session: Session) -> None:
    """A category cannot invent a product module; adding one is a code + migration change."""
    with violates(db_session, "ck_categories_module_valid"):
        raw_insert(
            db_session,
            "categories",
            id=uuid.uuid4(),
            module="marketplace",
            slug="phones",
            name="Phones",
        )


def test_defaults_active_and_ordering_and_timestamps(db_session: Session) -> None:
    row = new_category(db_session)
    db_session.refresh(row)

    assert row.is_active is True and row.display_order == 0
    assert row.created_at.tzinfo is not None and row.id.version == 4


def test_a_child_category_must_belong_to_the_same_module_as_its_parent(db_session: Session) -> None:
    parent = new_category(db_session, module=CategoryModule.SERVICES)

    new_category(db_session, module=CategoryModule.SERVICES, parent_id=parent.id)  # same module
    with violates(db_session, "fk_categories_parent_id_module_categories"):
        new_category(db_session, module=CategoryModule.FOOD, parent_id=parent.id)


def test_a_parent_must_exist_and_cannot_be_the_category_itself(db_session: Session) -> None:
    with violates(db_session, "fk_categories_parent_id_module_categories"):
        new_category(db_session, parent_id=uuid.uuid4())
    row_id = uuid.uuid4()
    with violates(db_session, "ck_categories_parent_not_self"):
        raw_insert(
            db_session,
            "categories",
            id=row_id,
            module="food",
            slug="self-parent",
            name="Loop",
            parent_id=row_id,
        )


def test_a_category_with_children_cannot_be_deleted(db_session: Session) -> None:
    parent = new_category(db_session)
    new_category(db_session, parent_id=parent.id)

    with violates(db_session, "fk_categories_parent_id_module_categories"):
        db_session.execute(delete(Category).where(Category.id == parent.id))


def test_a_category_in_use_cannot_be_deleted_only_deactivated(db_session: Session) -> None:
    listing = make_listing(db_session)
    used = new_category(db_session)
    attach_category(db_session, listing, used, 1)

    with violates(db_session, "fk_listing_categories_category_id_categories"):
        db_session.execute(delete(Category).where(Category.id == used.id))

    used.is_active = False  # the supported way to retire a category: existing links keep working
    db_session.flush()
    assert db_session.get(ListingCategory, (listing.id, 1)) is not None


def test_the_active_taxonomy_of_a_module_is_returned_in_display_order(db_session: Session) -> None:
    repo = CategoryRepository(db_session)
    second = new_category(
        db_session, module=CategoryModule.NEWS, slug="zz-second", display_order=99
    )
    first = new_category(db_session, module=CategoryModule.NEWS, slug="zz-first", display_order=98)
    retired = new_category(
        db_session, module=CategoryModule.NEWS, slug="zz-retired", display_order=0
    )
    retired.is_active = False
    db_session.flush()

    active = [c.slug for c in repo.list_by_module(CategoryModule.NEWS)]
    everything = [c.slug for c in repo.list_by_module(CategoryModule.NEWS, active_only=False)]

    assert active[-2:] == [first.slug, second.slug]
    assert retired.slug not in active and retired.slug in everything
    assert everything[0] == retired.slug  # display_order 0 sorts first


# -- listing_categories --------------------------------------------------------------------------


def test_a_listing_can_hold_three_categories_and_position_1_is_primary(db_session: Session) -> None:
    listing = make_listing(db_session)
    slugs = ["bakeries", "cafes", "bbq"]
    for position, slug in enumerate(slugs, start=1):
        attach_category(
            db_session, listing, category(db_session, CategoryModule.FOOD, slug), position
        )
    db_session.expire_all()

    attached = db_session.scalars(
        select(ListingCategory)
        .where(ListingCategory.listing_id == listing.id)
        .order_by(ListingCategory.position)
    ).all()
    assert [lc.category.slug for lc in attached] == slugs
    assert attached[0].position == 1  # the primary category


@pytest.mark.parametrize("position", [0, -1, -10])
def test_a_position_must_be_at_least_1(db_session: Session, position: int) -> None:
    listing = make_listing(db_session)

    with violates(db_session, "ck_listing_categories_position_positive"):
        db_session.execute(
            insert(ListingCategory).values(
                listing_id=listing.id,
                category_id=category(db_session, CategoryModule.FOOD, "bakeries").id,
                position=position,
            )
        )


def test_the_generic_relation_imposes_no_food_only_maximum_on_other_listing_kinds(
    db_session: Session,
) -> None:
    """ "1..3 categories" is a FOOD product rule. The shared table must not apply it to a Provider,
    a Property or any future kind, so the database accepts five positions on one listing."""
    provider = make_listing(db_session, kind=ListingKind.PROVIDER)
    services = ["construction", "electrical", "solar", "architecture", "painting"]
    for position, slug in enumerate(services, start=1):
        attach_category(
            db_session, provider, category(db_session, CategoryModule.SERVICES, slug), position
        )
    db_session.expire_all()

    stored = db_session.scalars(
        select(ListingCategory.position).where(ListingCategory.listing_id == provider.id)
    ).all()
    assert sorted(stored) == [1, 2, 3, 4, 5]


def test_a_category_cannot_be_attached_twice_to_the_same_listing(db_session: Session) -> None:
    listing = make_listing(db_session)
    bakeries = category(db_session, CategoryModule.FOOD, "bakeries")
    attach_category(db_session, listing, bakeries, 1)

    with violates(db_session, "uq_listing_categories_listing_id_category_id"):
        attach_category(db_session, listing, bakeries, 2)


def test_two_categories_cannot_share_a_position_on_one_listing(db_session: Session) -> None:
    listing = make_listing(db_session)
    attach_category(db_session, listing, category(db_session, CategoryModule.FOOD, "bakeries"), 1)

    with violates(db_session, "pk_listing_categories"):
        attach_category(db_session, listing, category(db_session, CategoryModule.FOOD, "cafes"), 1)


def test_the_same_category_may_be_used_by_many_listings(db_session: Session) -> None:
    bakeries = category(db_session, CategoryModule.FOOD, "bakeries")
    for _ in range(3):
        attach_category(db_session, make_listing(db_session), bakeries, 1)


def test_attached_categories_must_reference_a_real_listing_and_category(
    db_session: Session,
) -> None:
    listing = make_listing(db_session)

    with violates(db_session, "fk_listing_categories_category_id_categories"):
        db_session.execute(
            insert(ListingCategory).values(
                listing_id=listing.id, category_id=uuid.uuid4(), position=1
            )
        )
    with violates(db_session, "fk_listing_categories_listing_id_listings"):
        db_session.execute(
            insert(ListingCategory).values(
                listing_id=uuid.uuid4(),
                category_id=category(db_session, CategoryModule.FOOD, "bakeries").id,
                position=1,
            )
        )


def test_the_database_does_not_enforce_what_only_the_service_can(db_session: Session) -> None:
    """Documents the boundary: row-local rules are the database's, cross-row rules the service's.

    PostgreSQL happily stores a listing with NO category, or with a lone category at position 2
    (so "position 1 is the primary" has no primary), or a Food category on a Directory-style
    listing. ListingCreationService is what prevents those (see its tests).
    """
    no_category = make_listing(db_session)
    gap = make_listing(db_session)
    attach_category(db_session, gap, category(db_session, CategoryModule.FOOD, "cafes"), 2)
    four = make_listing(db_session)  # more than Food's maximum: a Food rule, not a database rule
    for position, slug in enumerate(["bakeries", "cafes", "bbq", "fast-food"], start=1):
        attach_category(db_session, four, category(db_session, CategoryModule.FOOD, slug), position)

    count = db_session.scalar(
        select(func.count())
        .select_from(ListingCategory)
        .where(ListingCategory.listing_id == no_category.id)
    )
    assert count == 0
    assert db_session.get(ListingCategory, (gap.id, 1)) is None  # no primary, and no error
    assert db_session.get(ListingCategory, (four.id, 4)) is not None  # a 4th category, no error
