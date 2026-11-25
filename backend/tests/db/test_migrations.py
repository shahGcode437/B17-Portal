"""Alembic: a fresh database upgrades to head, downgrades to base, upgrades again, and the models
match the migrations (no drift). Runs against a scratch database so it cannot disturb the shared
test schema."""

import io
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError

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
    try:
        yield scratch.render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def tables(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return set(
                connection.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                ).scalars()
            )
    finally:
        engine.dispose()


def version(url: str) -> str | None:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            assert_connected_to(connection, engine.url.database or "")
            return connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()


def test_a_fresh_database_upgrades_to_head(scratch_url: str) -> None:
    assert tables(scratch_url) == set()

    command.upgrade(alembic_config(scratch_url), "head")

    assert tables(scratch_url) == EXPECTED_TABLES | {"alembic_version"}
    assert version(scratch_url) == "0009"


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

    assert script.get_heads() == ["0009"]
    assert [revision.revision for revision in script.walk_revisions()] == [
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
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name = :t"
                    ),
                    {"t": table},
                ).scalars()
            )
    finally:
        engine.dispose()


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
    assert version(scratch_url) == "0009"
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
    assert version(scratch_url) == "0009"
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
    assert version(scratch_url) == "0009" and "oauth_flows" in tables(scratch_url)


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
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return [tuple(row) for row in connection.execute(text(sql))]
    finally:
        engine.dispose()


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
    assert version(scratch_url) == "0009"
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
    assert version(scratch_url) == "0009"
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
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(text(sql), params)
    finally:
        engine.dispose()


def scalar(url: str, sql: str, **params: object) -> object:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql), params).scalar_one()
    finally:
        engine.dispose()


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

    assert version(scratch_url) == "0009" and tables(scratch_url) >= STAFF_TABLES
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
    assert version(scratch_url) == "0009"  # nothing was downgraded...
    assert tables(scratch_url) == tables_before  # ...no table was dropped...
    assert trigger_names(scratch_url) == STAFF_TRIGGERS  # ...and the protection is still in place
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

    command.upgrade(config, "head")

    assert version(scratch_url) == "0009"
    assert columns(scratch_url, "listings") == before_columns | CONTACT_COLUMNS
    assert listing_check_constraints(scratch_url) == before_constraints | CONTACT_CONSTRAINTS
    assert tables(scratch_url) == before_tables  # no table appears or disappears
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

    assert version(scratch_url) == "0009"
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

    assert version(scratch_url) == "0009"
    assert columns(scratch_url, "listings") >= CONTACT_COLUMNS
    command.check(config)
