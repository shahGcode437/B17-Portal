"""The shared listing location columns on real PostgreSQL (docs/backend/LOCATION_MAP.md §3, §7).

Database constraints, the database-GENERATED public coordinates (read back from PostgreSQL — never
recomputed in Python as the only proof), write protection of the generated columns, the legacy
state, and the ORM guard that keeps the private columns out of every public code path.
"""

import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import Connection, event, text
from sqlalchemy.exc import DBAPIError, InvalidRequestError
from sqlalchemy.orm import Session

from app.models import Listing
from app.models.enums import ListingKind, ListingStatus, LocationVisibility
from app.repositories.listing_reads import ListingReadRepository
from tests.db.helpers import raw_insert, violates

D = Decimal
EXACT = LocationVisibility.EXACT
APPROXIMATE = LocationVisibility.APPROXIMATE
AREA_ONLY = LocationVisibility.AREA_ONLY


def located(
    session: Session,
    visibility: LocationVisibility,
    latitude: str | None = None,
    longitude: str | None = None,
    **extra: Any,
) -> Listing:
    listing = Listing(
        kind=ListingKind.PROVIDER,
        status=ListingStatus.APPROVED,
        title="Located",
        area="B-17",
        location_visibility=visibility,
        latitude=D(latitude) if latitude is not None else None,
        longitude=D(longitude) if longitude is not None else None,
        **extra,
    )
    session.add(listing)
    session.flush()
    return listing


def public_point(session: Session, listing: Listing) -> tuple[Decimal | None, Decimal | None]:
    row = session.execute(
        text("SELECT public_latitude, public_longitude FROM listings WHERE id = :id"),
        {"id": listing.id},
    ).one()
    return row[0], row[1]


# -- constraints ----------------------------------------------------------------------------------


@pytest.mark.parametrize("latitude", ["-90.000001", "90.000001", "-90.5", "91"])
def test_latitude_outside_minus_90_to_90_is_rejected(db_session: Session, latitude: str) -> None:
    with violates(db_session, "ck_listings_latitude_range"):
        located(db_session, EXACT, latitude, "72.5")


@pytest.mark.parametrize("longitude", ["-180.000001", "180.000001", "-181", "200"])
def test_longitude_outside_minus_180_to_180_is_rejected(
    db_session: Session, longitude: str
) -> None:
    with violates(db_session, "ck_listings_longitude_range"):
        located(db_session, EXACT, "33.5", longitude)


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [("90", "180"), ("-90", "-180"), ("0", "0"), ("33.700000", "73.050000")],
)
def test_the_boundary_values_and_zero_are_accepted_no_geofence(
    db_session: Session, latitude: str, longitude: str
) -> None:
    """Only the universal ranges are validated: (0, 0) is not rejected, there is no B-17 box."""
    listing = located(db_session, EXACT, latitude, longitude)

    assert public_point(db_session, listing) == (D(latitude), D(longitude))


def test_one_coordinate_without_the_other_is_rejected(db_session: Session) -> None:
    with violates(db_session, "ck_listings_coordinates_pair"):
        located(db_session, EXACT, "33.5", None)
    with violates(db_session, "ck_listings_coordinates_pair"):
        located(db_session, EXACT, None, "72.5")


@pytest.mark.parametrize("visibility", [EXACT, APPROXIMATE])
def test_a_point_mode_without_a_point_is_rejected(
    db_session: Session, visibility: LocationVisibility
) -> None:
    with violates(db_session, "ck_listings_visibility_matches_point"):
        located(db_session, visibility)


def test_area_only_can_never_store_an_exact_point(db_session: Session) -> None:
    with violates(db_session, "ck_listings_visibility_matches_point"):
        located(db_session, AREA_ONLY, "33.5", "72.5")


def test_valid_exact_approximate_and_legacy_area_only_rows_are_accepted(
    db_session: Session,
) -> None:
    exact = located(db_session, EXACT, "33.701234", "73.051234", address="Shop 4", block="C")
    approximate = located(db_session, APPROXIMATE, "33.701234", "73.051234")
    legacy = located(db_session, AREA_ONLY)

    assert all(row.id for row in (exact, approximate, legacy))


def test_a_listing_created_without_any_location_is_a_legacy_area_only_row(
    db_session: Session,
) -> None:
    listing = Listing(kind=ListingKind.PROVIDER, title="Plain", area="B-17, Block C")
    db_session.add(listing)
    db_session.flush()

    row = db_session.execute(
        text(
            "SELECT location_visibility, block, address, landmark, latitude, longitude, "
            "public_latitude, public_longitude FROM listings WHERE id = :id"
        ),
        {"id": listing.id},
    ).one()
    assert tuple(row) == ("area_only", None, None, None, None, None, None, None)


