"""Alembic: a fresh database upgrades to head, downgrades to base, upgrades again, and the models
match the migrations (no drift). Runs against a scratch database so it cannot disturb the shared
test schema."""

import io
import re
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError

from app.models.enums import (
    GroceryActorRole,
    GroceryConfirmationMethod,
    GroceryEventAction,
    GroceryIssueKind,
    GroceryOrderStatus,
    GroceryPaymentMethod,
    GroceryRefundMethod,
    GrocerySubstitution,
    GroceryUnit,
    StaffScope,
)
from app.services.grocery_rules import ALLOWED_TIMEZONES, MAX_ANY_QUANTITY, WHOLE_UNITS
from tests.db.conftest import alembic_config
from tests.db.test_schema import EXPECTED_TABLES
from tests.db_safety import assert_connected_to, assert_safe_test_database


@pytest.fixture
def scratch_url(db_engine: Engine, test_database_url: URL) -> Iterator[str]:
    """A brand-new empty database (``<name>_migrations_test``), dropped afterwards."""
    base = (test_database_url.database or "").removesuffix("_test")
    scratch = test_database_url.set(database=f"{base}_migrations_test")
    assert_safe_test_database(scratch.render_as_string(hide_password=False))  # same safety rules
    name = scratch.database
    assert name is not None and name.endswith("_test")

    admin = db_engine.execution_options(isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    url = scratch.render_as_string(hide_password=False)
    try:
        yield url
    finally:
        if (engine := _ENGINES.pop(url, None)) is not None:
            engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


#: One engine per scratch database for the query helpers below. A new engine for every query spent
#: most of a migration test logging in and re-reading server settings. ``scratch_url`` disposes it.
_ENGINES: dict[str, Engine] = {}


def shared_engine(url: str) -> Engine:
    if url not in _ENGINES:
        # no server-side prepared statements: the schema changes under these connections
        _ENGINES[url] = create_engine(url, connect_args={"prepare_threshold": None})
    return _ENGINES[url]


def tables(url: str) -> set[str]:
    with shared_engine(url).connect() as connection:
        return set(
            connection.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            ).scalars()
        )


def version(url: str) -> str | None:
    with shared_engine(url).connect() as connection:
        assert_connected_to(connection, shared_engine(url).url.database or "")
        return connection.execute(text("SELECT version_num FROM alembic_version")).scalar()


def test_a_fresh_database_upgrades_to_head(scratch_url: str) -> None:
    assert tables(scratch_url) == set()

    command.upgrade(alembic_config(scratch_url), "head")

    assert tables(scratch_url) == EXPECTED_TABLES | {"alembic_version"}
    assert version(scratch_url) == "0014"


def test_it_downgrades_to_base_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.downgrade(config, "base")
    assert tables(scratch_url) == {"alembic_version"}  # every application table is gone

    command.upgrade(config, "head")
    assert tables(scratch_url) == EXPECTED_TABLES | {"alembic_version"}


def test_the_models_and_the_migrations_have_not_drifted(scratch_url: str) -> None:
    """Alembic's own check: raises if autogenerate would produce any operation."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.check(config)  # CommandError on drift


def test_there_is_a_single_linear_migration_history(scratch_url: str) -> None:
    script = ScriptDirectory.from_config(alembic_config(scratch_url))

    assert script.get_heads() == ["0014"]
    assert [revision.revision for revision in script.walk_revisions()] == [
        "0014",
        "0013",
        "0012",
        "0011",
        "0010",
        "0009",
        "0008",
        "0007",
        "0006",
        "0005",
        "0004",
        "0003",
        "0002",
        "0001",
    ]


def test_the_migration_can_be_rendered_as_sql_without_a_database_connection(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    buffer = io.StringIO()
    config.output_buffer = buffer

    command.upgrade(config, "head", sql=True)

    sql = buffer.getvalue()
    assert "CREATE TABLE listings" in sql and "CREATE TABLE food_profiles" in sql
    assert "CONSTRAINT fk_food_profiles_listing_id_vertical_business_profiles" in sql


# -- 0002: the search foundation -------------------------------------------------------------------


def columns(url: str, table: str) -> set[str]:
    with shared_engine(url).connect() as connection:
        return set(
            connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
                {"t": table},
            ).scalars()
        )


def extensions(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return set(connection.execute(text("SELECT extname FROM pg_extension")).scalars())
    finally:
        engine.dispose()


def test_0002_adds_the_search_column_the_extension_and_the_indexes(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0001")
    assert "search_document" not in columns(scratch_url, "listings")
    assert "pg_trgm" not in extensions(scratch_url)

    command.upgrade(config, "0002")

    assert "search_document" in columns(scratch_url, "listings")
    assert "pg_trgm" in extensions(scratch_url)


def test_0002_downgrades_cleanly_to_0001_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.downgrade(config, "0001")

    assert version(scratch_url) == "0001"
    assert "search_document" not in columns(scratch_url, "listings")
    assert "pg_trgm" not in extensions(scratch_url)
    command.upgrade(config, "head")
    assert version(scratch_url) == "0014"
    command.check(config)


def test_0002_leaves_existing_rows_with_an_empty_document_ready_for_a_rebuild(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0001")
    engine = create_engine(scratch_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, display_name) "
                    "VALUES (gen_random_uuid(), 'old@example.test', 'Old')"
                )
            )
            owner = connection.execute(text("SELECT id FROM users")).scalar_one()
            connection.execute(
                text(
                    "INSERT INTO listings (id, kind, owner_id, status, title, area, tags, "
                    "is_featured, revision) VALUES (gen_random_uuid(), 'provider', :o, 'approved', "
                    "'Old Listing', 'B-17', '{}', false, 1)"
                ),
                {"o": owner},
            )
    finally:
        engine.dispose()

    command.upgrade(config, "0002")

    engine = create_engine(scratch_url)
    try:
        with engine.connect() as connection:
            stored = connection.execute(text("SELECT search_document FROM listings")).scalar_one()
            assert stored == ""
    finally:
        engine.dispose()


# -- 0003: authentication state ------------------------------------------------------------------

AUTH_TABLES = {"auth_sessions", "auth_tokens", "auth_events", "auth_rate_limits"}


def user_checks(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return set(
                connection.execute(
                    text(
                        "SELECT conname FROM pg_constraint "
                        "WHERE conrelid = 'users'::regclass AND contype = 'c'"
                    )
                ).scalars()
            )
    finally:
        engine.dispose()


def test_0003_upgrades_a_0002_database_with_the_auth_tables_and_user_checks(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0002")
    assert tables(scratch_url).isdisjoint(AUTH_TABLES)
    assert "ck_users_email_normalized" not in user_checks(scratch_url)

    command.upgrade(config, "0003")

    assert version(scratch_url) == "0003"
    assert tables(scratch_url) >= AUTH_TABLES
    assert {"ck_users_email_normalized", "ck_users_email_length"} <= user_checks(scratch_url)


def test_0003_downgrades_to_0002_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.downgrade(config, "0002")

    assert version(scratch_url) == "0002"
    assert tables(scratch_url).isdisjoint(AUTH_TABLES)
    assert "ck_users_email_normalized" not in user_checks(scratch_url)
    command.upgrade(config, "head")
    assert version(scratch_url) == "0014"
    assert tables(scratch_url) >= AUTH_TABLES


def test_0003_keeps_existing_normalized_users(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0002")
    engine = create_engine(scratch_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, display_name) "
                    "VALUES (gen_random_uuid(), 'kept@example.test', 'Kept User')"
                )
            )
    finally:
        engine.dispose()

    command.upgrade(config, "0003")

    engine = create_engine(scratch_url)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT email FROM users")).scalar_one() == (
                "kept@example.test"
            )
    finally:
        engine.dispose()


# -- 0004: OAuth flows and one identity per provider per user ---------------------------------------


def unique_constraints(url: str, table: str) -> set[str]:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return set(
                connection.execute(
                    text(
                        "SELECT conname FROM pg_constraint "
                        "WHERE conrelid = CAST(:t AS regclass) AND contype = 'u'"
                    ),
                    {"t": table},
                ).scalars()
            )
    finally:
        engine.dispose()


def insert_user_with_identities(url: str, subjects: list[str]) -> None:
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, display_name) "
                    "VALUES (gen_random_uuid(), 'g@example.test', 'Google User')"
                )
            )
            for subject in subjects:
                connection.execute(
                    text(
                        "INSERT INTO auth_identities (id, user_id, provider, provider_subject) "
                        "SELECT gen_random_uuid(), id, 'google', :s FROM users"
                    ),
                    {"s": subject},
                )
    finally:
        engine.dispose()


def test_0004_upgrades_a_0003_database_and_adds_the_flow_table_and_constraint(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0003")
    assert "oauth_flows" not in tables(scratch_url)
    assert "uq_auth_identities_user_id_provider" not in unique_constraints(
        scratch_url, "auth_identities"
    )
    insert_user_with_identities(scratch_url, ["sub-1"])

    command.upgrade(config, "0004")

    assert version(scratch_url) == "0004" and "oauth_flows" in tables(scratch_url)
    assert {
        "uq_auth_identities_user_id_provider",
        "uq_auth_identities_provider_subject",
    } <= unique_constraints(scratch_url, "auth_identities")
    command.upgrade(config, "head")
    command.check(config)  # no drift between the models and the migrations (at head)


def test_0004_downgrades_to_0003_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.downgrade(config, "0003")

    assert version(scratch_url) == "0003" and "oauth_flows" not in tables(scratch_url)
    assert "uq_auth_identities_user_id_provider" not in unique_constraints(
        scratch_url, "auth_identities"
    )
    command.upgrade(config, "head")
    assert version(scratch_url) == "0014" and "oauth_flows" in tables(scratch_url)


def test_0004_refuses_to_run_over_duplicate_provider_identities(scratch_url: str) -> None:
    """Loud by design: a user holding two identities of one provider must be reconciled first."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0003")
    insert_user_with_identities(scratch_url, ["sub-1", "sub-2"])

    with pytest.raises(Exception, match="uq_auth_identities_user_id_provider"):
        command.upgrade(config, "0004")

    assert version(scratch_url) == "0003"  # the failed migration rolled back completely


# -- 0005: the shared listing location foundation (docs/backend/LOCATION_MAP.md §3, §3.1) -----------

LOCATION_COLUMNS = {
    "block",
    "address",
    "landmark",
    "latitude",
    "longitude",
    "location_visibility",
    "public_latitude",
    "public_longitude",
}
LOCATION_CHECKS = {
    "ck_listings_location_visibility_valid",
    "ck_listings_coordinates_pair",
    "ck_listings_latitude_range",
    "ck_listings_longitude_range",
    "ck_listings_visibility_matches_point",
    "ck_listings_block_not_blank",
    "ck_listings_address_not_blank",
    "ck_listings_landmark_not_blank",
}
#: Everything a 0004 listing has — all of it must survive 0005 byte for byte.
LEGACY_COLUMNS = (
    "id, kind, owner_id, status, title, description, area, tags, image_url, is_featured, "
    "revision, submitted_at, created_at, updated_at, search_document"
)

#: (kind, status, title, legacy free-text area, featured) — deliberately messy, one non-ASCII.
LEGACY_LISTINGS = [
    ("provider", "approved", "Legacy Plumber", "B-17, Block C (Demo Area)", True),
    ("business", "approved", "Legacy Shop", "Sector B-17 / Blk-D", False),
    ("business", "pending", "Legacy Food Pending", "b17 market", False),
    ("tutor", "rejected", "Legacy Tutor", "B-17", False),
    ("property", "approved", "Legacy House", "B-17, Block C (Demo Area)", False),
    ("property", "archived", "Legacy Plot", "Near B-17 chowk — بلاک", False),
]


def seed_legacy_listings(url: str) -> None:
    """Listings of every kind and several statuses, exactly as a 0004 database holds them."""
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, display_name) "
                    "VALUES (gen_random_uuid(), 'legacy@example.test', 'Legacy Owner')"
                )
            )
            owner = connection.execute(text("SELECT id FROM users")).scalar_one()
            for kind, status, title, area, featured in LEGACY_LISTINGS:
                connection.execute(
                    text(
                        "INSERT INTO listings (id, kind, owner_id, status, title, description, "
                        "area, tags, image_url, is_featured, revision, submitted_at, created_at, "
                        "updated_at, search_document) VALUES (gen_random_uuid(), :k, :o, :s, :t, "
                        "'Legacy description text', :a, :tags, '/images/x.jpg', :f, 3, "
                        "'2026-01-02T03:04:05Z', '2026-01-02T03:04:05Z', '2026-02-03T04:05:06Z', "
                        ":doc)"
                    ),
                    {
                        "k": kind,
                        "o": owner,
                        "s": status,
                        "t": title,
                        "a": area,
                        "tags": ["legacy", "tag"],
                        "f": featured,
                        "doc": f"{title.lower()} {area.lower()} legacy tag",
                    },
                )
    finally:
        engine.dispose()


