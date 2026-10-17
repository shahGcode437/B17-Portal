"""Post-login destinations: the open-redirect guard (docs/backend/AUTH_RBAC.md §10.3).

A ``returnTo`` is supplied when an OAuth flow *starts*, validated here, stored server-side, and used
only at the end of the callback. The browser is always sent to the **configured** frontend origin
plus the validated path — an origin is never taken from a request, and the callback request never
supplies a destination at all.

The frozen rule: a relative path matching ``^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$`` (so no query string
or fragment), not starting with ``//`` or ``/\\``, at most 200 characters, and not under ``/api`` or
``/admin/login``. An **absent or blank** ``returnTo`` means ``/``; an **explicitly supplied
unsafe** one is *rejected* (``InvalidReturnTo`` -> ``422 validation_error``), never silently turned
into ``/``. We reject (rather than "clean up") anything suspicious, including percent-encoded
tricks, so a malicious value can never become a different, safe-looking one.
"""

import re
from urllib.parse import unquote

DEFAULT_RETURN_TO = "/"
MAX_RETURN_TO_LENGTH = 200
_ALLOWED = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$")
_FORBIDDEN_PREFIXES = ("/api", "/admin/login")


def _has_forbidden_prefix(path: str) -> bool:
    lowered = path.lower().rstrip("/")
    return any(lowered == p or lowered.startswith(p + "/") for p in _FORBIDDEN_PREFIXES)


def is_safe_return_to(value: str) -> bool:
    """True only for a path that is safe to append to the frontend origin."""
    if not value or len(value) > MAX_RETURN_TO_LENGTH or not _ALLOWED.fullmatch(value):
        return False
    if value.startswith("//"):
        return False
    # Decode (twice, to catch double-encoding) and re-check what a browser or proxy might see.
    decoded = unquote(unquote(value))
    if (
        not decoded.startswith("/")
        or decoded.startswith("//")
        or "\\" in decoded
        or any(ord(char) < 0x20 or ord(char) == 0x7F for char in decoded)
        or any(segment in {"..", "."} for segment in decoded.split("/"))
    ):
        return False
    return not (_has_forbidden_prefix(value) or _has_forbidden_prefix(decoded))


class InvalidReturnTo(ValueError):
    """An explicitly supplied ``returnTo`` that is not a safe relative path."""


def resolve_return_to(value: str | None) -> str:
    """``/`` when absent or blank; the value itself when safe; otherwise :class:`InvalidReturnTo`.

    The error never carries the offending value.
    """
    if value is None or not value.strip():
        return DEFAULT_RETURN_TO
    if is_safe_return_to(value):
        return value
    raise InvalidReturnTo("returnTo must be a relative path on this site.")
