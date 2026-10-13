"""The base ``listings`` table and the subtype tables (business excluded: see test_food_schema)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.models import (
    BusinessProfile,
    Listing,
    ListingCategory,
    PropertyProfile,
    SavedItem,
    TutorProfile,
)
from app.models.enums import (
    CategoryModule,
    Furnishing,
    ListingKind,
    ListingStatus,
    PropertyListingType,
)
from tests.db.helpers import (
    attach_category,
    category,
    make_listing,
    make_user,
    raw_insert,
    violates,
)


def test_a_listing_gets_a_uuid4_id_and_the_documented_defaults(db_session: Session) -> None:
    listing = make_listing(db_session)
    db_session.refresh(listing)

    assert listing.id.version == 4
    assert listing.status is ListingStatus.PENDING
    assert listing.revision == 1  # the concurrency counter starts at 1
    assert listing.is_featured is False
    assert listing.tags == []
    assert listing.owner_id is None  # admin-curated / unclaimed content is allowed
    assert listing.created_at.tzinfo is not None and listing.submitted_at.tzinfo is not None


def test_updated_at_is_refreshed_when_a_row_is_updated(db_session: Session) -> None:
    listing = make_listing(db_session)
    long_ago = datetime.now(UTC) - timedelta(days=30)
    db_session.execute(update(Listing).where(Listing.id == listing.id).values(updated_at=long_ago))
    db_session.refresh(listing)
    assert listing.updated_at == long_ago

    listing.title = "Renamed"
    db_session.flush()
    db_session.refresh(listing)

    assert listing.updated_at > long_ago


@pytest.mark.parametrize(
    ("column", "value", "constraint"),
    [
        ("kind", "food", "ck_listings_kind_valid"),  # Food is a business vertical, not a kind
        ("kind", "service", "ck_listings_kind_valid"),  # the frontend vocabulary is `provider`
        ("status", "draft", "ck_listings_status_valid"),  # no draft state
        ("status", "published", "ck_listings_status_valid"),
        ("title", "   ", "ck_listings_title_not_blank"),
        ("area", "", "ck_listings_area_not_blank"),
        ("revision", 0, "ck_listings_revision_positive"),
    ],
)
def test_listing_values_are_constrained(
    db_session: Session, column: str, value: object, constraint: str
) -> None:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "kind": "business",
        "title": "Valid",
        "area": "B-17",
    }
    values[column] = value

    with violates(db_session, constraint):
        raw_insert(db_session, "listings", **values)


def test_the_listing_owner_must_exist(db_session: Session) -> None:
    with violates(db_session, "fk_listings_owner_id_users"):
        db_session.execute(
            insert(Listing).values(
                id=uuid.uuid4(), kind="business", title="T", area="A", owner_id=uuid.uuid4()
            )
        )


def test_only_providers_and_businesses_can_be_featured(db_session: Session) -> None:
    for kind in ("provider", "business"):
        db_session.execute(
            insert(Listing).values(
                id=uuid.uuid4(), kind=kind, title="T", area="A", is_featured=True
            )
        )
    for kind in ("tutor", "property"):
        with violates(db_session, "ck_listings_featured_kinds"):
            db_session.execute(
                insert(Listing).values(
                    id=uuid.uuid4(), kind=kind, title="T", area="A", is_featured=True
                )
            )


def test_title_length_is_capped(db_session: Session) -> None:
    with pytest.raises(DataError):
        make_listing(db_session, title="x" * 101)


def test_tags_are_a_postgres_array(db_session: Session) -> None:
    listing = Listing(
        kind=ListingKind.PROVIDER, title="Solar", area="B-17", tags=["solar", "net metering"]
    )
    db_session.add(listing)
    db_session.flush()
    db_session.expire(listing)

    assert listing.tags == ["solar", "net metering"]


# -- subtype integrity: a subtype row only exists for a listing of the matching kind -----------


@pytest.mark.parametrize(
    ("listing_kind", "subtype", "constraint"),
    [
        (ListingKind.PROPERTY, BusinessProfile, "fk_business_profiles_listing_id_kind_listings"),
        (ListingKind.TUTOR, BusinessProfile, "fk_business_profiles_listing_id_kind_listings"),
        (ListingKind.BUSINESS, PropertyProfile, "fk_property_profiles_listing_id_kind_listings"),
        (ListingKind.BUSINESS, TutorProfile, "fk_tutor_profiles_listing_id_kind_listings"),
        (ListingKind.PROVIDER, TutorProfile, "fk_tutor_profiles_listing_id_kind_listings"),
    ],
)
def test_a_subtype_row_cannot_attach_to_a_listing_of_another_kind(
    db_session: Session, listing_kind: ListingKind, subtype: type, constraint: str
) -> None:
    listing = make_listing(db_session, kind=listing_kind)
    values: dict[str, object] = {"listing_id": listing.id}
    if subtype is PropertyProfile:
        values |= {"kind": "property", "listing_type": "sale", "price_text": "PKR 1"}
    elif subtype is TutorProfile:
        values |= {"kind": "tutor", "grade": "Grade 9"}
    else:
        values |= {"kind": "business"}

    with violates(db_session, constraint):
        db_session.execute(insert(subtype).values(**values))


def test_a_subtype_row_cannot_lie_about_its_own_kind(db_session: Session) -> None:
    listing = make_listing(db_session, kind=ListingKind.PROPERTY)

    with violates(db_session, "ck_business_profiles_kind_is_business"):
        db_session.execute(insert(BusinessProfile).values(listing_id=listing.id, kind="property"))


def test_there_is_at_most_one_subtype_row_per_listing(db_session: Session) -> None:
    listing = make_listing(db_session, kind=ListingKind.TUTOR)
    db_session.add(TutorProfile(listing_id=listing.id, grade="Grade 9"))
    db_session.flush()

    with violates(db_session, "pk_tutor_profiles"):
        db_session.execute(
            insert(TutorProfile).values(listing_id=listing.id, kind="tutor", grade="Grade 10")
        )


def test_provider_listings_have_no_subtype_table(db_session: Session) -> None:
    """A provider is the base row plus its category — nothing else to store."""
    provider = make_listing(db_session, kind=ListingKind.PROVIDER)
    attach_category(db_session, provider, category(db_session, CategoryModule.SERVICES, "solar"), 1)

    stored = db_session.get(Listing, provider.id)
    assert stored is not None
    assert (
        stored.business is None and stored.property_profile is None and stored.tutor_profile is None
    )


# -- property and tutor columns ----------------------------------------------------------------


def test_property_profile_accepts_the_documented_values(db_session: Session) -> None:
    listing = make_listing(db_session, kind=ListingKind.PROPERTY)
    db_session.add(
        PropertyProfile(
            listing_id=listing.id,
            listing_type=PropertyListingType.RENT,
            price_text="PKR 85,000 / month",
            bedrooms=3,
            furnished=Furnishing.SEMI_FURNISHED,
        )
    )
    db_session.flush()
    db_session.expire_all()

    profile = db_session.get(PropertyProfile, listing.id)
    assert profile is not None
    assert (profile.listing_type, profile.bedrooms, profile.furnished) == (
        PropertyListingType.RENT,
        3,
        Furnishing.SEMI_FURNISHED,
    )


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"listing_type": "lease"}, "ck_property_profiles_listing_type_valid"),
        ({"furnished": "Partly"}, "ck_property_profiles_furnished_valid"),
        ({"bedrooms": -1}, "ck_property_profiles_bedrooms_non_negative"),
        ({"price_text": " "}, "ck_property_profiles_price_text_not_blank"),
    ],
)
def test_property_values_are_constrained(
    db_session: Session, overrides: dict[str, object], constraint: str
) -> None:
    listing = make_listing(db_session, kind=ListingKind.PROPERTY)
    values: dict[str, object] = {
        "listing_id": listing.id,
        "kind": "property",
        "listing_type": "sale",
        "price_text": "PKR 2.2 Cr",
    } | overrides

    with violates(db_session, constraint):
        raw_insert(db_session, "property_profiles", **values)


def test_optional_property_fields_may_be_absent(db_session: Session) -> None:
    listing = make_listing(db_session, kind=ListingKind.PROPERTY)
    db_session.add(
        PropertyProfile(
            listing_id=listing.id, listing_type=PropertyListingType.SALE, price_text="PKR 1 Cr"
        )
    )
    db_session.flush()
    db_session.expire_all()

    profile = db_session.get(PropertyProfile, listing.id)
    assert profile is not None and profile.bedrooms is None and profile.furnished is None


# -- hard delete (an exceptional ops action) cascades what has no meaning without the listing ---


def test_hard_deleting_a_listing_removes_its_dependent_rows(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, kind=ListingKind.PROPERTY, owner=owner)
    db_session.add(
        PropertyProfile(
            listing_id=listing.id, listing_type=PropertyListingType.SALE, price_text="PKR 1"
        )
    )
    attach_category(db_session, listing, category(db_session, CategoryModule.PROPERTY, "house"), 1)
    db_session.add(SavedItem(user_id=owner.id, listing_id=listing.id))
    db_session.flush()

    db_session.execute(delete(Listing).where(Listing.id == listing.id))

    for model in (PropertyProfile, ListingCategory, SavedItem):
        assert db_session.scalars(select(model).where(model.listing_id == listing.id)).all() == []
