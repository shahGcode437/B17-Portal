"""service requests and their status history

Phase 12F (docs/backend/DATA_MODEL.md §16, API_CONTRACT.md §10.8, §13) — **additive: two new
tables, nothing else.**

* ``service_requests``: an in-app request against a provider listing. ``requester_id`` RESTRICT
  (users are tombstoned), ``provider_listing_id`` SET NULL with a name snapshot (a request outlives
  its listing), vocabulary CHECKs for ``status`` and ``preferred_contact_channel`` (a *preference*
  only — DECISIONS.md, the O-3 contact model), minimum-length CHECKs mirroring the API.
* ``service_request_status_history``: append-only; creation has no previous status and is the only
  event that lands on ``submitted``.

What this migration deliberately does NOT do: no data statement of any kind (no backfill, no seed);
no change to ``users``, ``listings``, ``categories``, ``saved_items`` (it already has
``PRIMARY KEY (user_id, listing_id)``, which is the Saved uniqueness guarantee) or any auth table;
no payment, chat, notification or contact-number column. ``downgrade`` drops the two tables (and
therefore every request) — it exists for development and CI round-trips and must not be run
against data worth keeping.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Repeated here on purpose (a migration must not import application code that may change later).
STATUSES = "'submitted', 'accepted', 'in-progress', 'completed', 'cancelled'"


def upgrade() -> None:
    op.create_table(
        "service_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("requester_id", sa.Uuid(), nullable=False),
        sa.Column("provider_listing_id", sa.Uuid(), nullable=True),
        sa.Column("provider_name_snapshot", sa.String(length=100), nullable=False),
        sa.Column("service", sa.String(length=80), nullable=False),
        sa.Column("details", sa.String(length=500), nullable=False),
        sa.Column("area", sa.String(length=80), nullable=False),
        sa.Column("preferred_date", sa.Date(), nullable=False),
        sa.Column("preferred_time", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "preferred_contact_channel",
            sa.String(length=32),
            server_default="in_app",
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), server_default="submitted", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"status IN ({STATUSES})", name=op.f("ck_service_requests_status_valid")
        ),
        sa.CheckConstraint(
            "preferred_contact_channel IN ('in_app', 'whatsapp', 'phone')",
            name=op.f("ck_service_requests_contact_channel_valid"),
        ),
        sa.CheckConstraint(
            "char_length(btrim(details)) >= 10",
            name=op.f("ck_service_requests_details_min_length"),
        ),
        sa.CheckConstraint(
            "char_length(btrim(service)) >= 1", name=op.f("ck_service_requests_service_not_blank")
        ),
        sa.CheckConstraint(
            "char_length(btrim(area)) >= 2", name=op.f("ck_service_requests_area_min_length")
        ),
        sa.CheckConstraint(
            "char_length(btrim(provider_name_snapshot)) >= 1",
            name=op.f("ck_service_requests_provider_name_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["requester_id"],
            ["users.id"],
            name=op.f("fk_service_requests_requester_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["provider_listing_id"],
            ["listings.id"],
            name=op.f("fk_service_requests_provider_listing_id_listings"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_service_requests")),
    )
    op.create_index(
        "ix_service_requests_provider_listing_id_status",
        "service_requests",
        ["provider_listing_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_service_requests_requester_id_created_at",
        "service_requests",
        ["requester_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "service_request_status_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"from_status IS NULL OR from_status IN ({STATUSES})",
            name=op.f("ck_service_request_status_history_from_status_valid"),
        ),
        sa.CheckConstraint(
            f"to_status IN ({STATUSES})",
            name=op.f("ck_service_request_status_history_to_status_valid"),
        ),
        sa.CheckConstraint(
            "actor_role IN ('requester', 'provider')",
            name=op.f("ck_service_request_status_history_actor_role_valid"),
        ),
        sa.CheckConstraint(
            "(from_status IS NULL) = (to_status = 'submitted')",
            name=op.f("ck_service_request_status_history_from_status_iff_submitted"),
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["service_requests.id"],
            name=op.f("fk_service_request_status_history_request_id_service_requests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_service_request_status_history_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_service_request_status_history")),
    )
    op.create_index(
        "ix_service_request_status_history_request_id_created_at",
        "service_request_status_history",
        ["request_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_service_request_status_history_request_id_created_at",
        table_name="service_request_status_history",
    )
    op.drop_table("service_request_status_history")
    op.drop_index("ix_service_requests_requester_id_created_at", table_name="service_requests")
    op.drop_index("ix_service_requests_provider_listing_id_status", table_name="service_requests")
    op.drop_table("service_requests")
