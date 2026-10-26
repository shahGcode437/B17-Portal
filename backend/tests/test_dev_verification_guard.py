"""The development verification helper can never run outside a local development setup.

Database-free: the guard decides before any connection is opened (the CLI test proves it by making
engine creation fail loudly).
"""

from collections.abc import Callable

import pytest

from app.cli import dev_verify
from app.core.config import Settings
from app.factory import create_app
from app.services.dev_verification import (
    DevVerificationRefused,
    ensure_development_only,
    issue_dev_verification_link,
)

LOCAL_URL = "postgresql+psycopg://b17:secret@127.0.0.1:54329/b17_dev"


def settings_for(
    make_settings: Callable[..., Settings], environment: str, url: str | None = LOCAL_URL
) -> Settings:
    """``model_copy`` skips validators, so a hosted environment needs none of its HTTPS settings."""
    base = make_settings(database_url=url) if url else make_settings()
    return base.model_copy(update={"environment": environment})


@pytest.mark.parametrize("environment", ["development", "test"])
def test_a_development_or_test_setup_on_a_local_database_is_allowed(
    make_settings: Callable[..., Settings], environment: str
) -> None:
    ensure_development_only(settings_for(make_settings, environment))


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_hosted_environments_are_refused(
    make_settings: Callable[..., Settings], environment: str
) -> None:
    with pytest.raises(DevVerificationRefused, match="only works in development"):
        ensure_development_only(settings_for(make_settings, environment))


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://u:p@db.internal.example.com:5432/b17",
        "postgresql+psycopg://u:p@10.0.0.5:5432/b17",
        "postgresql+psycopg://u:p@b17-prod.abc.eu-west-1.rds.amazonaws.com:5432/b17",
    ],
)
def test_a_non_local_database_host_is_refused_even_in_development(
    make_settings: Callable[..., Settings], url: str
) -> None:
    with pytest.raises(DevVerificationRefused, match="non-local database"):
        ensure_development_only(settings_for(make_settings, "development", url))


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "db"])
def test_the_local_hosts_are_accepted(make_settings: Callable[..., Settings], host: str) -> None:
    ensure_development_only(
        settings_for(make_settings, "development", f"postgresql+psycopg://u:p@{host}:5432/b17")
    )


def test_a_missing_database_url_is_refused(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(DevVerificationRefused, match="DATABASE_URL"):
        ensure_development_only(settings_for(make_settings, "development", None))


def test_the_service_checks_the_guard_before_touching_the_database(
    make_settings: Callable[..., Settings],
) -> None:
    class ExplodingSession:
        def __getattr__(self, name: str) -> object:
            raise AssertionError(f"the database was touched ({name})")

    with pytest.raises(DevVerificationRefused):
        issue_dev_verification_link(
            ExplodingSession(),  # type: ignore[arg-type]
            settings_for(make_settings, "production"),
            lambda: None,  # type: ignore[arg-type, return-value]
            "someone@example.org",
        )


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_the_cli_exits_2_in_a_hosted_environment_without_opening_a_connection(
    make_settings: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    environment: str,
) -> None:
    hosted = settings_for(make_settings, environment)
    monkeypatch.setattr(dev_verify, "get_settings", lambda: hosted)

    def no_engine(_: Settings) -> None:
        raise AssertionError("the CLI opened a database connection although it must refuse")

    monkeypatch.setattr(dev_verify, "create_db_engine", no_engine)

    assert dev_verify.main(["someone@example.org"]) == 2
    captured = capsys.readouterr()
    assert "Refused" in captured.err and "development" in captured.err
    assert captured.out == ""  # no link, no token, nothing on stdout


def test_the_cli_exits_2_when_the_settings_cannot_even_load_as_in_an_unconfigured_production(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # `ENVIRONMENT=production` without its HTTPS / origin settings fails validation at load time.
    monkeypatch.setattr(
        dev_verify, "get_settings", lambda: Settings(_env_file=None, environment="production")
    )
    monkeypatch.setattr(
        dev_verify, "create_db_engine", lambda _: pytest.fail("opened a connection")
    )

    assert dev_verify.main(["someone@example.org"]) == 2
    captured = capsys.readouterr()
    assert "Refused" in captured.err and "Traceback" not in captured.err
    assert captured.out == ""


def test_the_cli_refuses_a_remote_database_even_when_the_environment_says_development(
    make_settings: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    remote = settings_for(
        make_settings, "development", "postgresql+psycopg://u:p@db.prod.example.com:5432/b17"
    )
    monkeypatch.setattr(dev_verify, "get_settings", lambda: remote)
    monkeypatch.setattr(
        dev_verify, "create_db_engine", lambda _: pytest.fail("opened a connection")
    )

    assert dev_verify.main(["someone@example.org"]) == 2
    assert capsys.readouterr().out == ""


def test_there_is_no_http_endpoint_and_no_auto_verify_setting(
    make_settings: Callable[..., Settings],
) -> None:
    # A configured database mounts the full API; the connection itself is only opened lazily.
    app = create_app(make_settings(database_url=LOCAL_URL))
    prefix = app.state.settings.api_v1_prefix
    paths = set(app.openapi()["paths"])
    assert f"{prefix}/auth/login" in paths  # the auth API really is mounted in this app
    assert not any("dev" in path.lower() for path in paths), paths
    assert sorted(p for p in paths if "verif" in p.lower()) == [
        f"{prefix}/auth/resend-verification",
        f"{prefix}/auth/verify-email",
    ]
    assert not [name for name in Settings.model_fields if "auto" in name and "verif" in name]
