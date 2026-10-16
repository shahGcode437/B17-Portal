"""Pure decisions of the layered CSRF policy (docs/backend/AUTH_RBAC.md §6).

* ``Origin`` is mandatory on unsafe browser requests and must exactly match a configured frontend
  origin (no ``Referer`` fallback, ``null`` is rejected).
* ``Sec-Fetch-Site`` is defence in depth only: when present it must say ``same-origin`` or
  ``same-site``; when absent, nothing changes — correctness rests on ``Origin`` and the token.
"""

from collections.abc import Collection

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_HEADER = "x-csrf-token"
_ALLOWED_FETCH_SITES = frozenset({"same-origin", "same-site"})


def origin_allowed(origin: str | None, allowed_origins: Collection[str]) -> bool:
    """True only when ``origin`` is present and exactly one of the configured frontend origins."""
    if origin is None:
        return False
    return origin in allowed_origins


def fetch_site_allowed(value: str | None) -> bool:
    """``Sec-Fetch-Site``: absent is fine; present must be same-origin or same-site."""
    return value is None or value.lower() in _ALLOWED_FETCH_SITES
