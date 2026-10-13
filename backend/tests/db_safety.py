"""Safety rules for the test database. Tests reset their schema, so a wrong URL here must be
*impossible* to act on, not merely unlikely.

A database is accepted for destructive test work only if ALL of these hold:

1. it is addressed by an explicit ``TEST_DATABASE_URL`` — the harness never falls back to
   ``DATABASE_URL`` (the application/development database);
2. the database **name ends in ``_test``** (``b17_test``) — a typo such as ``b17_dev``, ``b17`` or
   ``b17_prod`` is refused;
3. the host is the local machine or the Compose service (``localhost``, ``127.0.0.1``, ``::1``,
   ``db``) — a remote database is refused even if it happens to be named ``*_test``;
4. its name differs from the protected application database named in ``DATABASE_URL``;
5. after connecting, ``SELECT current_database()`` returns the expected name (so a proxy or a
   redirect cannot silently land the reset somewhere else).

Violations raise :class:`UnsafeTestDatabaseError` before any reset/drop/truncate is attempted.
"""

import re
from collections.abc import Sequence

from sqlalchemy import Connection, text
from sqlalchemy.engine import URL, make_url

SAFE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "db"})
_TEST_DATABASE_NAME = re.compile(r"^[A-Za-z0-9_]*_test$")


class UnsafeTestDatabaseError(RuntimeError):
    """The configured test database is not safe to reset."""


def assert_safe_test_database(url: str, *, protected_urls: Sequence[str | None] = ()) -> URL:
    """Validate ``url`` for destructive test use; return the parsed URL or raise."""
    try:
        parsed = make_url(url)
    except Exception as error:  # a malformed URL is itself unsafe to act on
        raise UnsafeTestDatabaseError("TEST_DATABASE_URL is not a valid database URL") from error

    if not parsed.drivername.startswith("postgresql"):
        raise UnsafeTestDatabaseError("the test database must be PostgreSQL (never SQLite)")

    database = parsed.database or ""
    if not _TEST_DATABASE_NAME.fullmatch(database):
        raise UnsafeTestDatabaseError(
            f"refusing database {database!r}: a test database's name must end in '_test'"
        )

    host = parsed.host or ""
    if host not in SAFE_HOSTS:
        raise UnsafeTestDatabaseError(
            f"refusing host {host!r}: tests only run against {sorted(SAFE_HOSTS)}"
        )

    for protected in protected_urls:
        if not protected:
            continue
        try:
            other = make_url(protected)
        except Exception:
            continue
        if other.database == database:
            raise UnsafeTestDatabaseError(
                f"refusing database {database!r}: it is the same as the application DATABASE_URL"
            )
    return parsed


def assert_connected_to(connection: Connection, expected_database: str) -> None:
    """Check the live connection really is the validated database (rule 5)."""
    actual = connection.execute(text("SELECT current_database()")).scalar_one()
    if actual != expected_database:
        raise UnsafeTestDatabaseError(
            f"connected to {actual!r} but expected {expected_database!r}; refusing to continue"
        )
