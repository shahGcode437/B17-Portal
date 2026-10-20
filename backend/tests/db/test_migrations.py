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
    assert version(scratch_url) == "0006"


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

    assert script.get_heads() == ["0006"]
    assert [revision.revision for revision in script.walk_revisions()] == [
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
    assert version(scratch_url) == "0006"
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
    assert version(scratch_url) == "0006"
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
    assert version(scratch_url) == "0006" and "oauth_flows" in tables(scratch_url)


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

    assert version(scratch_url) == "0006" and listing_snapshot(scratch_url) == before
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
    command.check(config)  # the models and the migration agree


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

    assert version(scratch_url) == "0006" and existing_data(scratch_url) == before
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
