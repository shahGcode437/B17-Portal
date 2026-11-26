"""grocery order intake: orders, items, history, daily capacity and operating settings

GROCERY-1b (docs/backend/DATA_MODEL.md §21, API_CONTRACT.md §18) — **additive**: five new tables
and nothing else. No existing table, constraint or row changes; no listing taxonomy changes; no
staff role or scope is granted.

**One data statement:** the first settings version. It is the safe default — ordering DISABLED and
**no serviceable block** (the official B-17 block list has not been supplied, so none is invented):
10:00 to 20:00 Asia/Karachi, all seven days, 10 orders a day, 2 active orders per customer,
50 lines per order.

**Append-only, enforced by the database** (accidental or buggy statements; not a defence against a
superuser):

* ``grocery_order_status_history`` refuses UPDATE and DELETE (row trigger). It has no TRUNCATE
  trigger: it references ``users``, and a test database's ``TRUNCATE users CASCADE`` must work.
* ``grocery_settings_revisions`` refuses UPDATE, DELETE and TRUNCATE. It references nothing.

``downgrade`` REFUSES (loudly, nothing is changed) while any Grocery order or capacity row exists,
or the settings were ever changed: dropping the tables would destroy customers' orders or the
record of who changed the operating rules. A database where Grocery was never used downgrades
cleanly.

**Rolling back the application alone is safe:** code before this revision does not read these
tables (docs/backend/DEPLOYMENT.md §15).

Revision ID: 0011
Revises: 0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Closed value sets, repeated on purpose (a migration must not import application code).
STATUSES = "'submitted', 'cancelled'"
UNITS = "'kg', 'gram', 'litre', 'ml', 'piece', 'pack', 'dozen'"
SUBSTITUTIONS = "'allow', 'ask', 'none'"
ACTOR_ROLES = "'customer'"

HISTORY = "grocery_order_status_history"
SETTINGS = "grocery_settings_revisions"
APPEND_ONLY_FUNCTION = """
CREATE FUNCTION grocery_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '23001', CONSTRAINT = TG_NAME;
END
$$
"""
TRIGGERS = (
    (HISTORY, "trg_grocery_order_status_history_append_only", "BEFORE UPDATE OR DELETE", "ROW"),
    (SETTINGS, "trg_grocery_settings_revisions_append_only", "BEFORE UPDATE OR DELETE", "ROW"),
    (SETTINGS, "trg_grocery_settings_revisions_no_truncate", "BEFORE TRUNCATE", "STATEMENT"),
)

#: What the downgrade refuses to destroy: (description, SQL returning a row count).
LIVE_DATA = (
    ("grocery orders", "SELECT count(*) FROM grocery_orders"),
    ("daily capacity records", "SELECT count(*) FROM grocery_daily_capacity"),
    (
        "settings changes",
        "SELECT count(*) FROM grocery_settings_revisions WHERE revision > 1",
    ),
)


def _timestamp(name: str, default: str | None = None, *, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.text(default) if default else None,
        nullable=nullable,
    )


def _check(table: str, name: str, condition: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(condition, name=op.f(f"ck_{table}_{name}"))


def upgrade() -> None:
    table = "grocery_orders"
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reference", sa.String(length=16), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="submitted", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("contact_name", sa.String(length=80), nullable=False),
        sa.Column("contact_phone", sa.String(length=20), nullable=False),
        sa.Column("block", sa.String(length=40), nullable=False),
        sa.Column("address_line", sa.String(length=200), nullable=False),
        sa.Column("landmark", sa.String(length=100), nullable=True),
        sa.Column("instructions", sa.String(length=500), nullable=True),
        sa.Column("service_date", sa.Date(), nullable=False),
        _timestamp("submitted_at"),
        _timestamp("cancelled_at", nullable=True),
        sa.Column("cancel_reason", sa.String(length=200), nullable=True),
        sa.Column("idempotency_key_hash", sa.LargeBinary(), nullable=False),
        sa.Column("request_hash", sa.LargeBinary(), nullable=False),
        _timestamp("created_at", "now()"),
        _timestamp("updated_at", "now()"),
        _check(table, "status_valid", f"status IN ({STATUSES})"),
        _check(table, "reference_format", r"reference ~ '^GRC-[2-9A-HJKMNP-Z]{8}$'"),
        _check(table, "revision_positive", "revision >= 1"),
        _check(table, "contact_name_min_length", "char_length(btrim(contact_name)) >= 2"),
        _check(table, "contact_phone_pk_e164", r"contact_phone ~ '^\+92[0-9]{9,10}$'"),
        _check(table, "block_not_blank", "char_length(btrim(block)) >= 1"),
        _check(table, "address_line_min_length", "char_length(btrim(address_line)) >= 5"),
        _check(
            table, "landmark_not_blank", "landmark IS NULL OR char_length(btrim(landmark)) >= 1"
        ),
        _check(
            table,
            "instructions_not_blank",
            "instructions IS NULL OR char_length(btrim(instructions)) >= 1",
        ),
        _check(
            table,
            "cancelled_at_iff_cancelled",
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
        ),
        _check(
            table,
            "cancel_reason_only_when_cancelled",
            "cancel_reason IS NULL OR "
            "(status = 'cancelled' AND char_length(btrim(cancel_reason)) >= 1)",
        ),
        _check(
            table,
            "hash_lengths",
            "octet_length(idempotency_key_hash) = 32 AND octet_length(request_hash) = 32",
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["users.id"],
            name=op.f("fk_grocery_orders_customer_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_grocery_orders")),
        sa.UniqueConstraint("reference", name="uq_grocery_orders_reference"),
        sa.UniqueConstraint(
            "customer_id",
            "idempotency_key_hash",
            name="uq_grocery_orders_customer_id_idempotency_key_hash",
        ),
    )
    op.create_index("ix_grocery_orders_customer_id_status", table, ["customer_id", "status"])
    op.create_index(
        "ix_grocery_orders_customer_id_submitted_at",
        table,
        ["customer_id", sa.text("submitted_at DESC")],
    )

    table = "grocery_order_items"
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=10, scale=3), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("preferred_brand", sa.String(length=60), nullable=True),
        sa.Column("substitution", sa.String(length=32), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        _check(table, "position_range", "position BETWEEN 1 AND 100"),
        _check(table, "name_not_blank", "char_length(btrim(name)) >= 1"),
        _check(table, "quantity_range", "quantity > 0 AND quantity <= 5000"),
        _check(
            table,
            "whole_units",
            "unit NOT IN ('gram', 'ml', 'piece', 'pack') OR quantity = trunc(quantity)",
        ),
        _check(table, "unit_valid", f"unit IN ({UNITS})"),
        _check(table, "substitution_valid", f"substitution IN ({SUBSTITUTIONS})"),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["grocery_orders.id"],
            name=op.f("fk_grocery_order_items_order_id_grocery_orders"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_grocery_order_items")),
        sa.UniqueConstraint(
            "order_id", "position", name="uq_grocery_order_items_order_id_position"
        ),
    )

    table = HISTORY
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        _timestamp("created_at", "clock_timestamp()"),
        _check(table, "from_status_valid", f"from_status IS NULL OR from_status IN ({STATUSES})"),
        _check(table, "to_status_valid", f"to_status IN ({STATUSES})"),
        _check(table, "actor_role_valid", f"actor_role IN ({ACTOR_ROLES})"),
        _check(
            table, "from_status_iff_submitted", "(from_status IS NULL) = (to_status = 'submitted')"
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["grocery_orders.id"],
            name=op.f("fk_grocery_order_status_history_order_id_grocery_orders"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_grocery_order_status_history_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_grocery_order_status_history")),
    )
    op.create_index(
        "ix_grocery_order_status_history_order_id_created_at", table, ["order_id", "created_at"]
    )

    table = "grocery_daily_capacity"
    op.create_table(
        table,
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("reserved", sa.Integer(), nullable=False),
        _check(table, "reserved_not_negative", "reserved >= 0"),
        sa.PrimaryKeyConstraint("service_date", name=op.f("pk_grocery_daily_capacity")),
    )

    table = SETTINGS
    op.create_table(
        table,
        sa.Column("revision", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("serviceable_blocks", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("operating_days", postgresql.ARRAY(sa.SmallInteger()), nullable=False),
        sa.Column("opens_at", sa.Time(), nullable=False),
        sa.Column("closes_at", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("daily_capacity", sa.SmallInteger(), nullable=False),
        sa.Column("max_active_orders_per_customer", sa.SmallInteger(), nullable=False),
        sa.Column("max_items_per_order", sa.SmallInteger(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        _timestamp("created_at", "clock_timestamp()"),
        _check(table, "revision_positive", "revision >= 1"),
        _check(table, "blocks_bounded", "cardinality(serviceable_blocks) <= 100"),
        _check(table, "blocks_no_nulls", "array_position(serviceable_blocks, NULL) IS NULL"),
        _check(
            table,
            "operating_days_valid",
            "cardinality(operating_days) BETWEEN 1 AND 7 "
            "AND operating_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] "
            "AND array_position(operating_days, NULL) IS NULL",
        ),
        _check(table, "opens_before_closes", "opens_at < closes_at"),
        _check(table, "timezone_valid", "timezone IN ('Asia/Karachi')"),
        _check(table, "daily_capacity_range", "daily_capacity BETWEEN 1 AND 200"),
        _check(table, "max_active_orders_range", "max_active_orders_per_customer BETWEEN 1 AND 10"),
        _check(table, "max_items_range", "max_items_per_order BETWEEN 1 AND 100"),
        _check(table, "change_has_actor", "revision = 1 OR actor_user_id IS NOT NULL"),
        sa.PrimaryKeyConstraint("revision", name=op.f("pk_grocery_settings_revisions")),
    )

    # The safe default: DISABLED, and no serviceable block.
    op.execute(
        "INSERT INTO grocery_settings_revisions "
        "(revision, enabled, serviceable_blocks, operating_days, opens_at, closes_at, timezone, "
        "daily_capacity, max_active_orders_per_customer, max_items_per_order) VALUES "
        "(1, false, '{}', '{1,2,3,4,5,6,7}', '10:00', '20:00', 'Asia/Karachi', 10, 2, 50)"
    )

    op.execute(APPEND_ONLY_FUNCTION)
    for name, trigger, event, level in TRIGGERS:
        op.execute(
            f"CREATE TRIGGER {trigger} {event} ON {name} "
            f"FOR EACH {level} EXECUTE FUNCTION grocery_append_only()"
        )


def downgrade() -> None:
    bind = op.get_bind()
    # Lock first, so nothing can be written between the check and the drop.
    bind.execute(
        sa.text(
            "LOCK TABLE grocery_orders, grocery_daily_capacity, grocery_settings_revisions "
            "IN ACCESS EXCLUSIVE MODE"
        )
    )
    found = {
        description: int(bind.execute(sa.text(query)).scalar_one())
        for description, query in LIVE_DATA
    }
    live = {description: count for description, count in found.items() if count}
    if live:
        listing = ", ".join(f"{count} {description}" for description, count in live.items())
        raise RuntimeError(
            f"Refusing to downgrade 0011: it would destroy Grocery data ({listing}). Nothing "
            "was changed. To run older application code you do not need to downgrade: it does "
            "not read these tables. A downgrade is only for a database where Grocery was never "
            "used; otherwise export and remove the data deliberately first."
        )

    for name, trigger, _, _ in TRIGGERS:
        # ``IF EXISTS``: a deliberate operator cleanup may already have dropped them.
        op.execute(f"DROP TRIGGER IF EXISTS {trigger} ON {name}")
    op.execute("DROP FUNCTION IF EXISTS grocery_append_only()")

    op.drop_table("grocery_settings_revisions")
    op.drop_table("grocery_daily_capacity")
    op.drop_index("ix_grocery_order_status_history_order_id_created_at", table_name=HISTORY)
    op.drop_table(HISTORY)
    op.drop_table("grocery_order_items")
    op.drop_index("ix_grocery_orders_customer_id_submitted_at", table_name="grocery_orders")
    op.drop_index("ix_grocery_orders_customer_id_status", table_name="grocery_orders")
    op.drop_table("grocery_orders")