def rows(url: str, sql: str) -> list[tuple[object, ...]]:
    with shared_engine(url).connect() as connection:
        return [tuple(row) for row in connection.execute(text(sql))]


def listing_snapshot(url: str) -> list[tuple[object, ...]]:
    return rows(url, f"SELECT {LEGACY_COLUMNS} FROM listings ORDER BY title")


def portal_managed(snapshot: list[tuple[object, ...]]) -> list[tuple[object, ...]]:
    """What 0008 does to a legacy snapshot (``LEGACY_COLUMNS`` order: ``kind`` second, ``owner_id``
    third): a provider loses its owner; every other row, and every other column, is identical."""
    return [(row[0], row[1], None, *row[3:]) if row[1] == "provider" else row for row in snapshot]


def listing_indexes(url: str) -> set[str]:
    return {
        str(name)
        for (name,) in rows(url, "SELECT indexname FROM pg_indexes WHERE tablename = 'listings'")
    }


def test_0005_adds_the_location_columns_types_and_checks(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0004")
    assert not LOCATION_COLUMNS & columns(scratch_url, "listings")

    command.upgrade(config, "0005")

    assert columns(scratch_url, "listings") >= LOCATION_COLUMNS
    types = {
        name: (data_type, precision, scale, generated)
        for name, data_type, precision, scale, generated in rows(
            scratch_url,
            "SELECT column_name, data_type, numeric_precision, numeric_scale, is_generated "
            "FROM information_schema.columns WHERE table_name = 'listings' "
            "AND column_name IN ('latitude','longitude','public_latitude','public_longitude')",
        )
    }
    for name in ("latitude", "longitude"):
        assert types[name] == ("numeric", 9, 6, "NEVER")  # stored as NUMERIC(9,6), not a float
    for name in ("public_latitude", "public_longitude"):
        assert types[name] == (
            "numeric",
            9,
            6,
            "ALWAYS",
        )  # database-generated, never client-written
    checks = rows(
        scratch_url,
        "SELECT conname, convalidated FROM pg_constraint "
        "WHERE conrelid = 'listings'::regclass AND contype = 'c'",
    )
    present = {name: validated for name, validated in checks}
    assert set(present) >= LOCATION_CHECKS and all(present[n] for n in LOCATION_CHECKS)
    assert rows(
        scratch_url,
        "SELECT column_default FROM information_schema.columns "
        "WHERE table_name = 'listings' AND column_name = 'location_visibility'",
    ) == [("'area_only'::character varying",)]


def test_0005_leaves_populated_0004_listings_untouched_as_area_only_legacy_rows(
    scratch_url: str,
) -> None:
    """THE regression test: a populated 0004 database upgrades without changing any listing."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0004")
    seed_legacy_listings(scratch_url)
    before = listing_snapshot(scratch_url)
    assert len(before) == len(LEGACY_LISTINGS)

    command.upgrade(config, "0005")

    # area, status, search_document, updated_at and every other pre-existing value: identical
    assert listing_snapshot(scratch_url) == before
    # ... and the legacy state is exactly area-only, no point, nothing invented
    location = rows(
        scratch_url,
        "SELECT location_visibility, block, address, landmark, latitude, longitude, "
        "public_latitude, public_longitude FROM listings",
    )
    assert location == [("area_only", None, None, None, None, None, None, None)] * len(before)
    # legacy Properties (no point) survive; no per-kind rule was added to the database
    assert rows(scratch_url, "SELECT count(*) FROM listings WHERE kind = 'property'") == [(2,)]
    command.upgrade(config, "head")
    command.check(config)


def test_0005_downgrades_to_0004_and_reupgrades_without_touching_listings(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0004")
    seed_legacy_listings(scratch_url)
    before = listing_snapshot(scratch_url)

    command.upgrade(config, "0005")
    command.downgrade(config, "0004")

    assert version(scratch_url) == "0004"
    assert not LOCATION_COLUMNS & columns(scratch_url, "listings")
    assert not LOCATION_CHECKS & {
        name
        for (name,) in rows(
            scratch_url,
            "SELECT conname FROM pg_constraint WHERE conrelid = 'listings'::regclass",
        )
    }
    assert listing_snapshot(scratch_url) == before  # only the 0005 schema was removed

    command.upgrade(config, "head")

    # Re-upgrading to head also applies 0008, which makes the legacy providers portal-managed.
    assert version(scratch_url) == "0014"
    assert listing_snapshot(scratch_url) == portal_managed(before)
    command.check(config)


def test_0005_is_ddl_only_with_no_data_statement_extension_or_index(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0004")
    indexes_before, extensions_before = listing_indexes(scratch_url), extensions(scratch_url)
    buffer = io.StringIO()
    offline = alembic_config(scratch_url)
    offline.output_buffer = buffer
    command.upgrade(offline, "0004:0005", sql=True)

    sql = buffer.getvalue().upper()

    # no listings data statement: nothing is backfilled, guessed or rewritten
    assert "UPDATE LISTINGS" not in sql and "INSERT INTO LISTINGS" not in sql
    assert "DELETE FROM" not in sql
    assert "POSTGIS" not in sql and "CREATE INDEX" not in sql and "CREATE UNIQUE INDEX" not in sql
    assert "ALTER COLUMN AREA" not in sql

    command.upgrade(config, "0005")
    assert listing_indexes(scratch_url) == indexes_before  # no coordinate / block index (yet)
    assert extensions(scratch_url) == extensions_before  # no PostGIS


# -- 0006: service requests (docs/backend/DATA_MODEL.md §16, API_CONTRACT.md §13) ------------------

NEW_TABLES = {"service_requests", "service_request_status_history"}
#: Tables whose rows a populated 0005 database holds; 0006 must leave every one byte-identical.
EXISTING_DATA = {
    "users": "SELECT id, email, display_name, status, created_at FROM users ORDER BY id",
    "listings": f"SELECT {LEGACY_COLUMNS} FROM listings ORDER BY title",
    "saved_items": "SELECT user_id, listing_id, created_at FROM saved_items ORDER BY listing_id",
    "categories": "SELECT id, module, slug, name FROM categories ORDER BY slug",
}


def seed_0005_world(url: str) -> None:
    """A populated 0005 database: legacy listings, a user, a category and saved items."""
    seed_legacy_listings(url)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO categories (id, module, slug, name, display_order, is_active) "
                    "VALUES (gen_random_uuid(), 'services', 'plumbing', 'Plumbing', 1, true)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO saved_items (user_id, listing_id) "
                    "SELECT u.id, l.id FROM users u CROSS JOIN listings l "
                    "WHERE l.status = 'approved'"
                )
            )
    finally:
        engine.dispose()


def existing_data(url: str) -> dict[str, list[tuple[object, ...]]]:
    return {table: rows(url, sql) for table, sql in EXISTING_DATA.items()}


def column_map(url: str) -> dict[str, set[str]]:
    """``table -> columns`` for every table that is not new in 0006."""
    found: dict[str, set[str]] = {}
    for table, column in rows(
        url,
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public'",
    ):
        if str(table) not in NEW_TABLES:
            found.setdefault(str(table), set()).add(str(column))
    return found


def test_0006_adds_exactly_the_two_tables_and_changes_no_other_table(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0005")
    tables_before, columns_before = tables(scratch_url), column_map(scratch_url)
    assert not NEW_TABLES & tables_before

    command.upgrade(config, "0006")

    assert tables(scratch_url) - tables_before == NEW_TABLES
    assert column_map(scratch_url) == columns_before  # not one column added to or dropped elsewhere
    assert version(scratch_url) == "0006"
    # (No drift check here: 0006 is no longer head, so the models are rightly ahead of this schema.
    # `test_the_models_and_the_migrations_have_not_drifted` checks head, and so do the 0007 tests.)


def test_0006_keeps_every_existing_row_of_a_populated_0005_database(scratch_url: str) -> None:
    """THE regression test: users, listings, saved items and categories survive unchanged."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0005")
    seed_0005_world(scratch_url)
    before = existing_data(scratch_url)
    assert all(before.values()), before  # the world really is populated

    command.upgrade(config, "0006")

    assert existing_data(scratch_url) == before
    assert rows(scratch_url, "SELECT count(*) FROM service_requests") == [(0,)]  # nothing invented


def test_0006_foreign_keys_and_checks_are_the_designed_ones(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "0006")

    delete_rules = {
        (str(table), str(column)): str(rule)
        for table, column, rule in rows(
            scratch_url,
            "SELECT c.conrelid::regclass::text, a.attname::text, c.confdeltype::text "
            "FROM pg_constraint c JOIN pg_attribute a "
            "ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) "
            "WHERE c.contype = 'f' AND c.conrelid::regclass::text IN "
            "('service_requests', 'service_request_status_history')",
        )
    }
    assert delete_rules == {
        ("service_requests", "requester_id"): "r",  # RESTRICT: a requester is never orphaned
        ("service_requests", "provider_listing_id"): "n",  # SET NULL: history outlives a listing
        ("service_request_status_history", "request_id"): "c",  # CASCADE with its request
        ("service_request_status_history", "actor_user_id"): "r",  # RESTRICT: valid actor forever
    }
    checks = {
        str(name): validated
        for name, validated in rows(
            scratch_url,
            "SELECT conname, convalidated FROM pg_constraint "
            "WHERE contype = 'c' AND conrelid::regclass::text IN "
            "('service_requests', 'service_request_status_history')",
        )
    }
    assert set(checks) == {
        "ck_service_requests_status_valid",
        "ck_service_requests_contact_channel_valid",
        "ck_service_requests_details_min_length",
        "ck_service_requests_service_not_blank",
        "ck_service_requests_area_min_length",
        "ck_service_requests_provider_name_not_blank",
        "ck_service_request_status_history_from_status_valid",
        "ck_service_request_status_history_to_status_valid",
        "ck_service_request_status_history_actor_role_valid",
        "ck_service_request_status_history_from_status_iff_submitted",
    }
    assert all(checks.values())


