"""auth sessions, tokens, events and rate limits

Phase 11B (docs/backend/AUTH_RBAC.md §16):

* ``users``: the stored email must be trimmed and lower-cased, and at most 254 characters. The
  constraints are added to existing rows too, so this fails (loudly, by design) if a database
  holds a non-normalized address — normalize it first; there are no such rows in any fixture.
* ``auth_sessions`` — opaque server-side sessions (only the SHA-256 of the cookie token is kept).
* ``auth_tokens`` — one-time email-verification / password-reset tokens (hashed, single-use).
* ``auth_events`` — the security audit trail (allow-listed details, no secrets).
* ``auth_rate_limits`` — PostgreSQL fixed-window counters for identity-keyed limits.

The OAuth tables belong to migration 0004 (Phase 11C).

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        op.f("ck_users_email_normalized"), "users", "email = lower(btrim(email))"
    )
    op.create_check_constraint(op.f("ck_users_email_length"), "users", "char_length(email) <= 254")
    op.create_table(
        "auth_rate_limits",
        sa.Column("key_hash", sa.LargeBinary(), nullable=False),
        sa.Column("policy", sa.String(length=40), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.CheckConstraint("count >= 0", name=op.f("ck_auth_rate_limits_count_non_negative")),
        sa.CheckConstraint(
            "octet_length(key_hash) = 32", name=op.f("ck_auth_rate_limits_key_hash_length")
        ),
        sa.PrimaryKeyConstraint(
            "key_hash", "policy", "window_start", name=op.f("pk_auth_rate_limits")
        ),
    )
    op.create_index(
        "ix_auth_rate_limits_window_start", "auth_rate_limits", ["window_start"], unique=False
    )
    op.create_table(
        "auth_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "event_type",
            sa.Enum(
                "register",
                "login_success",
                "login_failure",
                "logout",
                "logout_all",
                "session_revoked",
                "password_changed",
                "password_reset_requested",
                "password_reset_completed",
                "email_verification_sent",
                "email_verified",
                "identity_linked",
                "identity_unlinked",
                "account_claimed",
                "role_granted",
                "role_revoked",
                "account_suspended",
                "account_reactivated",
                name="autheventtype",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.CheckConstraint(
            "details IS NULL OR jsonb_typeof(details) = 'object'",
            name=op.f("ck_auth_events_details_object"),
        ),
        sa.CheckConstraint(
            "event_type IN ('register', 'login_success', 'login_failure', 'logout', 'logout_all', 'session_revoked', 'password_changed', 'password_reset_requested', 'password_reset_completed', 'email_verification_sent', 'email_verified', 'identity_linked', 'identity_unlinked', 'account_claimed', 'role_granted', 'role_revoked', 'account_suspended', 'account_reactivated')",
            name=op.f("ck_auth_events_event_type_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_auth_events_actor_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_events_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_events")),
    )
    op.create_index(
        "ix_auth_events_event_type_occurred_at",
        "auth_events",
        ["event_type", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_auth_events_user_id_occurred_at",
        "auth_events",
        ["user_id", "occurred_at"],
        unique=False,
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "revoke_reason",
            sa.Enum(
                "logout",
                "logout_all",
                "password_reset",
                "password_change",
                "admin_action",
                "suspended",
                "role_change",
                "session_cap",
                "account_claimed",
                name="sessionrevokereason",
                native_enum=False,
                length=32,
            ),
            nullable=True,
        ),
        sa.Column("user_agent", sa.String(length=200), nullable=True),
        sa.CheckConstraint(
            "revoke_reason IS NULL OR revoke_reason IN ('logout', 'logout_all', 'password_reset', 'password_change', 'admin_action', 'suspended', 'role_change', 'session_cap', 'account_claimed')",
            name=op.f("ck_auth_sessions_revoke_reason_valid"),
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoke_reason IS NULL)",
            name=op.f("ck_auth_sessions_revoked_consistent"),
        ),
        sa.CheckConstraint(
            "expires_at <= absolute_expires_at", name=op.f("ck_auth_sessions_idle_within_absolute")
        ),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32", name=op.f("ck_auth_sessions_token_hash_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
    )
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"], unique=False)
    op.create_index(
        "ix_auth_sessions_user_id_active",
        "auth_sessions",
        ["user_id"],
        unique=False,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index("uq_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum(
                "email_verification",
                "password_reset",
                name="authtokenpurpose",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "purpose IN ('email_verification', 'password_reset')",
            name=op.f("ck_auth_tokens_purpose_valid"),
        ),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32", name=op.f("ck_auth_tokens_token_hash_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_auth_tokens_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_tokens")),
    )
    op.create_index(
        "ix_auth_tokens_user_id_purpose", "auth_tokens", ["user_id", "purpose"], unique=False
    )
    op.create_index("uq_auth_tokens_token_hash", "auth_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_auth_tokens_token_hash", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_user_id_purpose", table_name="auth_tokens")
    op.drop_table("auth_tokens")
    op.drop_index("uq_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index(
        "ix_auth_sessions_user_id_active",
        table_name="auth_sessions",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_auth_events_user_id_occurred_at", table_name="auth_events")
    op.drop_index("ix_auth_events_event_type_occurred_at", table_name="auth_events")
    op.drop_table("auth_events")
    op.drop_index("ix_auth_rate_limits_window_start", table_name="auth_rate_limits")
    op.drop_table("auth_rate_limits")
    op.drop_constraint(op.f("ck_users_email_length"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_email_normalized"), "users", type_="check")
