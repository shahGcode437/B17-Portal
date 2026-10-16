import pytest
from pydantic import ValidationError

from app import __version__
from app.core.config import DEVELOPMENT_FRONTEND_ORIGINS, Settings

ORIGIN = "https://app.example.org"
#: What a staging/production deployment must configure (Phase 11B fail-fast validation).
HOSTED: dict[str, object] = {"frontend_origins": [ORIGIN], "frontend_base_url": ORIGIN}


def load(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


def test_defaults_are_safe_and_nothing_secret_is_configured() -> None:
    settings = load(
        environment="production",
        frontend_origins=[ORIGIN],
        frontend_base_url=ORIGIN,
    )

    assert settings.environment == "production"
    assert settings.debug is False
    assert settings.api_v1_prefix == "/api/v1"
    assert settings.app_version == __version__
    assert settings.frontend_origins == [ORIGIN]  # explicit origins are required when hosted
    assert settings.auth_cookie_secure is True and settings.email_backend == "disabled"
    # no secrets configured by name (the Argon2 tuning knobs are not secrets)
    assert not any(
        "secret" in name or ("password" in name and "password_hash" not in name)
        for name in Settings.model_fields
    )


def test_settings_are_read_from_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("APP_NAME", "Custom API")
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    monkeypatch.setenv("API_V1_PREFIX", "/api/v9")
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://app.example.org")
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://app.example.org")

    settings = load()

    assert (settings.environment, settings.debug) == ("staging", True)
    assert (settings.app_name, settings.app_version) == ("Custom API", "9.9.9")
    assert settings.api_v1_prefix == "/api/v9"
    assert settings.frontend_origins == ["https://app.example.org"]


def test_initialisation_values_win_over_environment_variables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")

    assert load(environment="test").environment == "test"


def test_unknown_environment_is_rejected() -> None:
    with pytest.raises(ValidationError):
        load(environment="prod")


def test_development_defaults_to_the_vite_origins_only_when_unset() -> None:
    assert load(environment="development").frontend_origins == DEVELOPMENT_FRONTEND_ORIGINS
    assert load(environment="development", frontend_origins=[]).frontend_origins == []
    assert load(environment="test").frontend_origins == []
    assert load(environment="staging", **HOSTED).frontend_origins == [ORIGIN]


def test_origins_accept_a_comma_separated_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRONTEND_ORIGINS", " http://localhost:5173 , http://127.0.0.1:4173 ,")

    assert load().frontend_origins == ["http://localhost:5173", "http://127.0.0.1:4173"]


def test_origins_accept_a_json_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRONTEND_ORIGINS", '["https://a.example.org","https://b.example.org"]')

    assert load().frontend_origins == ["https://a.example.org", "https://b.example.org"]


def test_origins_are_normalized_and_deduplicated() -> None:
    settings = load(frontend_origins=["http://localhost:5173/", "http://localhost:5173"])

    assert settings.frontend_origins == ["http://localhost:5173"]


@pytest.mark.parametrize(
    "bad",
    [
        "*",
        "https://*.example.org",
        "localhost:5173",  # no scheme
        "ftp://example.org",
        "https://example.org/app",  # path
        "https://example.org?x=1",
        "https://user:pass@example.org",
    ],
)
def test_wildcard_and_malformed_origins_are_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        load(frontend_origins=[bad])


@pytest.mark.parametrize("bad", ["api/v1", "/api/v1/", "/api v1", ""])
def test_api_prefix_must_be_a_clean_path(bad: str) -> None:
    with pytest.raises(ValidationError):
        load(api_v1_prefix=bad)


def test_log_level_defaults_follow_debug_and_can_be_overridden() -> None:
    assert load().effective_log_level == "INFO"
    assert load(debug=True).effective_log_level == "DEBUG"
    assert load(debug=True, log_level="warning").effective_log_level == "WARNING"
    with pytest.raises(ValidationError):
        load(log_level="loud")


def test_docs_are_enabled_everywhere_except_production() -> None:
    assert load(environment="development").docs_enabled
    assert load(environment="test").docs_enabled
    assert load(environment="staging", **HOSTED).docs_enabled
    assert not load(environment="production", **HOSTED).docs_enabled


# -- database settings ------------------------------------------------------------------------


def test_the_database_url_is_optional_and_an_empty_value_means_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert load().database_url is None
    monkeypatch.setenv("DATABASE_URL", "   ")

    assert load().database_url is None


def test_the_database_url_must_be_a_psycopg_postgresql_url() -> None:
    ok = load(database_url="postgresql+psycopg://u:p@127.0.0.1:5432/app")
    assert ok.database_url is not None

    for bad in ("postgresql://u:p@h/db", "sqlite:///x.db", "mysql://u:p@h/db", "postgres://u@h/db"):
        with pytest.raises(ValidationError):
            load(database_url=bad)


def test_the_database_url_is_a_secret_and_never_appears_in_repr_or_dumps() -> None:
    settings = load(database_url="postgresql+psycopg://user:hunter2@127.0.0.1:5432/app")

    assert "hunter2" not in repr(settings)
    assert "hunter2" not in str(settings.model_dump())
    assert settings.database_url is not None
    assert "hunter2" in settings.database_url.get_secret_value()  # available only on request


def test_database_url_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@127.0.0.1:54329/b17_dev")

    settings = load()

    assert settings.database_url is not None
    assert settings.database_url.get_secret_value().endswith("/b17_dev")


@pytest.mark.parametrize("seconds", [0, -1, 61])
def test_the_connect_timeout_is_bounded(seconds: int) -> None:
    with pytest.raises(ValidationError):
        load(db_connect_timeout_seconds=seconds)
    assert load().db_connect_timeout_seconds == 5
