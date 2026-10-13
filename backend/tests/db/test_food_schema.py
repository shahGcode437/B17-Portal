"""Food & Dining stays a *vertical of Business*; the database enforces the Food relationships.

Guaranteed by PostgreSQL (tested here): a Food profile can only exist for a business whose vertical
is ``food``; service options are a non-empty subset of the canonical set; a Food profile has at
most 8 menu items, with unique positions. NOT guaranteed by PostgreSQL (the service's job, see
test_listing_creation_service): that a ``vertical='food'`` business actually *has* a Food profile
and 1..3 Food categories.
"""

import pytest
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.models import BusinessProfile, FoodMenuItem, FoodProfile, Listing
from app.models.enums import BusinessVertical
from tests.db.helpers import (
    make_business,
    make_food_business,
    raw_insert,
    violates,
)

FK_FOOD_ON_BUSINESS = "fk_food_profiles_listing_id_vertical_business_profiles"


def test_food_is_a_business_vertical_not_a_listing_kind(db_session: Session) -> None:
    listing = make_food_business(db_session)

    stored = db_session.get(Listing, listing.id)
    assert stored is not None
    assert stored.kind.value == "business"
    assert stored.business is not None and stored.business.vertical is BusinessVertical.FOOD
    assert stored.business.food is not None


def test_a_food_profile_can_attach_to_a_food_business(db_session: Session) -> None:
    listing = make_business(db_session, vertical=BusinessVertical.FOOD)

    db_session.execute(
        insert(FoodProfile).values(
            listing_id=listing.id, vertical="food", service_options=["dine-in", "delivery"]
        )
    )
    db_session.flush()

    assert db_session.get(FoodProfile, listing.id) is not None


def test_a_food_profile_cannot_attach_to_a_general_business(db_session: Session) -> None:
    """The approved composite-FK mechanism: (listing_id, 'food') must exist in business_profiles."""
    listing = make_business(db_session, vertical=BusinessVertical.GENERAL)

    with violates(db_session, FK_FOOD_ON_BUSINESS):
        db_session.execute(
            insert(FoodProfile).values(
                listing_id=listing.id, vertical="food", service_options=["takeaway"]
            )
        )


def test_a_food_profile_cannot_claim_to_be_general_either(db_session: Session) -> None:
    listing = make_business(db_session, vertical=BusinessVertical.GENERAL)

    with violates(db_session, "ck_food_profiles_vertical_is_food"):
        db_session.execute(
            insert(FoodProfile).values(
                listing_id=listing.id, vertical="general", service_options=["takeaway"]
            )
        )


def test_a_food_profile_cannot_attach_to_a_listing_that_is_not_a_business(
    db_session: Session,
) -> None:
    from app.models.enums import ListingKind
    from tests.db.helpers import make_listing

    tutor = make_listing(db_session, kind=ListingKind.TUTOR)

    with violates(db_session, FK_FOOD_ON_BUSINESS):
        db_session.execute(
            insert(FoodProfile).values(
                listing_id=tutor.id, vertical="food", service_options=["takeaway"]
            )
        )


def test_a_business_cannot_stop_being_food_while_it_still_has_a_food_profile(
    db_session: Session,
) -> None:
    """Switching Food -> General is a service transaction: it must delete the Food data first."""
    listing = make_food_business(db_session)

    with violates(db_session, FK_FOOD_ON_BUSINESS):
        db_session.execute(
            update(BusinessProfile)
            .where(BusinessProfile.listing_id == listing.id)
            .values(vertical="general")
        )

    # ...and once the Food profile is gone, the switch is allowed.
    db_session.execute(delete(FoodProfile).where(FoodProfile.listing_id == listing.id))
    db_session.execute(
        update(BusinessProfile)
        .where(BusinessProfile.listing_id == listing.id)
        .values(vertical="general")
    )
    db_session.flush()


def test_a_business_must_have_a_valid_vertical(db_session: Session) -> None:
    from tests.db.helpers import make_listing

    listing = make_listing(db_session)

    with violates(db_session, "ck_business_profiles_vertical_valid"):
        raw_insert(
            db_session,
            "business_profiles",
            listing_id=listing.id,
            kind="business",
            vertical="bakery",
        )


# -- service options -----------------------------------------------------------------------------


def test_service_options_cannot_be_empty(db_session: Session) -> None:
    listing = make_business(db_session, vertical=BusinessVertical.FOOD)

    with violates(db_session, "ck_food_profiles_service_options_not_empty"):
        db_session.execute(
            insert(FoodProfile).values(listing_id=listing.id, vertical="food", service_options=[])
        )


@pytest.mark.parametrize(
    "bad", [["delivery-by-portal"], ["takeaway", "drive-through"], ["Dine-in"]]
)
def test_service_options_must_be_canonical(db_session: Session, bad: list[str]) -> None:
    listing = make_business(db_session, vertical=BusinessVertical.FOOD)

    with violates(db_session, "ck_food_profiles_service_options_valid"):
        db_session.execute(
            insert(FoodProfile).values(listing_id=listing.id, vertical="food", service_options=bad)
        )


