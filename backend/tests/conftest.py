"""Shared fixtures.

Isolation rules for the backend suite (``tests/isolation.py`` enforces the first three):
  * no ``Settings`` built in the test process reads a ``.env`` file - not even through
    ``get_settings()``, a CLI or Alembic;
  * variables the settings read are removed from the environment, at import and for each test;
  * sockets may reach only this machine: no test can contact Google, an e-mail provider or any
    other service;
  * ``app.main`` (which builds an app from the real environment at import time) is not imported
    here; it is only exercised in a subprocess with a controlled environment.
Database tests (``tests/db``) additionally require an explicit, validated ``TEST_DATABASE_URL`` —
see ``tests/db_safety.py`` and ``tests/db/conftest.py``. ``DATABASE_URL`` (the application
database) is removed from the environment for every test.
"""

from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.factory import create_app
from tests import isolation
from tests.isolation import SETTINGS_ENV_VARS

# Before any test module is imported or any fixture runs.
isolation.install()

ALLOWED_ORIGIN = "http://localhost:5173"


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in SETTINGS_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ENVIRONMENT", "test")
    get_settings.cache_clear()  # no test inherits settings another test built
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _no_outside_network() -> Iterator[None]:
    """A refused connection fails the test even when the code under test swallowed the error."""
    isolation.blocked_attempts.clear()
    yield
    attempts = list(isolation.blocked_attempts)
    isolation.blocked_attempts.clear()
    if attempts:
        pytest.fail(f"the test tried to reach outside this machine: {attempts}", pytrace=False)


@pytest.fixture
def make_settings() -> Callable[..., Settings]:
    """Build isolated settings; keyword arguments override the test defaults."""

    def build(**overrides: object) -> Settings:
        values: dict[str, object] = {
            "environment": "test",
            "app_version": "0.0.0-test",
            "frontend_origins": [ALLOWED_ORIGIN],
        }
        values.update(overrides)
        return Settings(_env_file=None, **values)  # type: ignore[arg-type]

    return build


@pytest.fixture
def settings(make_settings: Callable[..., Settings]) -> Settings:
    return make_settings()


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    # raise_server_exceptions=False: an unexpected error must come back as the 500 envelope,
    # exactly as a real client would see it, instead of re-raising inside the test.
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
