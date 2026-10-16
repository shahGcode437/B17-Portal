"""Opaque secrets: session tokens, one-time email tokens, and the session-bound CSRF token.

* Every secret is 256 bits from :mod:`secrets` (``token_urlsafe(32)`` -> 43 URL-safe characters).
  A UUID is never a secret.
* Only the SHA-256 of a secret is ever stored. The secret itself is high-entropy random, so a plain
  SHA-256 is sufficient (no pepper, no password-style KDF) and lookups can use an indexed equality
  on the hash.
* The CSRF token is *derived* from the session secret (HMAC-SHA256 keyed with the session token),
  never stored: the backend recomputes it from the HttpOnly cookie on every authenticated unsafe
  request (AUTH_RBAC.md §6).
"""

import base64
import hashlib
import hmac
import re
import secrets

TOKEN_BYTES = 32
_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
_CSRF_CONTEXT = b"b17-csrf-v1"


def new_token() -> str:
    """A fresh 256-bit URL-safe random secret."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def is_well_formed_token(raw: str) -> bool:
    """Cheap shape check so junk cookies/links never reach the database."""
    return bool(_TOKEN_PATTERN.fullmatch(raw))


def hash_token(raw: str) -> bytes:
    """SHA-256 digest (32 bytes) of a secret — the only form that is stored."""
    return hashlib.sha256(raw.encode("utf-8")).digest()


def csrf_token_for(session_token: str) -> str:
    """The CSRF token bound to one session secret (base64url, no padding)."""
    digest = hmac.new(session_token.encode("utf-8"), _CSRF_CONTEXT, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def csrf_token_matches(session_token: str, supplied: str | None) -> bool:
    """Constant-time comparison of a supplied CSRF token with the one derived from the session."""
    if not supplied:
        return False
    expected = csrf_token_for(session_token)
    return hmac.compare_digest(expected.encode("ascii"), supplied.encode("utf-8", "ignore"))
