"""The test suite is independent of the developer's machine (tests/isolation.py).

Each test builds the worst local setup - real Google sign-in and a real e-mail provider enabled,
pointing at the development database - in a **temporary** directory or environment, and shows that
nothing of it reaches the tests. The developer's real ``backend/.env`` is never read or touched.
"""

import os
import socket
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from app.cli import auth_maintenance, staff
from app.core.config import Settings, get_settings
from app.factory import create_app
from app.models.enums import AuthProvider
from app.services.email import EmailMessage, MemoryEmailSender, deliver
from app.services.email_resend import ResendEmailSender
from app.services.oauth.google import GoogleOAuthProvider
from app.services.oauth.provider import OAuthProviderError
from tests import isolation
from tests.db_safety import UnsafeTestDatabaseError, assert_safe_test_database

HOSTILE = {
    "ENVIRONMENT": "development",
    "DATABASE_URL": "postgresql+psycopg://someone:not-a-real-password@127.0.0.1:1/b17_dev",
    "GOOGLE_OAUTH_PROVIDER": "google",
    "GOOGLE_OAUTH_CLIENT_ID": "developer-client-id.apps.example",
    "GOOGLE_OAUTH_CLIENT_SECRET": "developer-client-secret-not-real",
    "EMAIL_BACKEND": "resend",
    "RESEND_API_KEY": "re_developer_key_not_real",
    "EMAIL_FROM": "B-17 Portal <notifications@mail.b17portal.com>",
}


@pytest.fixture
def hostile_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A ``.env`` where the application looks for one: the working directory."""
    path = tmp_path / ".env"
    path.write_text("".join(f"{k}={v}\n" for k, v in HOSTILE.items()), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    return path


def test_the_hostile_file_really_would_be_read_without_the_isolation(hostile_dotenv: Path) -> None:
    """The control: if this stops holding, the tests below prove nothing."""
    leaked = Settings(_env_file=hostile_dotenv, environment="development")

    assert leaked.google_oauth_provider == "google" and leaked.email_backend == "resend"
    assert leaked.resend_api_key is not None and leaked.database_url is not None


@pytest.mark.parametrize("build", [Settings, get_settings], ids=["Settings()", "get_settings()"])
def test_no_way_of_building_settings_reads_a_dotenv_file(
    hostile_dotenv: Path, build: type[Settings]
) -> None:
    config = build()

    assert config.environment == "test"
    assert config.google_oauth_provider == "disabled"
    assert config.google_oauth_client_id is None and config.google_oauth_client_secret is None
    assert config.email_backend == "memory" and config.resend_api_key is None
    assert config.database_url is None


def test_an_app_built_the_default_way_has_no_real_provider(hostile_dotenv: Path) -> None:
    app = create_app()

    assert isinstance(app.state.email_sender, MemoryEmailSender)
    assert app.state.oauth_providers == {}
    assert app.state.db_engine is None


@pytest.mark.parametrize(
    ("command", "arguments"), [(auth_maintenance, ["purge"]), (staff, ["roster"])]
)
def test_a_command_line_tool_cannot_fall_back_to_the_development_database(
    hostile_dotenv: Path,
    command: object,
    arguments: list[str],
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Before this isolation, a CLI under test read ``DATABASE_URL`` from ``backend/.env``."""
    assert command.main(arguments) == 1  # type: ignore[attr-defined]

    assert "DATABASE_URL is not set" in capsys.readouterr().err


def test_shell_variables_are_removed_whatever_their_letter_case() -> None:
    environ = {
        **HOSTILE,
        "google_oauth_client_secret": "lower",
        "Resend_Api_Key": "mixed",
        "PATH": "/bin",
        "TEST_DATABASE_URL": "postgresql+psycopg://u:p@127.0.0.1:1/b17_test",
    }

    isolation.remove_settings_variables(environ)

    assert sorted(environ) == ["PATH", "TEST_DATABASE_URL"]


def test_every_setting_is_covered_including_ones_added_later() -> None:
    assert set(isolation.SETTINGS_ENV_VARS) == {n.upper() for n in Settings.model_fields}
    for name in ("RESEND_API_KEY", "EMAIL_BACKEND", "GOOGLE_OAUTH_CLIENT_SECRET", "DATABASE_URL"):
        assert name in isolation.SETTINGS_ENV_VARS and name not in os.environ


def test_every_application_database_is_protected_from_the_test_reset() -> None:
    first = "postgresql+psycopg://u:p@127.0.0.1:1/other_db"
    second = "postgresql+psycopg://u:p@127.0.0.1:1/app_test"

    with pytest.raises(UnsafeTestDatabaseError, match="same as the application"):
        assert_safe_test_database(second, protected_urls=[first, second])


# -- the network ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://api.resend.com/emails",
        "https://oauth2.googleapis.com/token",
        "https://www.googleapis.com/oauth2/v3/certs",
        "http://93.184.216.34/",  # a literal address needs no DNS and is refused too
    ],
)
def test_nothing_outside_this_machine_can_be_reached(url: str) -> None:
    with pytest.raises(isolation.OutboundNetworkBlocked):
        httpx.post(url, timeout=5)

    assert isolation.blocked_attempts
    isolation.blocked_attempts.clear()  # expected here; anywhere else it fails the test


def test_a_real_resend_client_cannot_send_from_a_test_even_with_a_key() -> None:
    sender = ResendEmailSender(
        api_key=SecretStr("re_developer_key_not_real"), sender=HOSTILE["EMAIL_FROM"]
    )
    message = EmailMessage(to="someone@example.org", subject="s", body="b", kind="login_notice")

    deliver(sender, message)  # swallows the refusal, exactly as the application would ...

    assert isolation.blocked_attempts == ["api.resend.com"]  # ... and the attempt is still seen
    isolation.blocked_attempts.clear()


def test_a_real_google_adapter_cannot_reach_google_from_a_test() -> None:
    provider = GoogleOAuthProvider(client_id="x", client_secret=SecretStr("y"))
    assert provider.name is AuthProvider.GOOGLE

    with pytest.raises((isolation.OutboundNetworkBlocked, OAuthProviderError)):
        provider._fetch_keys()

    assert isolation.blocked_attempts == ["www.googleapis.com"]
    isolation.blocked_attempts.clear()


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "127.0.0.2", "::1", "[::1]", "localhost", "LOCALHOST", "db", None, ""]
)
def test_this_machine_and_the_compose_database_stay_reachable(host: str | None) -> None:
    assert isolation.is_local_host(host)


@pytest.mark.parametrize(
    "host", ["api.resend.com", "10.0.0.5", "192.168.1.10", "localhost.example.org", "127.example"]
)
def test_other_machines_do_not_count_as_local(host: str) -> None:
    assert not isolation.is_local_host(host)


def test_a_real_loopback_connection_still_works() -> None:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        with socket.create_connection(("127.0.0.1", server.getsockname()[1]), timeout=5):
            pass
    assert isolation.blocked_attempts == []