def test_hours_note_is_capped_at_80_characters(db_session: Session) -> None:
    listing = make_business(db_session, vertical=BusinessVertical.FOOD)

    with pytest.raises(DataError):
        db_session.execute(
            insert(FoodProfile).values(
                listing_id=listing.id,
                vertical="food",
                service_options=["takeaway"],
                hours_note="x" * 81,
            )
        )


def test_services_can_be_filtered_by_a_single_option(db_session: Session) -> None:
    """The approved filter (`service=delivery`) is an array-containment query on the GIN index."""
    delivery = make_business(db_session, vertical=BusinessVertical.FOOD)
    dine_in = make_business(db_session, vertical=BusinessVertical.FOOD)
    for listing, options in ((delivery, ["takeaway", "delivery"]), (dine_in, ["dine-in"])):
        db_session.execute(
            insert(FoodProfile).values(
                listing_id=listing.id, vertical="food", service_options=options
            )
        )

    found = db_session.scalars(
        select(FoodProfile.listing_id).where(FoodProfile.service_options.contains(["delivery"]))
    ).all()

    assert delivery.id in found and dine_in.id not in found


# -- menu items: at most 8, unique positions ------------------------------------------------------


def _menu_item(listing_id: object, position: int, name: str = "Item") -> dict[str, object]:
    return {
        "id": __import__("uuid").uuid4(),
        "listing_id": listing_id,
        "position": position,
        "name": name,
    }


def test_a_food_listing_can_hold_exactly_eight_menu_items(db_session: Session) -> None:
    listing = make_food_business(db_session)

    db_session.execute(
        insert(FoodMenuItem), [_menu_item(listing.id, position) for position in range(1, 9)]
    )
    db_session.flush()

    count = db_session.scalars(
        select(FoodMenuItem.position).where(FoodMenuItem.listing_id == listing.id)
    ).all()
    assert sorted(count) == list(range(1, 9))


@pytest.mark.parametrize("position", [0, 9, -1, 100])
def test_menu_positions_outside_1_to_8_are_rejected_so_there_cannot_be_a_ninth_item(
    db_session: Session, position: int
) -> None:
    listing = make_food_business(db_session)

    with violates(db_session, "ck_food_menu_items_position_range"):
        db_session.execute(insert(FoodMenuItem).values(**_menu_item(listing.id, position)))


def test_the_range_check_alone_would_allow_duplicates_so_positions_are_also_unique(
    db_session: Session,
) -> None:
    """CHECK 1..8 caps the *range*; UNIQUE(listing_id, position) is what makes that a cap of 8."""
    listing = make_food_business(db_session)
    db_session.execute(insert(FoodMenuItem).values(**_menu_item(listing.id, 3)))

    with violates(db_session, "uq_food_menu_items_listing_id_position"):
        db_session.execute(insert(FoodMenuItem).values(**_menu_item(listing.id, 3, "Another")))


def test_the_same_position_may_be_used_by_different_listings(db_session: Session) -> None:
    first, second = make_food_business(db_session), make_food_business(db_session)

    db_session.execute(insert(FoodMenuItem).values(**_menu_item(first.id, 1)))
    db_session.execute(insert(FoodMenuItem).values(**_menu_item(second.id, 1)))
    db_session.flush()


def test_a_menu_item_must_have_a_name_and_belong_to_a_food_profile(db_session: Session) -> None:
    food = make_food_business(db_session)
    general = make_business(db_session)

    with violates(db_session, "ck_food_menu_items_name_not_blank"):
        db_session.execute(insert(FoodMenuItem).values(**_menu_item(food.id, 1, "   ")))
    with violates(db_session, "fk_food_menu_items_listing_id_food_profiles"):
        db_session.execute(insert(FoodMenuItem).values(**_menu_item(general.id, 1)))


def test_menu_item_text_limits_follow_the_frontend_rules(db_session: Session) -> None:
    listing = make_food_business(db_session)

    for field, too_long in (
        ("name", 61),
        ("section", 41),
        ("description", 121),
        ("price_text", 25),
    ):
        values = _menu_item(listing.id, 1) | {field: "x" * too_long}
        with pytest.raises(DataError):
            db_session.execute(insert(FoodMenuItem).values(**values))
        db_session.rollback()
        listing = make_food_business(db_session)


def test_removing_a_food_profile_removes_its_menu_items(db_session: Session) -> None:
    listing = make_food_business(db_session)
    db_session.execute(insert(FoodMenuItem).values(**_menu_item(listing.id, 1)))

    db_session.execute(delete(FoodProfile).where(FoodProfile.listing_id == listing.id))

    assert (
        db_session.scalars(select(FoodMenuItem).where(FoodMenuItem.listing_id == listing.id)).all()
        == []
    )


def test_hard_deleting_the_listing_removes_the_whole_food_chain(db_session: Session) -> None:
    listing = make_food_business(db_session)
    db_session.execute(insert(FoodMenuItem).values(**_menu_item(listing.id, 1)))

    db_session.execute(delete(Listing).where(Listing.id == listing.id))

    for model in (BusinessProfile, FoodProfile, FoodMenuItem):
        assert db_session.scalars(select(model).where(model.listing_id == listing.id)).all() == []