@pytest.mark.parametrize("column", ["block", "address", "landmark"])
def test_location_text_is_null_or_non_blank(db_session: Session, column: str) -> None:
    with violates(db_session, f"ck_listings_{column}_not_blank"):
        located(db_session, AREA_ONLY, **{column: "   "})


def test_visibility_is_a_closed_set_in_the_database(db_session: Session) -> None:
    with violates(db_session, "ck_listings_location_visibility_valid"):
        raw_insert(
            db_session,
            "listings",
            id=uuid.uuid4(),
            kind="provider",
            status="approved",
            title="x",
            area="B-17",
            location_visibility="everyone",
        )


def test_the_database_does_not_require_a_point_for_a_property(db_session: Session) -> None:
    """Per-kind requiredness is a write-service rule; legacy Property rows have no point."""
    listing = Listing(
        kind=ListingKind.PROPERTY, title="Legacy house", area="B-17, Block C (Demo Area)"
    )
    db_session.add(listing)
    db_session.flush()

    assert public_point(db_session, listing) == (None, None)


# -- the generated public coordinates ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("latitude", "longitude", "expected_lat", "expected_lng"),
    [
        ("33.123456", "72.987654", "33.12", "72.99"),
        ("33.124999", "72.984999", "33.12", "72.98"),  # just below the half
        ("33.125000", "72.985000", "33.13", "72.99"),  # exactly the half: away from zero
        ("33.125001", "72.985001", "33.13", "72.99"),
        ("-33.125000", "-72.985000", "-33.13", "-72.99"),  # negative half: away from zero
        ("-33.124999", "-72.984999", "-33.12", "-72.98"),
        ("-0.004000", "-0.005000", "0.00", "-0.01"),
        ("89.995000", "179.995000", "90.00", "180.00"),  # rounds up to the limit, still valid
        ("-89.995000", "-179.995000", "-90.00", "-180.00"),
        ("0.000000", "0.000000", "0.00", "0.00"),
    ],
)
def test_approximate_public_coordinates_are_the_two_decimal_rounding(
    db_session: Session, latitude: str, longitude: str, expected_lat: str, expected_lng: str
) -> None:
    listing = located(db_session, APPROXIMATE, latitude, longitude)

    # Read back from PostgreSQL ...
    assert public_point(db_session, listing) == (D(expected_lat), D(expected_lng))
    # ... and cross-checked against PostgreSQL's own round(), in SQL.
    assert db_session.execute(
        text(
            "SELECT public_latitude = round(latitude, 2) AND public_longitude = round(longitude, 2)"
            " FROM listings WHERE id = :id"
        ),
        {"id": listing.id},
    ).scalar_one()


def test_exact_public_coordinates_equal_the_stored_point(db_session: Session) -> None:
    listing = located(db_session, EXACT, "33.701234", "73.051234")

    assert public_point(db_session, listing) == (D("33.701234"), D("73.051234"))


def test_area_only_has_no_public_point(db_session: Session) -> None:
    listing = located(db_session, AREA_ONLY, address="Private address")

    assert public_point(db_session, listing) == (None, None)


def test_the_public_point_follows_the_visibility_automatically(db_session: Session) -> None:
    listing = located(db_session, EXACT, "33.704567", "73.055678")
    assert public_point(db_session, listing) == (D("33.704567"), D("73.055678"))

    db_session.execute(
        text("UPDATE listings SET location_visibility = 'approximate' WHERE id = :id"),
        {"id": listing.id},
    )
    assert public_point(db_session, listing) == (D("33.70"), D("73.06"))

    db_session.execute(
        text(
            "UPDATE listings SET location_visibility = 'area_only', latitude = NULL, "
            "longitude = NULL WHERE id = :id"
        ),
        {"id": listing.id},
    )
    assert public_point(db_session, listing) == (None, None)


def test_stored_coordinates_are_numeric_9_6_not_floats(db_session: Session) -> None:
    rows = db_session.execute(
        text(
            "SELECT column_name, data_type, numeric_precision, numeric_scale, is_generated "
            "FROM information_schema.columns WHERE table_name = 'listings' "
            "AND column_name IN ('latitude','longitude','public_latitude','public_longitude')"
        )
    ).all()

    by_name = {row[0]: tuple(row[1:]) for row in rows}
    assert by_name["latitude"] == ("numeric", 9, 6, "NEVER")
    assert by_name["longitude"] == ("numeric", 9, 6, "NEVER")
    assert by_name["public_latitude"] == ("numeric", 9, 6, "ALWAYS")
    assert by_name["public_longitude"] == ("numeric", 9, 6, "ALWAYS")


# -- write protection -------------------------------------------------------------------------------


