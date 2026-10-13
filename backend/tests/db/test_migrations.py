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
    assert version(scratch_url) == "0001"


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

    assert script.get_heads() == ["0001"]
    assert len(list(script.walk_revisions())) == 1


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
