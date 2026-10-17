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
    assert version(scratch_url) == "0004"


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

    assert script.get_heads() == ["0004"]
    assert [revision.revision for revision in script.walk_revisions()] == [
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
    assert version(scratch_url) == "0004"
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
    assert version(scratch_url) == "0004"
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
    command.check(config)  # no drift between the models and the migrations


def test_0004_downgrades_to_0003_and_upgrades_again(scratch_url: str) -> None:
    config = alembic_config(scratch_url)
    command.upgrade(config, "head")

    command.downgrade(config, "0003")

    assert version(scratch_url) == "0003" and "oauth_flows" not in tables(scratch_url)
    assert "uq_auth_identities_user_id_provider" not in unique_constraints(
        scratch_url, "auth_identities"
    )
    command.upgrade(config, "head")
    assert version(scratch_url) == "0004" and "oauth_flows" in tables(scratch_url)


def test_0004_refuses_to_run_over_duplicate_provider_identities(scratch_url: str) -> None:
    """Loud by design: a user holding two identities of one provider must be reconciled first."""
    config = alembic_config(scratch_url)
    command.upgrade(config, "0003")
    insert_user_with_identities(scratch_url, ["sub-1", "sub-2"])

    with pytest.raises(Exception, match="uq_auth_identities_user_id_provider"):
        command.upgrade(config, "0004")

    assert version(scratch_url) == "0003"  # the failed migration rolled back completely