@pytest.mark.parametrize("column", ["public_latitude", "public_longitude"])
def test_the_database_refuses_any_write_to_a_generated_public_column(
    db_session: Session, column: str
) -> None:
    listing = located(db_session, EXACT, "33.7", "73.05")

    with pytest.raises(DBAPIError, match="generated"), db_session.begin_nested():
        db_session.execute(
            text(f"UPDATE listings SET {column} = 1 WHERE id = :id"), {"id": listing.id}
        )
    with pytest.raises(DBAPIError, match="generated"), db_session.begin_nested():
        db_session.execute(
            text(
                f"INSERT INTO listings (id, kind, title, area, {column}) "
                "VALUES (gen_random_uuid(), 'provider', 'x', 'B-17', 1)"
            )
        )


# -- the ORM guard: private columns never load on a public path ---------------------------------------


@contextmanager
def recorded_sql(session: Session) -> Iterator[list[str]]:
    connection: Connection = session.connection()
    statements: list[str] = []

    def record(_c: Any, _cursor: Any, statement: str, *_rest: Any) -> None:
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(connection, "before_cursor_execute", record)


def without_guarded_cases(statement: str) -> str:
    """The statement minus ``CASE WHEN ... END`` fragments (the only place a public query may
    mention ``address`` / ``landmark``: guarded by ``visibility = 'exact'``)."""
    return re.sub(r"CASE WHEN.*?END", "", statement, flags=re.DOTALL)


PRIVATE_COLUMNS = ("latitude", "longitude", "address", "landmark")


def test_a_public_listing_never_loads_the_private_columns(db_session: Session) -> None:
    listing = located(
        db_session,
        EXACT,
        "33.701234",
        "73.051234",
        address="Shop 4",
        landmark="Near the park",
        block="C",
    )
    listing_id = listing.id
    db_session.expire_all()
    db_session.expunge_all()

    loaded = ListingReadRepository(db_session).get_public(listing_id)

    assert loaded is not None
    for column in PRIVATE_COLUMNS:  # raises instead of silently lazy-loading / leaking
        with pytest.raises(InvalidRequestError, match="raiseload"):
            getattr(loaded, column)
    assert (loaded.public_latitude, loaded.public_longitude) == (D("33.701234"), D("73.051234"))
    assert (loaded.public_address, loaded.public_landmark) == ("Shop 4", "Near the park")
    assert loaded.block == "C" and loaded.location_visibility is EXACT


@pytest.mark.parametrize("visibility", [APPROXIMATE, AREA_ONLY])
def test_a_non_exact_listing_never_selects_its_address_or_landmark_publicly(
    db_session: Session, visibility: LocationVisibility
) -> None:
    point = ("33.701234", "73.051234") if visibility is APPROXIMATE else (None, None)
    listing = located(
        db_session, visibility, *point, address="Private home", landmark="Private landmark"
    )
    listing_id = listing.id
    db_session.expire_all()
    db_session.expunge_all()

    loaded = ListingReadRepository(db_session).get_public(listing_id)

    assert loaded is not None
    assert loaded.public_address is None and loaded.public_landmark is None


def test_the_public_queries_never_select_the_stored_point_or_a_raw_address(
    db_session: Session,
) -> None:
    listing = located(
        db_session, EXACT, "33.701234", "73.051234", address="Shop 4", landmark="Near"
    )
    listing_id = listing.id
    db_session.expire_all()
    db_session.expunge_all()
    repository = ListingReadRepository(db_session)

    with recorded_sql(db_session) as statements:
        repository.get_public(listing_id)
        db_session.expunge_all()
        repository.get_public_cards([listing_id])

    assert statements
    for statement in statements:
        stripped = without_guarded_cases(statement)
        for column in PRIVATE_COLUMNS:
            assert not re.search(rf"listings\.{column}\b", stripped), (column, statement)
    # the card query does not even mention the guarded address / landmark
    cards = statements[-1] if "FROM listings" in statements[-1] else ""
    assert "address" not in cards and "landmark" not in cards


def test_the_indexing_loader_reads_the_address_but_never_the_point(db_session: Session) -> None:
    listing = located(db_session, EXACT, "33.701234", "73.051234", address="Shop 4")
    listing_id = listing.id
    db_session.expire_all()
    db_session.expunge_all()

    with recorded_sql(db_session) as statements:
        loaded = ListingReadRepository(db_session).get_for_indexing([listing_id])

    assert loaded[0].address == "Shop 4"
    joined = " ".join(statements)
    assert not re.search(r"listings\.(latitude|longitude)\b", joined)


def test_an_unloaded_private_attribute_raises_on_a_plain_session_get(db_session: Session) -> None:
    listing = located(db_session, EXACT, "33.701234", "73.051234", address="Shop 4")
    listing_id = listing.id
    db_session.expire_all()
    db_session.expunge_all()

    loaded = db_session.get(Listing, listing_id)

    assert loaded is not None
    with pytest.raises(InvalidRequestError, match="raiseload"):
        _ = loaded.latitude
