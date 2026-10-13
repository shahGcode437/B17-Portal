"""Small builders and assertions shared by the database tests."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from sqlalchemy import insert, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    BusinessProfile,
    Category,
    FoodProfile,
    Listing,
    ListingCategory,
    User,
)
from app.models.enums import (
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    ListingKind,
)


@contextmanager
def violates(session: Session, *constraints: str) -> Iterator[None]:
    """Expect the wrapped statements to be rejected by the named database constraint.

    Pass several names only when one bad row legitimately breaks more than one constraint (the
    database reports just one of them).

    The statements run inside their own SAVEPOINT, so only they are rolled back: everything the
    test created before the block is still there afterwards and the test can carry on.
    """
    try:
        with session.begin_nested():
            yield
            session.flush()
    except (IntegrityError, DataError) as error:
        actual = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        assert actual in constraints, (
            f"expected one of {constraints}, the database reported {actual!r}"
        )
    else:
        pytest.fail(f"expected the database to reject this with one of {constraints}")


def raw_insert(session: Session, table: str, **values: object) -> None:
    """INSERT through plain SQL, bypassing the ORM's own value validation.

    The ORM rejects an unknown enum string before it ever reaches PostgreSQL; tests that must
    prove the *database* CHECK constraint use this so the statement is sent as written.
    """
    columns = ", ".join(values)
    placeholders = ", ".join(f":{name}" for name in values)
    session.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"), values)


def make_user(session: Session, *, email: str | None = None, name: str = "Test User") -> User:
    user = User(email=email or f"user-{uuid.uuid4().hex[:10]}@example.test", display_name=name)
    session.add(user)
    session.flush()
    return user


def make_listing(
    session: Session,
    *,
    kind: ListingKind = ListingKind.BUSINESS,
    owner: User | None = None,
    title: str = "Test Listing",
) -> Listing:
    listing = Listing(
        kind=kind, owner_id=owner.id if owner else None, title=title, area="B-17, Block C"
    )
    session.add(listing)
    session.flush()
    return listing


def make_business(
    session: Session,
    *,
    vertical: BusinessVertical = BusinessVertical.GENERAL,
    owner: User | None = None,
) -> Listing:
    """A business listing with its business profile (no Food profile)."""
    listing = make_listing(session, kind=ListingKind.BUSINESS, owner=owner)
    # Core insert so the test controls every column (no ORM relationship sync in the way).
    session.execute(
        insert(BusinessProfile).values(
            listing_id=listing.id, kind="business", vertical=vertical.value
        )
    )
    session.flush()
    return listing


def make_food_business(session: Session, *, owner: User | None = None) -> Listing:
    listing = make_business(session, vertical=BusinessVertical.FOOD, owner=owner)
    session.execute(
        insert(FoodProfile).values(
            listing_id=listing.id,
            vertical="food",
            service_options=[FoodServiceOption.TAKEAWAY.value],
        )
    )
    session.flush()
    return listing


def category(session: Session, module: CategoryModule, slug: str) -> Category:
    from sqlalchemy import select

    return session.scalars(
        select(Category).where(Category.module == module, Category.slug == slug)
    ).one()


def attach_category(session: Session, listing: Listing, cat: Category, position: int) -> None:
    session.execute(
        insert(ListingCategory).values(listing_id=listing.id, category_id=cat.id, position=position)
    )
    session.flush()
