"""Fixtures for tests that run against real PostgreSQL (never SQLite — the constraints under test
are PostgreSQL behavior).

Lifecycle (one strategy, no order dependence):

* **per test session**: validate the test database (``tests/db_safety.py``), drop and recreate its
  ``public`` schema, run ``alembic upgrade head`` (so the migrations themselves are what the tests
  exercise) and seed the reference taxonomy;
* **per test**: a connection-level transaction wraps the test; the ``Session`` joins it with
  SAVEPOINTs, so a service's ``commit()`` releases a savepoint and the whole test is rolled back at
  the end. Nothing a test writes is visible to another test, and nothing needs cleaning up.

If ``TEST_DATABASE_URL`` is unset the tests are skipped locally, but FAIL when ``CI`` is set, so a
CI misconfiguration can never silently turn the database suite off.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from dotenv import dotenv_values
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db.reference_data import REFERENCE_CATEGORIES
from app.db.seed import seed_reference_data
from tests.db_safety import UnsafeTestDatabaseError, assert_connected_to, assert_safe_test_database

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _from_environment(name: str) -> str | None:
    """A variable from the process environment, else from a local ``backend/.env``."""
    return os.environ.get(name) or dotenv_values(BACKEND_ROOT / ".env").get(name) or None


# Captured at import time: the autouse fixture in tests/conftest.py clears DATABASE_URL per test.
TEST_DATABASE_URL = _from_environment("TEST_DATABASE_URL")
PROTECTED_DATABASE_URL = _from_environment("DATABASE_URL")


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.attributes["url"] = url
    config.attributes["skip_logging_config"] = True
    return config


@pytest.fixture(scope="session")
def test_database_url() -> URL:
    """The validated test database URL, or a skip/failure explaining how to provide one."""
    if not TEST_DATABASE_URL:
        message = (
            "TEST_DATABASE_URL is not set. Start PostgreSQL (`docker compose up -d db` in "
            "backend/) and set TEST_DATABASE_URL (see backend/.env.example)."
        )
        if os.environ.get("CI"):
            pytest.fail(message, pytrace=False)  # CI must never skip the database suite
        pytest.skip(message)
    try:
        return assert_safe_test_database(TEST_DATABASE_URL, protected_urls=[PROTECTED_DATABASE_URL])
    except UnsafeTestDatabaseError as error:
        pytest.fail(f"UNSAFE TEST DATABASE: {error}", pytrace=False)


def reset_schema(engine: Engine, expected_database: str) -> None:
    """Drop and recreate ``public``. Only ever called after the safety checks have passed."""
    with engine.begin() as connection:
        assert_connected_to(connection, expected_database)  # last line of defense
        connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session")
def db_engine(test_database_url: URL) -> Iterator[Engine]:
    url = test_database_url.render_as_string(hide_password=False)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        assert test_database_url.database is not None
        try:
            reset_schema(engine, test_database_url.database)
        except OperationalError as error:
            pytest.fail(
                "Cannot connect to the test database. Is PostgreSQL running "
                f"(`docker compose up -d db`)? ({type(error).__name__})",
                pytrace=False,
            )
        command.upgrade(alembic_config(url), "head")
        with Session(engine) as session:
            seed_reference_data(session)
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def db_session(db_engine: Engine) -> Iterator[Session]:
    """A session whose work (including service-level commits) is rolled back after the test."""
    connection = db_engine.connect()
    outer = connection.begin()
    session = Session(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture(scope="session")
def reference_category_count() -> int:
    return len(REFERENCE_CATEGORIES)
