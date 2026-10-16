"""Email normalization (docs/backend/AUTH_RBAC.md §7.2).

The stored address is NFKC-normalized, trimmed and **lower-cased** — nothing more. Gmail-style dot
removal and ``+tag`` folding are deliberately not applied (they would merge distinct mailboxes at
other providers). Format validation uses ``email-validator`` without any DNS lookup.
"""

import unicodedata

from email_validator import EmailNotValidError, validate_email

MAX_EMAIL_LENGTH = 254


def canonical_email(raw: str) -> str:
    """Trim + NFKC + lower-case. Used for *lookups* (login) where format errors must not be
    distinguishable from an unknown account."""
    return unicodedata.normalize("NFKC", raw).strip().lower()


def normalize_email(raw: str) -> str:
    """The canonical stored form of a *valid* address; raises ``ValueError`` otherwise."""
    candidate = canonical_email(raw)
    if not candidate or len(candidate) > MAX_EMAIL_LENGTH:
        raise ValueError("invalid email")
    try:
        result = validate_email(candidate, check_deliverability=False)
    except EmailNotValidError as error:
        raise ValueError("invalid email") from error
    normalized = result.normalized.lower()
    if len(normalized) > MAX_EMAIL_LENGTH:
        raise ValueError("invalid email")
    return normalized
