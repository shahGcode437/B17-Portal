"""Issuing one-time email tokens (verification / password reset), shared by email and OAuth flows.

The raw token is returned to the caller **once** (to be handed to the EmailSender); only its SHA-256
is stored. Issuing a token retires the user's older unconsumed tokens of the same purpose.
"""

from datetime import datetime, timedelta

from app.core.security.tokens import hash_token, new_token
from app.models import AuthToken, User
from app.models.enums import AuthTokenPurpose
from app.repositories.auth import TokenRepository


def issue_token(
    tokens: TokenRepository,
    user: User,
    purpose: AuthTokenPurpose,
    ttl: timedelta,
    now: datetime,
) -> str:
    """Caller's transaction. Returns the raw token (never stored)."""
    tokens.invalidate_unconsumed(user.id, [purpose], now)
    raw = new_token()
    tokens.add(
        AuthToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=hash_token(raw),
            email=user.email,
            expires_at=now + ttl,
            created_at=now,
        )
    )
    return raw
