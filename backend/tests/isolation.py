"""Makes the test process independent of the developer's machine (docs/development/TESTING.md).

The application reads ``backend/.env`` and the shell environment, which is right for the
application and wrong for its tests: a developer who has enabled real Google sign-in or e-mail
would be testing with real credentials, and a CLI run under test would fall back to the
*development* database. Three independent layers, installed by ``tests/conftest.py`` before any
test module is imported. **None of them changes how the application loads its settings** - they act
only on the running test process.

1. **No ``.env``.** No ``Settings()`` built in this process reads a file, however it is built
   (directly, through ``get_settings()``, by a CLI or by Alembic).
2. **No shell settings.** Every environment variable that maps to a setting - the list is derived
   from the model, so a new setting is covered automatically - is removed, in any letter case.
3. **No outside network.** Python sockets may only reach this machine (and the Compose database
   host). A test that tries anything else fails, even if the code under test swallowed the error.

The one deliberate exception is the database test harness, which reads exactly two keys,
``TEST_DATABASE_URL`` and ``DATABASE_URL``, and refuses any test database that is not a local
``*_test`` database distinct from every application database (``tests/db_safety.py``).
"""

import ipaddress
import os
import socket
from collections.abc import MutableMapping
from typing import Any

from app.core.config import Settings

#: Every environment variable the application's settings would read.
SETTINGS_ENV_VARS: tuple[str, ...] = tuple(sorted(name.upper() for name in Settings.model_fields))

#: Host names that are this machine, plus the Compose service name of the database.
LOCAL_HOST_NAMES = frozenset({"localhost", "db", "testserver"})

#: Destinations a test tried to reach and was refused. ``tests/conftest.py`` fails the test.
blocked_attempts: list[str] = []


class OutboundNetworkBlocked(RuntimeError):
    """A test tried to reach something outside this machine."""


def remove_settings_variables(
    environ: MutableMapping[str, str], *, keep: frozenset[str] = frozenset()
) -> None:
    """Delete every settings variable (pydantic-settings matches names case-insensitively)."""
    for key in [k for k in environ if k.upper() in SETTINGS_ENV_VARS and k.upper() not in keep]:
        del environ[key]


def is_local_host(host: object) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", "replace")
    if not isinstance(host, str):
        return False
    name = host.strip("[]").split("%", 1)[0].lower()
    if name == "" or name in LOCAL_HOST_NAMES:
        return True
    try:
        address = ipaddress.ip_address(name)
    except ValueError:
        return False
    return address.is_loopback or address.is_unspecified


def _refuse(host: object) -> None:
    blocked_attempts.append(str(host))
    raise OutboundNetworkBlocked(f"tests may not reach {host!r}: nothing outside this machine")


def _block_outside_network() -> None:
    real_getaddrinfo = socket.getaddrinfo
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def check_address(address: Any) -> None:
        # A (host, port, ...) tuple is a network address; a str / bytes one is a local socket path.
        if isinstance(address, tuple) and address and not is_local_host(address[0]):
            _refuse(address[0])

    def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if not is_local_host(host):  # refused before any DNS query leaves the machine
            _refuse(host)
        return real_getaddrinfo(host, *args, **kwargs)

    def connect(self: socket.socket, address: Any) -> None:
        check_address(address)
        return real_connect(self, address)

    def connect_ex(self: socket.socket, address: Any) -> int:
        check_address(address)
        return real_connect_ex(self, address)

    socket.getaddrinfo = getaddrinfo
    socket.socket.connect = connect  # type: ignore[method-assign]
    socket.socket.connect_ex = connect_ex  # type: ignore[method-assign]


_installed = False


def install() -> None:
    """Called once, when ``tests/conftest.py`` is imported."""
    global _installed
    if _installed:
        return
    _installed = True
    # Layer 1. This edits the class used by THIS process only.
    Settings.model_config["env_file"] = None
    # Layer 2. DATABASE_URL stays until the database harness has read it as the *protected* URL
    # (tests/db/conftest.py); the per-test fixture removes it before every test.
    remove_settings_variables(os.environ, keep=frozenset({"DATABASE_URL"}))
    os.environ["ENVIRONMENT"] = "test"
    _block_outside_network()
