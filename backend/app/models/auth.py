"""Authentication state (Phase 11B, migration 0003): sessions, one-time tokens, audit, rate limits.

Design: docs/backend/AUTH_RBAC.md §4, §8, §13, §16. Secrets are never stored — a session or token
is represented by the SHA-256 of a 256-bit random value, and the raw value exists only in the
auth cookie / the email link. Timestamps are written by the application's clock (so expiry logic is
testable and not tied to the transaction-start ``now()``); all are ``timestamptz``.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import AuthEventType, AuthTokenPurpose, SessionRevokeReason

#: SHA-256 digests are 32 bytes.
TOKEN_HASH_BYTES = 32


class AuthSession(UUIDPrimaryKeyMixin, Base):
    """One signed-in device. ``id`` is safe to log; the cookie secret is only its ``token_hash``."""

    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: Idle expiry: slid forward from ``last_seen_at``, never beyond ``absolute_expires_at``.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[SessionRevokeReason | None] = mapped_column(str_enum(SessionRevokeReason))
    #: Truncated, informational (recognising a device in a future session list). No IP address.
    user_agent: Mapped[str | None] = mapped_column(String(200))

    __table_args__ = (
        CheckConstraint(f"octet_length(token_hash) = {TOKEN_HASH_BYTES}", name="token_hash_length"),
        in_values("revoke_reason", SessionRevokeReason, name="revoke_reason_valid", nullable=True),
        CheckConstraint(
            "(revoked_at IS NULL) = (revoke_reason IS NULL)", name="revoked_consistent"
        ),
        CheckConstraint("expires_at <= absolute_expires_at", name="idle_within_absolute"),
        Index("uq_auth_sessions_token_hash", "token_hash", unique=True),
        Index(
            "ix_auth_sessions_user_id_active",
            "user_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index("ix_auth_sessions_expires_at", "expires_at"),
    )


class AuthToken(UUIDPrimaryKeyMixin, Base):
    """A one-time, purpose-tagged, expiring token (email verification / password reset)."""

    __tablename__ = "auth_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[AuthTokenPurpose] = mapped_column(str_enum(AuthTokenPurpose), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    #: The address this token is for: a token issued for an old address cannot verify a new one.
    email: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint(f"octet_length(token_hash) = {TOKEN_HASH_BYTES}", name="token_hash_length"),
        in_values("purpose", AuthTokenPurpose, name="purpose_valid"),
        Index("uq_auth_tokens_token_hash", "token_hash", unique=True),
        Index("ix_auth_tokens_user_id_purpose", "user_id", "purpose"),
    )


class AuthEvent(UUIDPrimaryKeyMixin, Base):
    """Security audit trail. Never holds secrets, IPs, user agents or unknown-account emails."""

    __tablename__ = "auth_events"

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    #: Who performed an administrative action (NULL for the operator CLI).
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    event_type: Mapped[AuthEventType] = mapped_column(str_enum(AuthEventType), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64))
    #: A tiny allow-listed object (``provider``, ``reason``, ``session_id``) — see AuthAuditService.
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))

    __table_args__ = (
        in_values("event_type", AuthEventType, name="event_type_valid"),
        CheckConstraint(
            "details IS NULL OR jsonb_typeof(details) = 'object'", name="details_object"
        ),
        Index("ix_auth_events_user_id_occurred_at", "user_id", "occurred_at"),
        Index("ix_auth_events_event_type_occurred_at", "event_type", "occurred_at"),
    )


class AuthRateLimit(Base):
    """A fixed-window counter keyed by a hash of the identity (never the identity itself)."""

    __tablename__ = "auth_rate_limits"

    key_hash: Mapped[bytes] = mapped_column(LargeBinary, primary_key=True)
    policy: Mapped[str] = mapped_column(String(40), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        CheckConstraint(f"octet_length(key_hash) = {TOKEN_HASH_BYTES}", name="key_hash_length"),
        CheckConstraint("count >= 0", name="count_non_negative"),
        Index("ix_auth_rate_limits_window_start", "window_start"),
    )
