"""The test-database guard (no database needed): a typo must never be able to wipe real data."""

import pytest

from tests.db_safety import UnsafeTestDatabaseError, assert_safe_test_database

GOOD = "postgresql+psycopg://b17:pw@127.0.0.1:54329/b17_test"
DEV = "postgresql+psycopg://b17:pw@127.0.0.1:54329/b17_dev"


def test_a_local_database_named_for_tests_is_accepted() -> None:
    parsed = assert_safe_test_database(GOOD, protected_urls=[DEV])

    assert parsed.database == "b17_test"


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1", "db"])
def test_local_and_compose_hosts_are_accepted(host: str) -> None:
    bracketed = f"[{host}]" if ":" in host else host
    assert_safe_test_database(f"postgresql+psycopg://u:p@{bracketed}:5432/app_test")


@pytest.mark.parametrize(
    "name",
    [
        "b17_dev",  # the application database
        "b17",  # a bare name
        "b17_prod",
        "production",
        "b17_testing",  # contains "test" but does not END in _test
        "test_b17",  # starts with test
        "b17_test_old",
        "",  # no database at all
    ],
)
def test_a_database_whose_name_does_not_end_in_test_is_refused(name: str) -> None:
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database(f"postgresql+psycopg://u:p@127.0.0.1:5432/{name}")


@pytest.mark.parametrize(
    "host", ["db.internal.example.org", "10.0.0.5", "prod-db.example.org", "172.17.0.2"]
)
def test_a_remote_host_is_refused_even_if_the_name_ends_in_test(host: str) -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="host"):
        assert_safe_test_database(f"postgresql+psycopg://u:p@{host}:5432/b17_test")


def test_sqlite_and_other_engines_are_refused() -> None:
    for url in ("sqlite:///b17_test", "mysql+pymysql://u:p@127.0.0.1/b17_test"):
        with pytest.raises(UnsafeTestDatabaseError, match="PostgreSQL"):
            assert_safe_test_database(url)


def test_the_application_database_is_refused_even_under_a_test_looking_name() -> None:
    # A misconfiguration where DATABASE_URL itself points at a *_test database.
    same = "postgresql+psycopg://b17:pw@127.0.0.1:54329/b17_test"

    with pytest.raises(UnsafeTestDatabaseError, match="same as the application"):
        assert_safe_test_database(GOOD, protected_urls=[same])


def test_garbage_is_refused_rather_than_guessed_at() -> None:
    for url in ("", "not a url", "://"):
        with pytest.raises(UnsafeTestDatabaseError):
            assert_safe_test_database(url)
