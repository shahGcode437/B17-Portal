"""Shared fixtures.

Isolation rules for the backend suite:
  * every app under test is built from an explicit ``Settings(_env_file=None, environment="test")``
    — the developer's real ``.env`` and shell variables are never read;
  * variables the settings read are removed from the environment for each test;
  * ``app.main`` (which builds an app from the real environment at import time) is not imported
    here; it is only exercised in a subprocess with a controlled environment.
There is no database in this phase, so there is nothing else to guard yet.
"""

from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app

ALLOWED_ORIGIN = "http://localhost:5173"
SETTINGS_ENV_VARS = (
    "APP_NAME",
    "APP_VERSION",
    "ENVIRONMENT",
    "DEBUG",
    "API_V1_PREFIX",
    "FRONTEND_ORIGINS",
    "LOG_LEVEL",
)


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in SETTINGS_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ENVIRONMENT", "test")


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