def test_0006_downgrades_to_0005_and_reupgrades_without_touching_existing_data(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0005")
    seed_0005_world(scratch_url)
    before = existing_data(scratch_url)

    command.upgrade(config, "0006")
    command.downgrade(config, "0005")

    assert version(scratch_url) == "0005"
    assert not NEW_TABLES & tables(scratch_url)  # only the 0006 schema was removed
    assert existing_data(scratch_url) == before

    command.upgrade(config, "head")

    # Re-upgrading to head also applies 0008, which makes the legacy providers portal-managed.
    assert version(scratch_url) == "0014"
    expected = {**before, "listings": portal_managed(before["listings"])}
    assert existing_data(scratch_url) == expected
    command.check(config)


def test_0006_is_ddl_only_with_no_data_statement(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0005")
    buffer = io.StringIO()
    offline = alembic_config(scratch_url)
    offline.output_buffer = buffer
    command.upgrade(offline, "0005:0006", sql=True)

    lines = [line for line in buffer.getvalue().splitlines() if not line.strip().startswith("--")]
    sql = " ".join(lines)
    statements = [s.strip().upper() for s in sql.split(";") if s.strip()]
    own = [s for s in statements if "ALEMBIC_VERSION" not in s and s not in {"BEGIN", "COMMIT"}]

    assert any(s.startswith("CREATE TABLE SERVICE_REQUESTS") for s in own)
    assert any(s.startswith("CREATE TABLE SERVICE_REQUEST_STATUS_HISTORY") for s in own)
    for statement in own:
        # DDL on the two new tables only: no data statement, no change to any existing table
        assert statement.startswith(("CREATE TABLE", "CREATE INDEX")), statement[:80]
        assert "SERVICE_REQUEST" in statement.split("(")[0], statement[:80]


# -- 0007: staff authority (RBAC-A; docs/backend/DATA_MODEL.md §17, AUTH_RBAC.md §27) ---------------

STAFF_TABLES = {"staff_scope_assignments", "staff_audit_events"}
STAFF_INDEXES = {"uq_user_roles_one_staff_role"}  # the Super Admin / Moderator exclusivity backstop
STAFF_TRIGGERS = {
    "trg_staff_audit_events_append_only",  # row-level: BEFORE UPDATE OR DELETE
    "trg_staff_audit_events_no_truncate",  # statement-level: BEFORE TRUNCATE (shares the function)
}
STAFF_FUNCTIONS = {"staff_audit_events_append_only"}


def execute(url: str, sql: str, **params: object) -> None:
    with shared_engine(url).begin() as connection:
        connection.execute(text(sql), params)


def scalar(url: str, sql: str, **params: object) -> object:
    with shared_engine(url).connect() as connection:
        return connection.execute(text(sql), params).scalar_one()


def trigger_names(url: str) -> set[str]:
    return {
        str(name) for (name,) in rows(url, "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")
    }


def function_names(url: str) -> set[str]:
    return {
        str(name)
        for (name,) in rows(
            url,
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public'",
        )
    }


def index_names(url: str, table: str | None = None) -> set[str]:
    sql = "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
    if table is not None:
        sql += f" AND tablename = '{table}'"
    return {str(name) for (name,) in rows(url, sql)}


def columns_except_staff(url: str) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for table, column in rows(
        url,
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public'",
    ):
        if str(table) not in STAFF_TABLES:
            found.setdefault(str(table), set()).add(str(column))
    return found


def seed_0006_world(url: str) -> None:
    """A populated 0006 database, including an admin role row."""
    seed_0005_world(url)
    execute(url, "INSERT INTO user_roles (user_id, role) SELECT id, 'admin' FROM users")


ROLE_SNAPSHOT = "SELECT user_id, role FROM user_roles ORDER BY user_id, role"
ADD_USER = (
    "INSERT INTO users (id, email, display_name) "
    "VALUES (gen_random_uuid(), 'staff@example.test', 'Staff User')"
)


def test_0007_adds_the_staff_tables_triggers_and_widened_checks(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0006")
    tables_before, columns_before = tables(scratch_url), columns_except_staff(scratch_url)
    indexes_before = index_names(scratch_url, table="user_roles")
    assert not STAFF_TABLES & tables_before and not trigger_names(scratch_url)
    assert not STAFF_INDEXES & indexes_before

    command.upgrade(config, "0007")

    assert tables(scratch_url) - tables_before == STAFF_TABLES
    assert columns_except_staff(scratch_url) == columns_before  # not one column elsewhere changed
    assert trigger_names(scratch_url) == STAFF_TRIGGERS
    assert function_names(scratch_url) >= STAFF_FUNCTIONS
    assert index_names(scratch_url, table="user_roles") >= STAFF_INDEXES
    partial = str(
        scalar(
            scratch_url,
            "SELECT pg_get_indexdef(oid) FROM pg_class "
            "WHERE relname = 'uq_user_roles_one_staff_role'",
        )
    )
    assert "UNIQUE" in partial and "user_id" in partial
    assert "WHERE" in partial and "admin" in partial and "moderator" in partial
    assert version(scratch_url) == "0007"
    role_check = str(
        scalar(
            scratch_url,
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ck_user_roles_role_valid'",
        )
    )
    actor_check = str(
        scalar(
            scratch_url,
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ck_listing_status_history_actor_role_valid'",
        )
    )
    assert "admin" in role_check and "moderator" in role_check
    assert all(word in actor_check for word in ("owner", "admin", "moderator"))
    # (No drift check here: 0007 is no longer head, so the models are rightly ahead of this schema.
    # `test_the_models_and_the_migrations_have_not_drifted` and the 0008 tests check head.)


def test_0007_keeps_every_existing_row_of_a_populated_0006_database(scratch_url: str) -> None:
    """THE regression test: users, listings, saved items, categories and admin roles survive."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0006")
    seed_0006_world(scratch_url)
    before, roles_before = existing_data(scratch_url), rows(scratch_url, ROLE_SNAPSHOT)
    assert all(before.values()) and roles_before == [(roles_before[0][0], "admin")]

    command.upgrade(config, "0007")

    assert existing_data(scratch_url) == before
    assert rows(scratch_url, ROLE_SNAPSHOT) == roles_before  # the admin role is untouched
    assert rows(scratch_url, "SELECT count(*) FROM staff_scope_assignments") == [(0,)]
    assert rows(scratch_url, "SELECT count(*) FROM staff_audit_events") == [(0,)]  # none invented


def test_0007_downgrades_an_empty_staff_schema_and_reupgrades(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.downgrade(config, "0006")

    assert version(scratch_url) == "0006"
    assert not STAFF_TABLES & tables(scratch_url)
    assert not trigger_names(scratch_url) and not STAFF_FUNCTIONS & function_names(scratch_url)
    assert not STAFF_INDEXES & index_names(scratch_url, table="user_roles")
    # the role vocabulary is narrowed back: ``moderator`` is no longer a valid role
    execute(scratch_url, ADD_USER)
    with pytest.raises(Exception, match="ck_user_roles_role_valid"):
        execute(
            scratch_url, "INSERT INTO user_roles (user_id, role) SELECT id, 'moderator' FROM users"
        )

    command.upgrade(config, "head")

    assert version(scratch_url) == "0014" and tables(scratch_url) >= STAFF_TABLES
    command.check(config)


def test_0007_downgrade_keeps_admin_roles_and_every_existing_row(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0006")
    seed_0006_world(scratch_url)
    before, roles_before = existing_data(scratch_url), rows(scratch_url, ROLE_SNAPSHOT)
    command.upgrade(config, "0007")

    command.downgrade(config, "0006")  # an admin is Super Admin data worth keeping: not a blocker

    assert version(scratch_url) == "0006"
    assert existing_data(scratch_url) == before and rows(scratch_url, ROLE_SNAPSHOT) == roles_before


MODERATOR_ROLE = "INSERT INTO user_roles (user_id, role) SELECT id, 'moderator' FROM users"
LIVE_STAFF_DATA = {
    "a moderator role grant": ([MODERATOR_ROLE], "1 moderator role grants"),
    "a scope assignment": (
        [
            MODERATOR_ROLE,
            "INSERT INTO staff_scope_assignments (user_id, scope) SELECT id, 'food' FROM users",
        ],
        "1 staff scope assignments",
    ),
    "a staff audit event": (
        [
            "INSERT INTO staff_audit_events (id, source, action) "
            "VALUES (gen_random_uuid(), 'cli', 'scope_granted')"
        ],
        "1 staff audit events",
    ),
    "a moderator listing decision": (
        [
            # ARCHIVED, so the 0008 downgrade that runs first (it refuses over a live Provider) lets
            # this test reach the 0007 refusal it is about.
            "INSERT INTO listings (id, kind, title, area, status) "
            "VALUES (gen_random_uuid(), 'provider', 'T', 'B-17', 'archived')",
            "INSERT INTO listing_status_history (id, listing_id, from_status, to_status, action, "
            "revision, actor_user_id, actor_role) SELECT gen_random_uuid(), l.id, 'pending', "
            "'approved', 'approved', 1, u.id, 'moderator' FROM listings l CROSS JOIN users u",
        ],
        "1 moderator listing decisions",
    ),
}
CLEAR_STAFF_DATA = [
    "DELETE FROM listing_status_history WHERE actor_role = 'moderator'",
    "DELETE FROM staff_scope_assignments",
    "DELETE FROM user_roles WHERE role = 'moderator'",
    # The audit is append-only: BOTH a row-level (UPDATE / DELETE) trigger and a statement-level
    # (TRUNCATE) trigger protect it. An operator who wants a legitimate downgrade must drop its
    # protection first; a raw ``DROP TABLE`` in the downgrade then cascades the triggers safely.
    "DROP TRIGGER trg_staff_audit_events_no_truncate ON staff_audit_events",
    "DROP TRIGGER trg_staff_audit_events_append_only ON staff_audit_events",
    "TRUNCATE staff_audit_events",
]


@pytest.mark.parametrize("case", list(LIVE_STAFF_DATA))
def test_0007_refuses_to_downgrade_over_live_staff_data_and_changes_nothing(
    scratch_url: str, case: str
) -> None:
    statements, expected = LIVE_STAFF_DATA[case]
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    execute(scratch_url, ADD_USER)
    for statement in statements:
        execute(scratch_url, statement)
    tables_before = tables(scratch_url)

    with pytest.raises(RuntimeError, match="Refusing to downgrade 0007") as refused:
        command.downgrade(config, "0006")

    assert expected in str(refused.value)  # it says exactly what it would have destroyed
    assert version(scratch_url) == "0014"  # nothing was downgraded...
    assert tables(scratch_url) == tables_before  # ...no table was dropped...
    # ...and the protection is still in place (0011, undone with the rest, adds its own triggers)
    assert trigger_names(scratch_url) == (
        STAFF_TRIGGERS | GROCERY_TRIGGERS | GROCERY_0012_TRIGGERS | GROCERY_0014_TRIGGERS
    )
    for statement in CLEAR_STAFF_DATA:  # the operator removes the data deliberately
        execute(scratch_url, statement)

    command.downgrade(config, "0006")

    assert version(scratch_url) == "0006" and not STAFF_TABLES & tables(scratch_url)


# -- 0008: portal-managed Providers (RBAC-D; docs/backend/DATA_MODEL.md §18, AUTH_RBAC.md §31) -------

PROVIDER_CONSTRAINT = "ck_listings_provider_has_no_owner"
LISTING_ROW_SQL = (
    "SELECT title, kind, owner_id, status, revision, is_featured, area, submitted_at, created_at, "
    "updated_at, search_document FROM listings ORDER BY title"
)
HISTORY_SQL = (
    "SELECT listing_id, from_status, to_status, action, revision, actor_user_id, actor_role "
    "FROM listing_status_history ORDER BY listing_id, created_at, id"
)
ADD_USER_A = (
    "INSERT INTO users (id, email, display_name) "
    "VALUES (gen_random_uuid(), 'a@example.test', 'User A')"
)


def listing_check_constraints(url: str) -> set[str]:
    return {
        str(name)
        for (name,) in rows(
            url,
            "SELECT conname FROM pg_constraint "
            "WHERE conrelid = 'listings'::regclass AND contype = 'c'",
        )
    }


def seed_0007_world(url: str) -> dict[str, str]:
    """A populated 0007 database: two accounts, owned AND ownerless listings of several kinds, and
    the submission history of every owned listing (the only place a provider's old ownership was
    ever written down). Returns ``title -> listing id``."""
    execute(
        url,
        "INSERT INTO users (id, email, display_name) VALUES "
        "(gen_random_uuid(), 'admin-author@example.test', 'Admin Author'), "
        "(gen_random_uuid(), 'owner@example.test', 'Plain Owner')",
    )
    rows_to_add = (
        ("Owned provider", "provider", "admin-author@example.test", "approved"),
        ("Pending owned provider", "provider", "owner@example.test", "pending"),
        ("Seeded provider", "provider", None, "approved"),
        ("Owned business", "business", "owner@example.test", "approved"),
        ("Seeded business", "business", None, "approved"),
    )
    for title, kind, owner_email, status in rows_to_add:
        execute(
            url,
            "INSERT INTO listings (id, kind, owner_id, status, title, area, revision, "
            "submitted_at, created_at, updated_at, search_document) "
            "VALUES (gen_random_uuid(), :k, (SELECT id FROM users WHERE email = :e), :s, :t, "
            "'B-17, Block C', 4, '2026-01-02T03:04:05Z', '2026-01-02T03:04:05Z', "
            "'2026-02-03T04:05:06Z', :d)",
            k=kind,
            e=owner_email,
            s=status,
            t=title,
            d=title.lower(),
        )
    execute(
        url,
        "INSERT INTO listing_status_history (id, listing_id, from_status, to_status, action, "
        "revision, actor_user_id, actor_role) "
        "SELECT gen_random_uuid(), l.id, NULL, 'pending', 'submitted', 1, l.owner_id, 'owner' "
        "FROM listings l WHERE l.owner_id IS NOT NULL",
    )
    return {
        str(title): str(listing_id)
        for title, listing_id in rows(url, "SELECT title, id FROM listings")
    }


def test_0008_adds_exactly_one_check_constraint_and_changes_no_column(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0007")
    before_constraints = listing_check_constraints(scratch_url)
    before_columns = columns_except_staff(scratch_url)
    assert PROVIDER_CONSTRAINT not in before_constraints

    command.upgrade(config, "0008")

    assert version(scratch_url) == "0008"
    assert listing_check_constraints(scratch_url) == before_constraints | {PROVIDER_CONSTRAINT}
    assert columns_except_staff(scratch_url) == before_columns  # no column added, dropped, altered
    assert tables(scratch_url) >= STAFF_TABLES  # and no table appears or disappears
    command.upgrade(config, "head")  # `check` compares the models with HEAD, so finish the upgrade
    command.check(config)


def test_0008_backfills_every_owned_provider_and_changes_nothing_else(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0007")
    ids = seed_0007_world(scratch_url)
    before = rows(scratch_url, LISTING_ROW_SQL)
    history_before = rows(scratch_url, HISTORY_SQL)
    users_before = rows(scratch_url, "SELECT id, email, display_name FROM users ORDER BY email")
    assert len(before) == 5 and len(history_before) == 3
    owned_providers = rows(
        scratch_url,
        "SELECT count(*) FROM listings WHERE kind = 'provider' AND owner_id IS NOT NULL",
    )
    assert owned_providers == [(2,)]

    command.upgrade(config, "0008")

    after = rows(scratch_url, LISTING_ROW_SQL)
    assert len(after) == len(before)  # nothing deleted, nothing added
    for old, new in zip(before, after, strict=True):
        title, kind = old[0], old[1]
        if kind == "provider":
            assert new[2] is None, title  # portal-managed now
            assert new[:2] + new[3:] == old[:2] + old[3:], title  # EVERY other column untouched
        else:
            assert new == old, title  # a business keeps its owner (or lack of one) exactly
    # History is NOT rewritten: the original author is still the actor of the submission row.
    assert rows(scratch_url, HISTORY_SQL) == history_before
    assert (
        rows(scratch_url, "SELECT id, email, display_name FROM users ORDER BY email")
        == users_before
    )
    assert rows(
        scratch_url, f"SELECT count(*) FROM listings WHERE id = '{ids['Owned provider']}'"
    ) == [(1,)]
    # ...and nothing was invented in the staff audit for a past that had none.
    assert rows(scratch_url, "SELECT count(*) FROM staff_audit_events") == [(0,)]


def test_0008_constraint_forbids_an_owned_provider_and_nothing_else(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    execute(scratch_url, ADD_USER_A)
    owned = (
        "INSERT INTO listings (id, kind, owner_id, title, area) VALUES "
        "(gen_random_uuid(), :k, (SELECT id FROM users LIMIT 1), 'T', 'B-17')"
    )
    ownerless = (
        "INSERT INTO listings (id, kind, owner_id, title, area) "
        "VALUES (gen_random_uuid(), :k, NULL, 'T', 'B-17')"
    )

    with pytest.raises(Exception, match=PROVIDER_CONSTRAINT):
        execute(scratch_url, owned, k="provider")
    for kind in ("business", "tutor", "property"):
        execute(scratch_url, owned, k=kind)  # Business / Tutor / Property ownership is untouched
        execute(scratch_url, ownerless, k=kind)  # and an ownerless one is still legal
    execute(scratch_url, ownerless, k="provider")  # the portal-managed Provider

    # Giving an existing Provider an owner is refused on the update path as well, and so is turning
    # an owned listing of another kind into a Provider (kind is not editable anyway).
    with pytest.raises(Exception, match=PROVIDER_CONSTRAINT):
        execute(
            scratch_url,
            "UPDATE listings SET owner_id = (SELECT id FROM users LIMIT 1) WHERE kind = 'provider'",
        )
    with pytest.raises(Exception, match=PROVIDER_CONSTRAINT):
        execute(
            scratch_url,
            "UPDATE listings SET kind = 'provider' WHERE kind = 'business' AND owner_id IS NOT NULL",
        )


def seed_post_0008_world(url: str, *, provider_status: str) -> None:
    """A head database as RBAC-D leaves it: an ownerless Provider in ``provider_status`` and an owned
    Business."""
    execute(url, ADD_USER_A)
    execute(
        url,
        "INSERT INTO listings (id, kind, owner_id, status, title, area) VALUES "
        "(gen_random_uuid(), 'provider', NULL, :s, 'Portal provider', 'B-17'), "
        "(gen_random_uuid(), 'business', (SELECT id FROM users LIMIT 1), 'approved', "
        "'Owned business', 'B-17')",
        s=provider_status,
    )


@pytest.mark.parametrize("status", ["pending", "approved", "rejected"])
def test_0008_refuses_to_downgrade_over_a_live_provider_and_changes_nothing(
    scratch_url: str, status: str
) -> None:
    """The backfill cannot be undone (the previous owners are gone and are never guessed) and the
    pre-RBAC-D release can only edit an OWNED listing, so a downgrade would strand every live
    Provider. The repository's destructive-downgrade convention applies: refuse, change nothing."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    seed_post_0008_world(scratch_url, provider_status=status)
    before = rows(scratch_url, LISTING_ROW_SQL)
    tables_before = tables(scratch_url)

    with pytest.raises(RuntimeError, match="Refusing to downgrade 0008") as refused:
        command.downgrade(config, "0007")

    assert "1 live Service / Professional listing" in str(refused.value)
    assert "WITHOUT downgrading" in str(refused.value)  # it names the safe way to roll back
    assert version(scratch_url) == "0008"  # nothing was downgraded...
    assert PROVIDER_CONSTRAINT in listing_check_constraints(scratch_url)  # ...the guard is intact
    assert tables(scratch_url) == tables_before
    assert rows(scratch_url, LISTING_ROW_SQL) == before  # not one row changed
    owners = rows(scratch_url, "SELECT owner_id FROM listings WHERE kind = 'provider'")
    assert owners == [(None,)]  # and NO owner was invented for the provider


def test_0008_refusal_counts_every_live_provider_and_ignores_the_other_kinds(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    seed_post_0008_world(scratch_url, provider_status="approved")
    execute(
        scratch_url,
        "INSERT INTO listings (id, kind, owner_id, status, title, area) VALUES "
        "(gen_random_uuid(), 'provider', NULL, 'pending', 'Second provider', 'B-17'), "
        "(gen_random_uuid(), 'provider', NULL, 'archived', 'Retired provider', 'B-17'), "
        "(gen_random_uuid(), 'tutor', NULL, 'approved', 'Curated tutor', 'B-17')",
    )

    with pytest.raises(RuntimeError, match="2 live Service / Professional listing"):
        command.downgrade(config, "0007")  # the archived provider and the tutor do not count

    assert version(scratch_url) == "0008"


def test_0008_downgrades_when_no_provider_is_live_without_touching_any_row(
    scratch_url: str,
) -> None:
    """An empty database, or one whose providers are all archived (inert: nothing can be stranded),
    downgrades cleanly; no row changes; re-upgrading is idempotent and backfills any provider the
    pre-RBAC-D release wrote in between."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    seed_post_0008_world(scratch_url, provider_status="archived")
    before = rows(scratch_url, LISTING_ROW_SQL)

    command.downgrade(config, "0007")

    assert version(scratch_url) == "0007"
    assert PROVIDER_CONSTRAINT not in listing_check_constraints(scratch_url)
    assert rows(scratch_url, LISTING_ROW_SQL) == before  # not one row changed
    # Under 0007 an owned provider is legal again (that is what the old release wrote)...
    execute(
        scratch_url,
        "INSERT INTO listings (id, kind, owner_id, title, area) VALUES "
        "(gen_random_uuid(), 'provider', (SELECT id FROM users LIMIT 1), 'Stray owned', 'B-17')",
    )

    command.upgrade(config, "0008")  # ...and re-upgrading backfills it again before the constraint

    assert version(scratch_url) == "0008"
    assert PROVIDER_CONSTRAINT in listing_check_constraints(scratch_url)
    stray = rows(scratch_url, "SELECT owner_id FROM listings WHERE title = 'Stray owned'")
    assert stray == [(None,)]
    business = rows(
        scratch_url, "SELECT owner_id IS NOT NULL FROM listings WHERE kind = 'business'"
    )
    assert business == [(True,)]
    command.upgrade(config, "head")  # `check` compares the models with HEAD, so finish the upgrade
    command.check(config)


def test_0008_keeps_ownerless_curated_listings_of_every_other_kind_legal(
    scratch_url: str,
) -> None:
    """INTENTIONAL, not an oversight: the constraint is ONE-directional. ``owner_id IS NULL`` is a
    documented state for admin-curated / unclaimed content (``DATA_MODEL.md`` §4 and §12: seed data
    is loaded with ``owner_id NULL``, and databases loaded by earlier fixture versions hold such
    rows), and no owner can be fabricated for them in a migration. Strengthening the constraint to
    "every non-Provider has an owner" would make ``alembic upgrade`` fail on those databases."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0007")
    execute(
        scratch_url,
        "INSERT INTO listings (id, kind, owner_id, status, title, area) VALUES "
        "(gen_random_uuid(), 'business', NULL, 'approved', 'Curated business', 'B-17'), "
        "(gen_random_uuid(), 'tutor', NULL, 'approved', 'Curated tutor', 'B-17'), "
        "(gen_random_uuid(), 'property', NULL, 'approved', 'Curated property', 'B-17')",
    )

    command.upgrade(config, "0008")  # the upgrade succeeds over ownerless curated rows...

    kinds = rows(scratch_url, "SELECT kind, owner_id IS NULL FROM listings ORDER BY kind")
    assert kinds == [("business", True), ("property", True), ("tutor", True)]  # ...and keeps them
    execute(
        scratch_url,
        "INSERT INTO listings (id, kind, owner_id, title, area) "
        "VALUES (gen_random_uuid(), 'business', NULL, 'Another curated one', 'B-17')",
    )  # ...and the constraint still allows them
    command.upgrade(config, "head")  # `check` compares the models with HEAD, so finish the upgrade
    command.check(config)


def test_0008_downgrades_all_the_way_to_base_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    command.downgrade(config, "base")
    assert tables(scratch_url) == {"alembic_version"}
    command.upgrade(config, "0008")
    assert version(scratch_url) == "0008"
    command.upgrade(config, "head")  # `check` compares the models with HEAD, so finish the upgrade
    command.check(config)


# -- 0009: listing contact numbers (Listing Contact v1; docs/backend/DATA_MODEL.md §19) ---------------------

CONTACT_COLUMNS = {"contact_phone", "whatsapp_phone"}
CONTACT_CONSTRAINTS = {"ck_listings_contact_phone_e164", "ck_listings_whatsapp_phone_e164"}
#: Everything about a listing that 0009 must leave byte-for-byte alone.
UNTOUCHED_SQL = (
    "SELECT title, kind, owner_id, status, revision, is_featured, area, submitted_at, created_at, "
    "updated_at, search_document FROM listings ORDER BY title"
)


def test_0009_adds_exactly_the_two_contact_columns_and_their_two_checks(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    before_columns = columns(scratch_url, "listings")
    before_constraints = listing_check_constraints(scratch_url)
    before_tables = tables(scratch_url)
    assert not (before_columns & CONTACT_COLUMNS)

    command.upgrade(config, "0010")  # before 0011 adds its own tables

    assert version(scratch_url) == "0010"
    assert columns(scratch_url, "listings") == before_columns | CONTACT_COLUMNS
    assert listing_check_constraints(scratch_url) == before_constraints | CONTACT_CONSTRAINTS
    assert tables(scratch_url) == before_tables  # no table appears or disappears
    command.upgrade(config, "head")  # `check` compares the models with HEAD
    command.check(config)  # the model declares the very same columns and checks: no drift


def test_0009_leaves_every_existing_row_exactly_as_it_was(scratch_url: str) -> None:
    """The additive upgrade guesses nothing: no number is invented, parsed out of a description or
    copied from anywhere (there is no account phone number in this schema to copy)."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0008")
    seed_post_0008_world(scratch_url, provider_status="approved")
    before = rows(scratch_url, UNTOUCHED_SQL)
    assert before  # the fixture really did seed listings

    command.upgrade(config, "head")

    assert rows(scratch_url, UNTOUCHED_SQL) == before
    # ... and every pre-existing row holds the documented legacy state: no contact number.
    assert rows(
        scratch_url,
        "SELECT count(*) FROM listings WHERE contact_phone IS NULL AND whatsapp_phone IS NULL",
    ) == rows(scratch_url, "SELECT count(*) FROM listings")


def test_0009_columns_accept_only_a_canonical_number(scratch_url: str) -> None:
    """Row-local shape only, as a backstop under the one normaliser: the column can hold NULL (a
    legacy row, a Provider) or E.164, and nothing else — not even on a later UPDATE."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    execute(
        scratch_url,
        "INSERT INTO listings (id, kind, title, area) "
        "VALUES (gen_random_uuid(), 'business', 'Contact Shop', 'B-17')",
    )

    # NULL stays legal, and so does a canonical number.
    execute(scratch_url, "UPDATE listings SET contact_phone = NULL, whatsapp_phone = NULL")
    execute(
        scratch_url,
        "UPDATE listings SET contact_phone = '+923001234567', whatsapp_phone = '+92511234567'",
    )
    assert rows(scratch_url, "SELECT contact_phone FROM listings") == [("+923001234567",)]

    for bad in ("0300 123 4567", "03001234567", "+92 300 1234567", "923001234567", "+0300123456"):
        for column in ("contact_phone", "whatsapp_phone"):
            with pytest.raises(IntegrityError, match=f"ck_listings_{column}_e164"):
                execute(scratch_url, f"UPDATE listings SET {column} = :v", v=bad)  # noqa: S608
    # The refused writes changed nothing.
    assert rows(scratch_url, "SELECT contact_phone, whatsapp_phone FROM listings") == [
        ("+923001234567", "+92511234567")
    ]


def test_0009_downgrades_to_0008_keeping_every_row_and_upgrades_again(scratch_url: str) -> None:
    """A clean, complete reversal of an additive change (as ``0005`` does for the location block):
    the older release has no contact concept, so every row stays valid and editable without the two
    columns. Dropping them discards the numbers owners typed — that is what dropping the column
    means, and it is why the migration says so out loud."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    seed_post_0008_world(scratch_url, provider_status="approved")
    # Only an owner-managed listing ever has a number; a Provider is portal-managed (RBAC-D).
    execute(
        scratch_url, "UPDATE listings SET contact_phone = '+923001234567' WHERE kind <> 'provider'"
    )
    before = rows(scratch_url, UNTOUCHED_SQL)

    command.downgrade(config, "0008")

    assert version(scratch_url) == "0008"
    assert not (columns(scratch_url, "listings") & CONTACT_COLUMNS)
    assert not (listing_check_constraints(scratch_url) & CONTACT_CONSTRAINTS)
    assert rows(scratch_url, UNTOUCHED_SQL) == before  # every row survives, unchanged

    command.upgrade(config, "head")

    assert version(scratch_url) == "0014"
    assert columns(scratch_url, "listings") >= CONTACT_COLUMNS
    assert rows(scratch_url, UNTOUCHED_SQL) == before
    # Re-upgrading invents nothing either: the numbers are gone with the column that held them.
    assert rows(scratch_url, "SELECT count(*) FROM listings WHERE contact_phone IS NOT NULL") == [
        (0,)
    ]
    command.check(config)


def test_0009_downgrades_all_the_way_to_base_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    # ARCHIVED: 0008 refuses to downgrade over a LIVE Provider, so the operator archives it first
    # (its own tests cover that refusal) and the whole history can then be walked back.
    seed_post_0008_world(scratch_url, provider_status="archived")

    command.downgrade(config, "base")

    assert tables(scratch_url) == {"alembic_version"}

    command.upgrade(config, "head")

    assert version(scratch_url) == "0014"
    assert columns(scratch_url, "listings") >= CONTACT_COLUMNS
    command.check(config)


# -- 0010: the grocery staff scope (GROCERY-1a; docs/backend/DATA_MODEL.md §20, AUTH_RBAC.md §32) -------

SCOPE_CHECK = "ck_staff_scope_assignments_scope_valid"
PREVIOUS_SCOPE_VALUES = {"services", "directory", "food", "education", "property", "news"}


def all_constraints(url: str) -> dict[tuple[str, str], str]:
    """Every constraint of the public schema: ``(table, name) -> definition``."""
    return {
        (str(table), str(name)): str(definition)
        for table, name, definition in rows(
            url,
            "SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) FROM pg_constraint k "
            "JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public'",
        )
    }


def schema_shape(url: str) -> tuple[object, ...]:
    """Everything about the schema that is not a constraint."""
    return (
        tables(url),
        rows(
            url,
            "SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, "
            "column_default FROM information_schema.columns WHERE table_schema = 'public' "
            "ORDER BY table_name, column_name",
        ),
        rows(
            url,
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
            "ORDER BY indexname",
        ),
        trigger_names(url),
        function_names(url),
    )


def every_row(url: str) -> dict[str, list[tuple[object, ...]]]:
    """Every row of every application table, as JSON text."""
    return {
        table: rows(url, f'SELECT to_jsonb(t)::text FROM "{table}" AS t ORDER BY 1')  # noqa: S608
        for table in sorted(tables(url) - {"alembic_version"})
    }


def scope_check_values(url: str) -> set[str]:
    definition = all_constraints(url)[("staff_scope_assignments", SCOPE_CHECK)]
    return set(re.findall(r"'([a-z_]+)'", definition))


def add_moderator(url: str, email: str, *scopes: str) -> None:
    execute(
        url,
        "INSERT INTO users (id, email, display_name) VALUES (gen_random_uuid(), :e, 'Staff User')",
        e=email,
    )
    execute(
        url,
        "INSERT INTO user_roles (user_id, role) SELECT id, 'moderator' FROM users WHERE email = :e",
        e=email,
    )
    for scope in scopes:
        execute(
            url,
            "INSERT INTO staff_scope_assignments (user_id, scope) "
            "SELECT id, :s FROM users WHERE email = :e",
            e=email,
            s=scope,
        )


def add_scope_audit(url: str, before: str, after: str) -> None:
    execute(
        url,
        "INSERT INTO staff_audit_events (id, source, action, actor_user_id, target_user_id, "
        "before, after) VALUES (gen_random_uuid(), 'web', 'scope_granted', gen_random_uuid(), "
        "gen_random_uuid(), CAST(:b AS jsonb), CAST(:a AS jsonb))",
        b=before,
        a=after,
    )


def seed_0009_staff_world(url: str) -> None:
    """A populated 0009 database: listings, categories and every kind of existing staff member."""
    seed_post_0008_world(url, provider_status="approved")
    execute(url, ADD_USER)
    execute(
        url,
        "INSERT INTO user_roles (user_id, role) "
        "SELECT id, 'admin' FROM users WHERE email = 'staff@example.test'",
    )
    for scope in sorted(PREVIOUS_SCOPE_VALUES):
        add_moderator(url, f"mod-{scope}@example.test", scope)
    add_moderator(url, "mod-every@example.test", *sorted(PREVIOUS_SCOPE_VALUES))
    add_moderator(url, "mod-paused@example.test")
    add_scope_audit(url, '{"scopes": []}', '{"scopes": ["food"]}')


def test_0010_changes_only_the_scope_check(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0009")
    before_constraints = all_constraints(scratch_url)
    before_shape = schema_shape(scratch_url)
    assert scope_check_values(scratch_url) == PREVIOUS_SCOPE_VALUES

    command.upgrade(config, "0010")

    assert version(scratch_url) == "0010"
    after = all_constraints(scratch_url)
    assert set(after) == set(before_constraints)  # no constraint appears or disappears
    assert [key for key in after if after[key] != before_constraints[key]] == [
        ("staff_scope_assignments", SCOPE_CHECK)
    ]
    assert scope_check_values(scratch_url) == PREVIOUS_SCOPE_VALUES | {"grocery"}
    assert schema_shape(scratch_url) == before_shape  # no table, column, index or trigger change
    command.upgrade(config, "head")  # `check` compares the models with HEAD, so finish the upgrade
    command.check(config)


def test_0010_changes_no_row_and_gives_nobody_grocery(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0009")
    seed_0009_staff_world(scratch_url)
    before = every_row(scratch_url)
    assert before["staff_scope_assignments"] and before["user_roles"]

    command.upgrade(config, "0010")

    assert every_row(scratch_url) == before  # every table, byte for byte
    assert (
        scalar(scratch_url, "SELECT count(*) FROM staff_scope_assignments WHERE scope = 'grocery'")
        == 0
    )


def test_the_database_scope_check_is_exactly_the_application_vocabulary(scratch_url: str) -> None:
    """Alembic's autogenerate does not compare CHECK constraints, so the no-drift test cannot see
    a ``StaffScope`` and a database check that disagree. This does."""
    command.upgrade(alembic_config(scratch_url), "head")

    assert scope_check_values(scratch_url) == {scope.value for scope in StaffScope}


def test_0010_allows_grocery_for_a_moderator_only_and_adds_no_taxonomy(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "head")

    add_moderator(scratch_url, "mod-grocery@example.test", "grocery")

    for number, bad in enumerate(("groceries", "Grocery", "multi_grocery", "")):
        with pytest.raises(IntegrityError, match=SCOPE_CHECK):
            add_moderator(scratch_url, f"bad-{number}@example.test", bad)
    # still only for a holder of the moderator role
    execute(scratch_url, ADD_USER)
    with pytest.raises(IntegrityError, match="fk_staff_scope_assignments_user_id_role_user_roles"):
        execute(
            scratch_url,
            "INSERT INTO staff_scope_assignments (user_id, scope) "
            "SELECT id, 'grocery' FROM users WHERE email = 'staff@example.test'",
        )
    # and the listing taxonomy has no grocery module: the same value is refused there
    with pytest.raises(IntegrityError, match="ck_categories_module_valid"):
        execute(
            scratch_url,
            "INSERT INTO categories (id, module, slug, name, display_order) "
            "VALUES (gen_random_uuid(), 'grocery', 'vegetables', 'Vegetables', 0)",
        )
    assert scalar(scratch_url, "SELECT count(*) FROM categories") == 0  # the migration seeds none


def test_0010_downgrades_when_nobody_holds_grocery_and_keeps_audit_history(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0010")
    add_moderator(scratch_url, "mod-food@example.test", "food")
    add_moderator(scratch_url, "mod-was-grocery@example.test")  # held it once; removed since
    add_scope_audit(scratch_url, '{"scopes": []}', '{"scopes": ["grocery"]}')
    add_scope_audit(scratch_url, '{"scopes": ["grocery"]}', '{"scopes": []}')
    before = every_row(scratch_url)

    command.downgrade(config, "0009")

    assert version(scratch_url) == "0009"
    assert scope_check_values(scratch_url) == PREVIOUS_SCOPE_VALUES
    assert every_row(scratch_url) == before  # the history that mentions grocery is untouched
    with pytest.raises(IntegrityError, match=SCOPE_CHECK):
        add_moderator(scratch_url, "too-late@example.test", "grocery")

    command.upgrade(config, "head")

    assert version(scratch_url) == "0014"
    assert scope_check_values(scratch_url) == PREVIOUS_SCOPE_VALUES | {"grocery"}
    command.check(config)


@pytest.mark.parametrize("target", ["0009", "0006", "base"])
def test_0010_refuses_to_downgrade_while_grocery_is_held_and_changes_nothing(
    scratch_url: str, target: str
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    add_moderator(scratch_url, "mod-only-grocery@example.test", "grocery")
    add_moderator(scratch_url, "mod-both@example.test", "food", "grocery")
    add_scope_audit(scratch_url, '{"scopes": []}', '{"scopes": ["grocery"]}')
    rows_before = every_row(scratch_url)
    constraints_before = all_constraints(scratch_url)

    with pytest.raises(RuntimeError, match="Refusing to downgrade 0010") as refused:
        command.downgrade(config, target)

    assert "2 grocery staff scope assignment(s)" in str(refused.value)
    assert "roll back the application code" in str(refused.value)  # it says the order
    assert version(scratch_url) == "0014"  # one transaction: the 0011 step is undone too
    assert every_row(scratch_url) == rows_before
    assert all_constraints(scratch_url) == constraints_before

    # Removing the assignments (the application does it through staff management) unblocks it.
    execute(scratch_url, "DELETE FROM staff_scope_assignments WHERE scope = 'grocery'")
    command.downgrade(config, "0009")

    assert version(scratch_url) == "0009"
    assert rows(scratch_url, "SELECT scope FROM staff_scope_assignments ORDER BY scope") == [
        ("food",)
    ]
    assert scalar(scratch_url, "SELECT count(*) FROM staff_audit_events") == 1


def test_0010_is_one_constraint_swap_with_no_data_statement(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "0009")
    buffer = io.StringIO()
    offline = alembic_config(scratch_url)
    offline.output_buffer = buffer

    command.upgrade(offline, "0009:0010", sql=True)

    lines = [line for line in buffer.getvalue().splitlines() if not line.strip().startswith("--")]
    statements = [s.strip().upper() for s in " ".join(lines).split(";") if s.strip()]
    own = [s for s in statements if "ALEMBIC_VERSION" not in s and s not in {"BEGIN", "COMMIT"}]
    assert len(own) == 2, own
    assert all(s.startswith("ALTER TABLE STAFF_SCOPE_ASSIGNMENTS ") for s in own), own
    assert "DROP CONSTRAINT" in own[0] and "ADD CONSTRAINT" in own[1]


GROCERY_0014_TRIGGERS = {
    "trg_grocery_payments_match_order",
    "trg_grocery_orders_keep_money",
    "trg_grocery_refunds_fit_order",
    "trg_grocery_refunds_append_only",
}
GROCERY_0012_TRIGGERS = {
    "trg_grocery_order_confirmations_append_only",
    "trg_grocery_payments_append_only",
    "trg_grocery_order_events_append_only",
}

# -- 0011: grocery order intake (GROCERY-1b; docs/backend/DATA_MODEL.md §21) ---------------------------

GROCERY_TRIGGERS = {
    "trg_grocery_order_status_history_append_only",
    "trg_grocery_settings_revisions_append_only",
    "trg_grocery_settings_revisions_no_truncate",
}
GROCERY_TABLES = {
    "grocery_orders",
    "grocery_order_items",
    "grocery_order_status_history",
    "grocery_daily_capacity",
    "grocery_settings_revisions",
}
DEFAULT_SETTINGS_SQL = (
    "SELECT revision, enabled, serviceable_blocks, operating_days, opens_at::text, closes_at::text, "
    "timezone, daily_capacity, max_active_orders_per_customer, max_items_per_order, actor_user_id "
    "FROM grocery_settings_revisions ORDER BY revision"
)
ORDER_COLUMNS = (
    "id, reference, customer_id, status, contact_name, contact_phone, block, address_line, "
    "service_date, submitted_at, idempotency_key_hash, request_hash, cancelled_at, cancel_reason"
)


def order_insert(**overrides: str) -> str:
    """One valid order as SQL (values are SQL expressions), with ``overrides``."""
    values = {
        "id": "gen_random_uuid()",
        "reference": "'GRC-ABCDEFGH'",
        "customer_id": "(SELECT id FROM users LIMIT 1)",
        "status": "'submitted'",
        "contact_name": "'Test Customer'",
        "contact_phone": "'+923001234567'",
        "block": "'Test Block'",
        "address_line": "'House 1, Street 1'",
        "service_date": "'2026-11-27'",
        "submitted_at": "now()",
        "idempotency_key_hash": "sha256('key-1')",
        "request_hash": "sha256('body-1')",
        "cancelled_at": "NULL",
        "cancel_reason": "NULL",
    }
    values.update(overrides)
    return f"INSERT INTO grocery_orders ({ORDER_COLUMNS}) VALUES ({', '.join(values[c.strip()] for c in ORDER_COLUMNS.split(','))})"


def item_insert(
    quantity: str = "1", unit: str = "'kg'", position: str = "1", **overrides: str
) -> str:
    values = {"name": "'Rice'", "substitution": "'ask'"}
    values.update(overrides)
    return (
        "INSERT INTO grocery_order_items (id, order_id, position, name, quantity, unit, substitution) "
        f"SELECT gen_random_uuid(), id, {position}, {values['name']}, {quantity}, {unit}, "
        f"{values['substitution']} FROM grocery_orders LIMIT 1"
    )


def history_insert(
    from_status: str = "NULL", to_status: str = "'submitted'", role: str = "'customer'"
) -> str:
    return (
        "INSERT INTO grocery_order_status_history (id, order_id, from_status, to_status, actor_user_id, actor_role) "
        f"SELECT gen_random_uuid(), id, {from_status}, {to_status}, customer_id, {role} FROM grocery_orders LIMIT 1"
    )


def check_values(url: str, table: str, name: str) -> set[str]:
    return set(re.findall(r"'([A-Za-z_/0-9]+)'", all_constraints(url)[(table, name)]))


def test_0011_adds_only_the_grocery_tables_and_changes_no_existing_row(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0010")
    seed_0009_staff_world(scratch_url)
    add_moderator(scratch_url, "mod-grocery@example.test", "grocery")
    before_rows = every_row(scratch_url)
    before_constraints = all_constraints(scratch_url)
    before_tables = tables(scratch_url)
    before_columns = {table: columns(scratch_url, table) for table in before_tables}

    command.upgrade(config, "0011")

    assert version(scratch_url) == "0011"
    assert tables(scratch_url) == before_tables | GROCERY_TABLES
    assert {table: columns(scratch_url, table) for table in before_tables} == before_columns
    after = all_constraints(scratch_url)
    assert {key: after[key] for key in before_constraints} == before_constraints
    assert {table for table, _ in set(after) - set(before_constraints)} == GROCERY_TABLES
    after_rows = every_row(scratch_url)
    assert {table: after_rows[table] for table in before_rows} == before_rows
    command.upgrade(config, "head")  # `check` compares the models with HEAD
    command.check(config)


def test_0011_starts_disabled_with_no_block_and_no_order(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "0011")

    assert rows(scratch_url, DEFAULT_SETTINGS_SQL) == [
        (
            1,
            False,
            [],
            [1, 2, 3, 4, 5, 6, 7],
            "10:00:00",
            "20:00:00",
            "Asia/Karachi",
            10,
            2,
            50,
            None,
        )
    ]
    for table in sorted(GROCERY_TABLES - {"grocery_settings_revisions"}):
        assert scalar(scratch_url, f"SELECT count(*) FROM {table}") == 0, table  # noqa: S608
    assert scalar(scratch_url, "SELECT count(*) FROM staff_scope_assignments") == 0
    assert scalar(scratch_url, "SELECT count(*) FROM categories") == 0


def test_the_grocery_database_checks_are_exactly_the_application_vocabularies(
    scratch_url: str,
) -> None:
    """Alembic does not compare CHECK constraints, so this does."""
    command.upgrade(alembic_config(scratch_url), "head")

    statuses = {status.value for status in GroceryOrderStatus}
    assert check_values(scratch_url, "grocery_orders", "ck_grocery_orders_status_valid") == statuses
    history = "grocery_order_status_history"
    assert check_values(scratch_url, history, f"ck_{history}_to_status_valid") == statuses
    assert check_values(scratch_url, history, f"ck_{history}_from_status_valid") == statuses
    assert check_values(scratch_url, history, f"ck_{history}_actor_role_valid") == {
        role.value for role in GroceryActorRole
    }
    items = "grocery_order_items"
    assert check_values(scratch_url, items, f"ck_{items}_unit_valid") == {
        u.value for u in GroceryUnit
    }
    assert check_values(scratch_url, items, f"ck_{items}_substitution_valid") == {
        s.value for s in GrocerySubstitution
    }
    assert check_values(scratch_url, items, f"ck_{items}_whole_units") == {
        u.value for u in WHOLE_UNITS
    }
    assert (
        str(MAX_ANY_QUANTITY) in all_constraints(scratch_url)[(items, f"ck_{items}_quantity_range")]
    )
    settings = "grocery_settings_revisions"
    assert check_values(scratch_url, settings, f"ck_{settings}_timezone_valid") == set(
        ALLOWED_TIMEZONES
    )
    for table, check, values in (
        ("grocery_order_confirmations", "method_valid", GroceryConfirmationMethod),
        ("grocery_order_events", "action_valid", GroceryEventAction),
        ("grocery_order_events", "issue_kind_valid", GroceryIssueKind),
        ("grocery_payments", "method_valid", GroceryPaymentMethod),
        ("grocery_refunds", "method_valid", GroceryRefundMethod),
        (settings, "payment_methods_valid", GroceryPaymentMethod),
    ):
        assert check_values(scratch_url, table, f"ck_{table}_{check}") == {v.value for v in values}


def test_0011_refuses_invalid_rows_and_protects_both_histories(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "0011")
    execute(scratch_url, ADD_USER)
    execute(scratch_url, order_insert())
    execute(scratch_url, item_insert("1.5"))
    execute(scratch_url, history_insert())

    refused = {
        "status_valid": order_insert(
            reference="'GRC-AAAAAAAB'", status="'quoted'", idempotency_key_hash="sha256('b')"
        ),
        "reference_format": order_insert(
            reference="'GRC-0000000I'", idempotency_key_hash="sha256('c')"
        ),
        "contact_phone_pk_e164": order_insert(
            reference="'GRC-AAAAAAAC'",
            contact_phone="'+447911123456'",
            idempotency_key_hash="sha256('d')",
        ),
        "cancelled_at_iff_cancelled": order_insert(
            reference="'GRC-AAAAAAAD'", status="'cancelled'", idempotency_key_hash="sha256('e')"
        ),
        "cancel_reason_only_when_cancelled": order_insert(
            reference="'GRC-AAAAAAAE'", cancel_reason="'why'", idempotency_key_hash="sha256('f')"
        ),
        "hash_lengths": order_insert(
            reference="'GRC-AAAAAAAF'",
            request_hash="'short'::bytea",
            idempotency_key_hash="sha256('g')",
        ),
        "uq_grocery_orders_reference": order_insert(idempotency_key_hash="sha256('h')"),
        "uq_grocery_orders_customer_id_idempotency_key_hash": order_insert(
            reference="'GRC-AAAAAAAG'"
        ),
        "quantity_range": item_insert("0", position="2"),
        "ck_grocery_order_items_quantity_range": item_insert("5001", unit="'gram'", position="2"),
        "whole_units": item_insert("1.5", unit="'piece'", position="2"),
        "unit_valid": item_insert("1", unit="'bag'", position="2"),
        "position_range": item_insert(position="101"),
        "uq_grocery_order_items_order_id_position": item_insert(),
        "from_status_iff_submitted": history_insert(to_status="'cancelled'"),
        "actor_role_valid": history_insert(
            from_status="'submitted'", to_status="'cancelled'", role="'staff'"
        ),
    }
    for constraint, statement in refused.items():
        with pytest.raises(IntegrityError, match=constraint):
            execute(scratch_url, statement)

    settings_columns = (
        "revision, enabled, serviceable_blocks, operating_days, opens_at, closes_at, timezone, "
        "daily_capacity, max_active_orders_per_customer, max_items_per_order, actor_user_id"
    )
    good = {
        "revision": "2",
        "enabled": "false",
        "serviceable_blocks": "'{}'",
        "operating_days": "'{1}'",
        "opens_at": "'10:00'",
        "closes_at": "'20:00'",
        "timezone": "'Asia/Karachi'",
        "daily_capacity": "10",
        "max_active_orders_per_customer": "2",
        "max_items_per_order": "50",
        "actor_user_id": "gen_random_uuid()",
    }
    bad_settings = {
        "opens_before_closes": {"closes_at": "'10:00'"},
        "daily_capacity_range": {"daily_capacity": "0"},
        "max_active_orders_range": {"max_active_orders_per_customer": "11"},
        "max_items_range": {"max_items_per_order": "101"},
        "operating_days_valid": {"operating_days": "'{0}'"},
        "blocks_no_nulls": {"serviceable_blocks": "ARRAY[NULL]::varchar[]"},
        "timezone_valid": {"timezone": "'Europe/London'"},
        "change_has_actor": {"actor_user_id": "NULL"},
        "pk_grocery_settings_revisions": {"revision": "1"},
    }
    for constraint, change in bad_settings.items():
        values = {**good, **change}
        with pytest.raises(IntegrityError, match=constraint):
            execute(
                scratch_url,
                f"INSERT INTO grocery_settings_revisions ({settings_columns}) VALUES "  # noqa: S608
                f"({', '.join(values[c.strip()] for c in settings_columns.split(','))})",
            )

    for statement in (
        "UPDATE grocery_order_status_history SET reason = 'edited'",
        "DELETE FROM grocery_order_status_history",
        "UPDATE grocery_settings_revisions SET enabled = true",
        "DELETE FROM grocery_settings_revisions",
        "TRUNCATE grocery_settings_revisions",
    ):
        with pytest.raises(Exception, match="append-only"):
            execute(scratch_url, statement)
    # an order with history cannot be deleted either
    with pytest.raises(IntegrityError, match="fk_grocery_order_status_history_order_id"):
        execute(scratch_url, "DELETE FROM grocery_orders")


def test_0011_downgrades_a_never_used_database_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0010")
    seed_0009_staff_world(scratch_url)
    before_rows = every_row(scratch_url)
    before_constraints = all_constraints(scratch_url)
    before_shape = schema_shape(scratch_url)
    command.upgrade(config, "0011")

    command.downgrade(config, "0010")

    assert version(scratch_url) == "0010"
    assert every_row(scratch_url) == before_rows
    assert all_constraints(scratch_url) == before_constraints
    assert schema_shape(scratch_url) == before_shape  # tables, indexes, triggers and function gone

    command.upgrade(config, "0011")

    assert version(scratch_url) == "0011"
    assert len(rows(scratch_url, DEFAULT_SETTINGS_SQL)) == 1
    command.upgrade(config, "head")  # `check` compares the models with HEAD
    command.check(config)


LIVE_GROCERY_DATA: dict[str, tuple[list[str], str]] = {
    "an order": ([ADD_USER, order_insert(), history_insert()], "1 grocery orders"),
    "a capacity record": (
        ["INSERT INTO grocery_daily_capacity (service_date, reserved) VALUES ('2026-11-27', 1)"],
        "1 daily capacity records",
    ),
    "a settings change": (
        [
            "INSERT INTO grocery_settings_revisions (revision, enabled, serviceable_blocks, operating_days, "
            "opens_at, closes_at, timezone, daily_capacity, max_active_orders_per_customer, "
            "max_items_per_order, actor_user_id) VALUES (2, false, '{}', '{1}', '10:00', '20:00', "
            "'Asia/Karachi', 10, 2, 50, gen_random_uuid())"
        ],
        "1 settings changes",
    ),
}


@pytest.mark.parametrize("case", list(LIVE_GROCERY_DATA))
def test_0011_refuses_to_downgrade_over_grocery_data_and_changes_nothing(
    scratch_url: str, case: str
) -> None:
    statements, expected = LIVE_GROCERY_DATA[case]
    config = alembic_config(scratch_url)
    command.upgrade(config, "0011")
    for statement in statements:
        execute(scratch_url, statement)
    rows_before = every_row(scratch_url)
    shape_before = schema_shape(scratch_url)

    with pytest.raises(RuntimeError, match="Refusing to downgrade 0011") as refused:
        command.downgrade(config, "0010")

    assert expected in str(refused.value)
    assert version(scratch_url) == "0011"
    assert every_row(scratch_url) == rows_before
    assert schema_shape(scratch_url) == shape_before


def test_0011_is_additive_ddl_and_one_default_settings_row(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "0010")
    buffer = io.StringIO()
    offline = alembic_config(scratch_url)
    offline.output_buffer = buffer

    command.upgrade(offline, "0010:0011", sql=True)

    body = "\n".join(
        line for line in buffer.getvalue().splitlines() if not line.strip().startswith("--")
    )
    function = re.search(r"CREATE FUNCTION.*?\$\$.*?\$\$;", body, re.S)
    assert function is not None
    statements = [s.strip() for s in body.replace(function.group(0), "").split(";") if s.strip()]
    own = [
        s for s in statements if "alembic_version" not in s and s.upper() not in {"BEGIN", "COMMIT"}
    ]
    data = [s for s in own if s.split()[0].upper() in {"INSERT", "UPDATE", "DELETE"}]
    assert len(data) == 1 and data[0].startswith("INSERT INTO grocery_settings_revisions")
    for statement in own:
        assert statement.split()[0].upper() in {"CREATE", "INSERT"}, statement[:90]
        assert "grocery" in statement, statement[:90]  # nothing touches an existing table


# -- 0012: grocery order management (GROCERY-2; docs/backend/DATA_MODEL.md §22) ------------------------

#: An order that staff have taken to ``confirmed``.
CONFIRMED_ORDER = (
    "UPDATE grocery_orders SET status = 'confirmed', agreed_total_paisa = 1000, "
    "final_due_paisa = 1000"
)
AGREEMENT = (
    "INSERT INTO grocery_order_confirmations (id, order_id, sequence, items_subtotal_paisa, "
    "service_fee_paisa, delivery_fee_paisa, total_paisa, method, substitutions_agreed, "
    "recorded_by, recorded_at) "
    "SELECT gen_random_uuid(), id, 1, 900, 100, 0, {total}, 'phone_call', false, customer_id, now() "
    "FROM grocery_orders LIMIT 1"
)
PAYMENT = (
    "INSERT INTO grocery_payments (id, order_id, method, amount_due_paisa, amount_collected_paisa, "
    "collected_by, collected_at) SELECT gen_random_uuid(), id, 'cash_on_delivery', 1000, "
    "{collected}, customer_id, now() FROM grocery_orders LIMIT 1"
)
ORDER_EVENT = (
    "INSERT INTO grocery_order_events (id, order_id, action, actor_user_id, subject_user_id, "
    "amount_before_paisa, amount_after_paisa, issue_kind, note) SELECT gen_random_uuid(), id, "
    "'{action}', customer_id, {subject}, {before}, {after}, {kind}, {note} "
    "FROM grocery_orders LIMIT 1"
)
NEW_SETTINGS_VERSION = (
    "INSERT INTO grocery_settings_revisions (revision, enabled, serviceable_blocks, "
    "operating_days, opens_at, closes_at, timezone, daily_capacity, "
    "max_active_orders_per_customer, max_items_per_order, actor_user_id, max_order_value_paisa) "
    "SELECT revision + 1, enabled, serviceable_blocks, operating_days, opens_at, closes_at, "
    "timezone, daily_capacity, max_active_orders_per_customer, max_items_per_order, "
    "gen_random_uuid(), {cap} FROM grocery_settings_revisions ORDER BY revision DESC LIMIT 1"
)


def order_event(
    action: str,
    subject: str = "NULL",
    before: str = "NULL",
    after: str = "NULL",
    kind: str = "NULL",
    note: str = "NULL",
) -> str:
    return ORDER_EVENT.format(
        action=action, subject=subject, before=before, after=after, kind=kind, note=note
    )


def seed_intake_order(url: str) -> None:
    for statement in (ADD_USER, order_insert(), item_insert("1.5"), history_insert()):
        execute(url, statement)


def test_0012_is_additive_and_keeps_every_existing_order(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0011")
    seed_intake_order(scratch_url)
    before = every_row(scratch_url)
    old_orders = f"SELECT {ORDER_COLUMNS} FROM grocery_orders"  # noqa: S608
    old_order = rows(scratch_url, old_orders)
    old_settings = rows(scratch_url, DEFAULT_SETTINGS_SQL)
    old_tables = tables(scratch_url)

    command.upgrade(config, "0012")

    assert version(scratch_url) == "0012"
    assert tables(scratch_url) - old_tables == {
        "grocery_order_confirmations",
        "grocery_payments",
        "grocery_order_events",
    }
    assert rows(scratch_url, old_orders) == old_order
    assert rows(scratch_url, DEFAULT_SETTINGS_SQL) == old_settings  # still disabled, no block
    assert rows(scratch_url, "SELECT max_order_value_paisa FROM grocery_settings_revisions") == [
        (2_000_000,)
    ]
    assert rows(
        scratch_url,
        "SELECT assigned_to, assigned_at, agreed_total_paisa, final_due_paisa, delivered_at "
        "FROM grocery_orders",
    ) == [(None, None, None, None, None)]
    after = every_row(scratch_url)
    untouched = set(before) - {"grocery_orders", "grocery_settings_revisions"}
    assert {table: after[table] for table in untouched} == {t: before[t] for t in untouched}
    assert trigger_names(scratch_url) >= GROCERY_0012_TRIGGERS
    command.upgrade(config, "head")  # Alembic compares the models with the NEWEST schema only
    command.check(config)


def test_0012_the_database_itself_refuses_inconsistent_handling(scratch_url: str) -> None:
    command.upgrade(alembic_config(scratch_url), "head")
    seed_intake_order(scratch_url)
    update = "UPDATE grocery_orders SET "
    priced = "agreed_total_paisa = 10, final_due_paisa = 10"
    refused = {
        "agreement_required": f"{update}status = 'confirmed'",
        "no_amount_when_submitted": f"{update}{priced}",
        "amounts_together": f"{update}status = 'confirmed', agreed_total_paisa = 10",
        # more due than was ever agreed
        "amounts_valid": f"{update}status = 'confirmed', agreed_total_paisa = 10, "
        "final_due_paisa = 11",
        "delivered_at_iff_delivered": f"{update}status = 'delivered', {priced}",
        "assignment_complete": f"{update}assigned_to = customer_id",
        "total_is_the_sum": AGREEMENT.format(total=1001),
        # substitutions declared, with no note saying what was agreed
        "substitution_note_required": AGREEMENT.format(total=1000).replace(
            "'phone_call', false", "'phone_call', true"
        ),
        "subject_iff_assignment": order_event("claimed"),
        "amounts_iff_reduction": order_event(
            "amount_reduced", before="10", after="10", note="'why'"
        ),
        "kind_iff_issue": order_event("issue_recorded", note="'why'"),
        "reason_required": order_event("issue_recorded", kind="'other'"),
        "action_valid": order_event("refunded"),
        "max_order_value_range": NEW_SETTINGS_VERSION.format(cap=99),
    }
    for constraint, statement in refused.items():
        with pytest.raises(IntegrityError, match=constraint):
            execute(scratch_url, statement)

    execute(scratch_url, CONFIRMED_ORDER)
    execute(scratch_url, AGREEMENT.format(total=1000))
    # since 0014 a payment needs an agreed order, so this is checked after the confirmation
    with pytest.raises(IntegrityError, match="collected_is_the_amount_due"):
        execute(scratch_url, PAYMENT.format(collected=999))
    execute(scratch_url, PAYMENT.format(collected=1000))
    execute(scratch_url, order_event("claimed", subject="customer_id"))
    # one collection per order, one agreement per sequence number
    for constraint, statement in (
        ("uq_grocery_payments_order_id", PAYMENT.format(collected=1000)),
        ("uq_grocery_order_confirmations_order_id_sequence", AGREEMENT.format(total=1000)),
    ):
        with pytest.raises(IntegrityError, match=constraint):
            execute(scratch_url, statement)
    for table, column in (
        ("grocery_order_confirmations", "total_paisa"),
        ("grocery_payments", "amount_collected_paisa"),
        ("grocery_order_events", "note"),
    ):
        for statement in (
            f"UPDATE {table} SET {column} = {column}",  # noqa: S608
            f"DELETE FROM {table}",  # noqa: S608
        ):
            with pytest.raises(Exception, match="append-only"):
                execute(scratch_url, statement)


def test_0012_downgrades_when_nothing_was_handled_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0011")
    seed_intake_order(scratch_url)
    shape = schema_shape(scratch_url)
    constraints = all_constraints(scratch_url)
    data = every_row(scratch_url)
    command.upgrade(config, "0012")

    command.downgrade(config, "0011")

    assert version(scratch_url) == "0011"
    assert schema_shape(scratch_url) == shape
    assert all_constraints(scratch_url) == constraints
    assert every_row(scratch_url) == data
    command.upgrade(config, "head")
    command.check(config)


LIVE_HANDLING: dict[str, tuple[str, str]] = {
    "a confirmed order": (CONFIRMED_ORDER, "1 orders in a staff-handled status"),
    "an assignment": (
        "UPDATE grocery_orders SET assigned_to = customer_id, assigned_at = now()",
        "1 assigned or priced orders",
    ),
    "an agreement": (AGREEMENT.format(total=1000), "1 recorded customer agreements"),
    "a cash collection": (
        f"{CONFIRMED_ORDER}; {PAYMENT.format(collected=1000)}",
        "1 cash collections",
    ),
    "a staff event": (order_event("claimed", subject="customer_id"), "1 staff order events"),
    "a staff history row": (
        history_insert(from_status="'submitted'", to_status="'cancelled'", role="'staff'"),
        "1 staff history rows",
    ),
    "a changed value cap": (
        NEW_SETTINGS_VERSION.format(cap=3_000_000),
        "1 settings versions with a changed value cap",
    ),
}


@pytest.mark.parametrize("case", list(LIVE_HANDLING))
def test_0012_refuses_to_downgrade_over_order_handling_and_changes_nothing(
    scratch_url: str, case: str
) -> None:
    statement, expected = LIVE_HANDLING[case]
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    seed_intake_order(scratch_url)
    execute(scratch_url, statement)
    data, shape = every_row(scratch_url), schema_shape(scratch_url)

    with pytest.raises(RuntimeError, match="Refusing to downgrade 0012") as refused:
        command.downgrade(config, "0011")

    assert expected in str(refused.value)
    assert version(scratch_url) == "0014"
    assert every_row(scratch_url) == data
    assert schema_shape(scratch_url) == shape


# -- 0013: the staff revision (GROCERY-4A, AUTH_RBAC.md §39) ----------------------------------------


def _accounts(url: str) -> list[tuple[object, ...]]:
    """Every account, every column that existed before 0013."""
    with shared_engine(url).connect() as connection:
        return [
            tuple(row)
            for row in connection.execute(
                text(
                    "SELECT id, email, email_verified_at, display_name, password_hash, status, "
                    "last_login_at, created_at, updated_at FROM users ORDER BY email"
                )
            )
        ]


def _populated_0012(url: str) -> None:
    """A 0012 database with an ordinary account, a Super Admin and a scoped Moderator."""
    command.upgrade(alembic_config(url), "0012")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            for name, role in (("plain", None), ("boss", "admin"), ("helper", "moderator")):
                user_id = connection.execute(
                    text(
                        "INSERT INTO users (id, email, display_name) "
                        "VALUES (gen_random_uuid(), :e, :n) RETURNING id"
                    ),
                    {"e": f"{name}@example.org", "n": name.title()},
                ).scalar_one()
                if role:
                    connection.execute(
                        text("INSERT INTO user_roles (user_id, role) VALUES (:u, :r)"),
                        {"u": user_id, "r": role},
                    )
                if role == "moderator":
                    connection.execute(
                        text(
                            "INSERT INTO staff_scope_assignments (user_id, scope) "
                            "VALUES (:u, 'food')"
                        ),
                        {"u": user_id},
                    )
    finally:
        engine.dispose()


def _count(url: str, table: str) -> int:
    with shared_engine(url).connect() as connection:
        return int(connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one())


def test_0013_adds_one_column_and_leaves_every_row_as_it_was(scratch_url: str) -> None:
    _populated_0012(scratch_url)
    before, columns_before = _accounts(scratch_url), columns(scratch_url, "users")
    roles = _count(scratch_url, "user_roles"), _count(scratch_url, "staff_scope_assignments")

    command.upgrade(alembic_config(scratch_url), "head")

    assert version(scratch_url) == "0014"
    assert columns(scratch_url, "users") - columns_before == {"staff_revision"}
    assert _accounts(scratch_url) == before  # not even updated_at moved
    with shared_engine(scratch_url).connect() as connection:
        assert list(connection.execute(text("SELECT staff_revision FROM users")).scalars()) == [
            0,
            0,
            0,
        ]
    assert (
        _count(scratch_url, "user_roles"),
        _count(scratch_url, "staff_scope_assignments"),
    ) == roles
    command.check(alembic_config(scratch_url))  # the model and the migration agree


def test_0013_defaults_new_accounts_to_zero_and_refuses_a_negative_revision(
    scratch_url: str,
) -> None:
    command.upgrade(alembic_config(scratch_url), "head")
    insert = text(
        "INSERT INTO users (id, email, display_name) "
        "VALUES (gen_random_uuid(), 'new@example.org', 'New') RETURNING staff_revision"
    )
    with shared_engine(scratch_url).begin() as connection:
        assert connection.execute(insert).scalar_one() == 0
    with (
        pytest.raises(IntegrityError, match="ck_users_staff_revision_non_negative"),
        shared_engine(scratch_url).begin() as connection,
    ):
        connection.execute(text("UPDATE users SET staff_revision = -1"))


def test_0013_downgrades_keeping_every_row_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    _populated_0012(scratch_url)
    command.upgrade(config, "head")
    with shared_engine(scratch_url).begin() as connection:
        connection.execute(text("UPDATE users SET staff_revision = 4"))
    before = _accounts(scratch_url)

    command.downgrade(config, "0012")

    assert version(scratch_url) == "0012"
    assert "staff_revision" not in columns(scratch_url, "users")
    assert _accounts(scratch_url) == before and _count(scratch_url, "user_roles") == 2
    command.upgrade(config, "head")
    assert version(scratch_url) == "0014"
    command.check(config)


def test_0013_is_ddl_only(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    buffer = io.StringIO()
    config.output_buffer = buffer

    command.upgrade(config, "0012:0013", sql=True)

    statements = [s.strip().upper() for s in buffer.getvalue().split(";") if s.strip()]
    assert any(s.endswith("CHECK (STAFF_REVISION >= 0)") for s in statements)
    # The one data statement is Alembic's own version stamp.
    writes = [s for s in statements if s.startswith(("INSERT", "UPDATE", "DELETE"))]
    assert len(writes) == 1 and writes[0].startswith("UPDATE ALEMBIC_VERSION")


# -- 0014: flexible payments, manual refunds and all of B-17 (GROCERY-4C; DATA_MODEL.md §24) -------

#: What 0014 adds to rows that already existed.
ADDED_0014 = " - 'payment_methods' - 'covers_all_b17' - 'reference'"


def rows_as_at_0013(url: str) -> dict[str, list[tuple[object, ...]]]:
    """Every row of every table, without the columns 0014 added."""
    return {
        table: rows(
            url,
            f'SELECT (to_jsonb(t){ADDED_0014})::text FROM "{table}" AS t ORDER BY 1',  # noqa: S608
        )
        for table in sorted(tables(url) - {"alembic_version", "grocery_refunds"})
    }


def seed_collected_order(url: str) -> None:
    """A 0013 database holding a DELIVERED cash order, as production would."""
    seed_intake_order(url)
    for statement in (
        CONFIRMED_ORDER,
        AGREEMENT.format(total=1000),
        PAYMENT.format(collected=1000),
        "UPDATE grocery_orders SET status = 'delivered', delivered_at = now()",
    ):
        execute(url, statement)


def test_0014_is_additive_and_keeps_every_existing_order_and_payment(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0013")
    seed_collected_order(scratch_url)
    execute(scratch_url, NEW_SETTINGS_VERSION.format(cap=3_000_000))
    before, old_tables = rows_as_at_0013(scratch_url), tables(scratch_url)

    command.upgrade(config, "0014")

    assert version(scratch_url) == "0014"
    assert tables(scratch_url) - old_tables == {"grocery_refunds"}
    assert rows_as_at_0013(scratch_url) == before  # no row was rewritten
    assert (
        rows(
            scratch_url,
            "SELECT payment_methods, covers_all_b17 FROM grocery_settings_revisions ORDER BY revision",
        )
        == [(["cash_on_delivery"], False)] * 2
    )  # safe defaults, on history too
    assert rows(scratch_url, "SELECT method, reference FROM grocery_payments") == [
        ("cash_on_delivery", None)
    ]
    assert scalar(scratch_url, "SELECT count(*) FROM grocery_refunds") == 0
    assert trigger_names(scratch_url) >= GROCERY_0014_TRIGGERS
    command.check(config)


def test_0014_lets_the_previous_applications_cash_writes_continue(scratch_url: str) -> None:
    """The columns 0013 code does not know about have safe values: a cash order still goes from
    confirmed to collected to delivered, and a settings version can still be added."""
    command.upgrade(alembic_config(scratch_url), "head")

    seed_collected_order(scratch_url)
    execute(scratch_url, NEW_SETTINGS_VERSION.format(cap=3_000_000))

    assert scalar(scratch_url, "SELECT status FROM grocery_orders") == "delivered"
    assert rows(
        scratch_url,
        "SELECT payment_methods, covers_all_b17 FROM grocery_settings_revisions "
        "ORDER BY revision DESC LIMIT 1",
    ) == [(["cash_on_delivery"], False)]


def test_0014_downgrades_with_cash_only_keeping_every_row_and_upgrades_again(
    scratch_url: str,
) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "0013")
    seed_collected_order(scratch_url)
    shape, constraints = schema_shape(scratch_url), all_constraints(scratch_url)
    data = every_row(scratch_url)
    command.upgrade(config, "0014")

    command.downgrade(config, "0013")

    assert version(scratch_url) == "0013"
    assert schema_shape(scratch_url) == shape
    assert all_constraints(scratch_url) == constraints
    assert every_row(scratch_url) == data
    command.upgrade(config, "head")
    assert version(scratch_url) == "0014"
    command.check(config)


def settings_version(columns_sql: str, values_sql: str) -> str:
    return (
        "INSERT INTO grocery_settings_revisions (revision, enabled, serviceable_blocks, "
        "operating_days, opens_at, closes_at, timezone, daily_capacity, "
        f"max_active_orders_per_customer, max_items_per_order, actor_user_id, {columns_sql}) "
        "SELECT revision + 1, enabled, ARRAY['Test Block']::varchar[], operating_days, opens_at, "
        "closes_at, timezone, daily_capacity, max_active_orders_per_customer, "
        f"max_items_per_order, gen_random_uuid(), {values_sql} FROM grocery_settings_revisions "
        "ORDER BY revision DESC LIMIT 1"
    )


CARD_PAYMENT = (
    PAYMENT.format(collected=1000)
    .replace("collected_by, collected_at) SELECT", "reference, collected_by, collected_at) SELECT")
    .replace("'cash_on_delivery', 1000, 1000, ", "'card', 1000, 1000, 'SLIP0001', ")
)
CASH_REFUND = (
    "INSERT INTO grocery_refunds (id, order_id, payment_id, amount_paisa, method, reason, "
    "refunded_by, refunded_at) SELECT gen_random_uuid(), order_id, id, amount_collected_paisa, "
    "'cash', 'Returned in person', collected_by, now() FROM grocery_payments"
)

LIVE_0014: dict[str, tuple[tuple[str, ...], str]] = {
    "a card payment": ((CONFIRMED_ORDER, CARD_PAYMENT), "1 payments other than cash"),
    "a refund": (
        (CONFIRMED_ORDER, PAYMENT.format(collected=1000), CASH_REFUND),
        "1 refunds",
    ),
    "a switched-on method": (
        (settings_version("payment_methods", "ARRAY['cash_on_delivery','card']::varchar[]"),),
        "1 settings versions with payment methods",
    ),
    "a coverage confirmation": (
        (settings_version("covers_all_b17", "true"),),
        "1 settings versions with payment methods",
    ),
}


@pytest.mark.parametrize("case", list(LIVE_0014))
def test_0014_refuses_to_downgrade_over_what_it_added_and_changes_nothing(
    scratch_url: str, case: str
) -> None:
    statements, expected = LIVE_0014[case]
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")
    seed_intake_order(scratch_url)
    for statement in statements:
        execute(scratch_url, statement)
    data, shape = every_row(scratch_url), schema_shape(scratch_url)

    with pytest.raises(RuntimeError, match="Refusing to downgrade 0014") as refused:
        command.downgrade(config, "0013")

    assert expected in str(refused.value)
    assert version(scratch_url) == "0014"
    assert every_row(scratch_url) == data
    assert schema_shape(scratch_url) == shape


def test_0014_is_ddl_only_and_touches_only_grocery_tables(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    buffer = io.StringIO()
    config.output_buffer = buffer

    command.upgrade(config, "0013:0014", sql=True)

    body = "\n".join(
        line for line in buffer.getvalue().splitlines() if not line.strip().startswith("--")
    )
    body = re.sub(r"CREATE FUNCTION.*?\$\$.*?\$\$;", "", body, flags=re.S)
    own = [
        s.strip()
        for s in body.split(";")
        if s.strip() and "alembic_version" not in s and s.strip().upper() not in {"BEGIN", "COMMIT"}
    ]
    assert own
    for statement in own:
        assert statement.split()[0].upper() in {"ALTER", "CREATE"}, statement[:90]
        assert "grocery" in statement, statement[:90]
        assert "DROP COLUMN" not in statement.upper(), statement[:90]
