"""oauth flows and one identity per provider per user

Phase 11C (docs/backend/AUTH_RBAC.md §10, §16):

* ``oauth_flows`` — one temporary, single-use OAuth round trip. ``state`` and the browser-binding
  cookie secret are stored only as SHA-256; provider tokens and authorization codes are never
  stored. No audit-event change is needed (the vocabulary already contains the identity events).
* ``auth_identities``: ``UNIQUE(user_id, provider)`` — one identity per provider per user. The
  existing ``UNIQUE(provider, provider_subject)`` keeps one owner per provider identity. The new
  constraint is applied to existing rows too: it fails (loudly, by design) if a user somehow holds
  two identities of one provider; no code path could create that before 11C and there is no data.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oauth_flows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "provider",
            sa.Enum(
                "google", "facebook", "apple", name="authprovider", native_enum=False, length=32
            ),
            nullable=False,
        ),
        sa.Column(
            "purpose",
            sa.Enum("login", "link", name="oauthpurpose", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("state_hash", sa.LargeBinary(), nullable=False),
        sa.Column("flow_cookie_hash", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.Text(), nullable=False),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("return_to", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(purpose = 'link') = (user_id IS NOT NULL)", name=op.f("ck_oauth_flows_link_has_user")
        ),
        sa.CheckConstraint(
            "left(return_to, 1) = '/'", name=op.f("ck_oauth_flows_return_to_relative")
        ),
        sa.CheckConstraint(
            "provider IN ('google', 'facebook', 'apple')",
            name=op.f("ck_oauth_flows_provider_valid"),
        ),
        sa.CheckConstraint(
            "purpose IN ('login', 'link')", name=op.f("ck_oauth_flows_purpose_valid")
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_oauth_flows_expires_after_created")
        ),
        sa.CheckConstraint(
            "octet_length(flow_cookie_hash) = 32",
            name=op.f("ck_oauth_flows_flow_cookie_hash_length"),
        ),
        sa.CheckConstraint(
            "octet_length(state_hash) = 32", name=op.f("ck_oauth_flows_state_hash_length")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_oauth_flows_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_oauth_flows")),
    )
    op.create_index("ix_oauth_flows_expires_at", "oauth_flows", ["expires_at"], unique=False)
    op.create_index("uq_oauth_flows_state_hash", "oauth_flows", ["state_hash"], unique=True)
    op.create_unique_constraint(
        "uq_auth_identities_user_id_provider", "auth_identities", ["user_id", "provider"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_auth_identities_user_id_provider", "auth_identities", type_="unique")
    op.drop_index("uq_oauth_flows_state_hash", table_name="oauth_flows")
    op.drop_index("ix_oauth_flows_expires_at", table_name="oauth_flows")
    op.drop_table("oauth_flows")
