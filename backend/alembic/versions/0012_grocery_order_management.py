"""grocery order management: assignment, agreement, delivery states, cash collection

GROCERY-2 (docs/backend/DATA_MODEL.md §22, API_CONTRACT.md §19) — **additive**. No existing row
changes, no data statement, no staff role or scope is granted, ordering stays as it was set.

* ``grocery_orders``: who is handling the order, the CURRENT agreed total and amount due, the
  delivery time; four more statuses.
* ``grocery_order_status_history``: the new statuses and the ``staff`` actor role.
* ``grocery_settings_revisions``: the pilot's order-value cap (PKR 20,000, fees included; owner approved).
  Existing versions take the default; adding the column rewrites no history.
* ``grocery_order_confirmations``, ``grocery_payments``, ``grocery_order_events``: new and
  insert-only (the ``grocery_append_only()`` trigger function of ``0011`` refuses UPDATE and
  DELETE). Like the status history they reference ``users`` and so have no TRUNCATE trigger: a
  test database's ``TRUNCATE users CASCADE`` must work. That limitation is in the launch blocker
  register (docs/backend/DEPLOYMENT.md §15).

``downgrade`` REFUSES (loudly, nothing is changed) while anything this revision made possible
exists: an order past ``submitted`` / ``cancelled``, an assignment or agreed amount, an
agreement, a cash collection, a staff event or staff history row, or a changed value cap.

**Rolling back the application is NOT safe once staff have acted** (older code cannot read the new
statuses or the ``staff`` role): docs/backend/DEPLOYMENT.md §17.

Revision ID: 0012
Revises: 0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Closed value sets, repeated on purpose (a migration must not import application code).
OLD_STATUSES = "'submitted', 'cancelled'"
STATUSES = "'submitted', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'"
OLD_ACTOR_ROLES = "'customer'"
ACTOR_ROLES = "'customer', 'staff'"
METHODS = "'phone_call', 'in_person', 'written_message'"
ACTIONS = "'claimed', 'released', 'amount_reduced', 'issue_recorded'"
ISSUE_KINDS = (
    "'payment_discrepancy', 'item_shortage', 'delivery_problem', 'customer_unreachable', "
    "'other', 'cancelled_after_procurement'"
)
MAX_PAISA = 100_000_000
DEFAULT_CAP = 2_000_000

ORDERS = "grocery_orders"
HISTORY = "grocery_order_status_history"
SETTINGS = "grocery_settings_revisions"
CONFIRMATIONS = "grocery_order_confirmations"
PAYMENTS = "grocery_payments"
EVENTS = "grocery_order_events"
APPEND_ONLY_TABLES = (CONFIRMATIONS, PAYMENTS, EVENTS)

#: (name, condition) of the checks this revision adds to ``grocery_orders``.
ORDER_CHECKS = (
    ("assignment_complete", "(assigned_to IS NULL) = (assigned_at IS NULL)"),
    ("amounts_together", "(agreed_total_paisa IS NULL) = (final_due_paisa IS NULL)"),
    (
        "amounts_valid",
        "agreed_total_paisa IS NULL OR (final_due_paisa > 0 "
        f"AND final_due_paisa <= agreed_total_paisa AND agreed_total_paisa <= {MAX_PAISA})",
    ),
    (
        "agreement_required",
        "status NOT IN ('confirmed', 'preparing', 'out_for_delivery', 'delivered') "
        "OR agreed_total_paisa IS NOT NULL",
    ),
    ("no_amount_when_submitted", "status <> 'submitted' OR agreed_total_paisa IS NULL"),
    ("delivered_at_iff_delivered", "(status = 'delivered') = (delivered_at IS NOT NULL)"),
)

#: What the downgrade refuses to destroy: (description, SQL returning a row count).
LIVE_DATA = (
    (
        "orders in a staff-handled status",
        f"SELECT count(*) FROM {ORDERS} WHERE status NOT IN ({OLD_STATUSES})",
    ),
    (
        "assigned or priced orders",
        f"SELECT count(*) FROM {ORDERS} "
        "WHERE assigned_to IS NOT NULL OR agreed_total_paisa IS NOT NULL",
    ),
    ("recorded customer agreements", f"SELECT count(*) FROM {CONFIRMATIONS}"),
    ("cash collections", f"SELECT count(*) FROM {PAYMENTS}"),
    ("staff order events", f"SELECT count(*) FROM {EVENTS}"),
    ("staff history rows", f"SELECT count(*) FROM {HISTORY} WHERE actor_role = 'staff'"),
    (
        "settings versions with a changed value cap",
        f"SELECT count(*) FROM {SETTINGS} WHERE max_order_value_paisa <> {DEFAULT_CAP}",
    ),
)


def _check(table: str, name: str, condition: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(condition, name=op.f(f"ck_{table}_{name}"))


def _replace_check(table: str, name: str, condition: str) -> None:
    op.drop_constraint(op.f(f"ck_{table}_{name}"), table, type_="check")
    op.create_check_constraint(op.f(f"ck_{table}_{name}"), table, condition)


def _set_vocabularies(statuses: str, actor_roles: str) -> None:
    _replace_check(ORDERS, "status_valid", f"status IN ({statuses})")
    _replace_check(
        HISTORY, "from_status_valid", f"from_status IS NULL OR from_status IN ({statuses})"
    )
    _replace_check(HISTORY, "to_status_valid", f"to_status IN ({statuses})")
    _replace_check(HISTORY, "actor_role_valid", f"actor_role IN ({actor_roles})")


def _fk(table: str, column: str, target: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        [f"{target}.id"],
        name=op.f(f"fk_{table}_{column}_{target}"),
        ondelete="RESTRICT",
    )


def _timestamp(name: str, default: str | None = None, *, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.text(default) if default else None,
        nullable=nullable,
    )


def upgrade() -> None:
    # -- the order ---------------------------------------------------------------------------
    op.add_column(ORDERS, sa.Column("assigned_to", sa.Uuid(), nullable=True))
    op.add_column(ORDERS, _timestamp("assigned_at", nullable=True))
    op.add_column(ORDERS, sa.Column("agreed_total_paisa", sa.BigInteger(), nullable=True))
    op.add_column(ORDERS, sa.Column("final_due_paisa", sa.BigInteger(), nullable=True))
    op.add_column(ORDERS, _timestamp("delivered_at", nullable=True))
    op.create_foreign_key(
        op.f(f"fk_{ORDERS}_assigned_to_users"),
        ORDERS,
        "users",
        ["assigned_to"],
        ["id"],
        ondelete="RESTRICT",
    )
    _set_vocabularies(STATUSES, ACTOR_ROLES)
    for name, condition in ORDER_CHECKS:
        op.create_check_constraint(op.f(f"ck_{ORDERS}_{name}"), ORDERS, condition)
    op.create_index("ix_grocery_orders_status_submitted_at", ORDERS, ["status", "submitted_at"])
    op.create_index("ix_grocery_orders_service_date", ORDERS, ["service_date"])
    op.create_index("ix_grocery_orders_assigned_to", ORDERS, ["assigned_to"])

    # -- the order-value cap -----------------------------------------------------------------
    op.add_column(
        SETTINGS,
        sa.Column(
            "max_order_value_paisa",
            sa.BigInteger(),
            server_default=str(DEFAULT_CAP),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        op.f(f"ck_{SETTINGS}_max_order_value_range"),
        SETTINGS,
        f"max_order_value_paisa BETWEEN 100 AND {MAX_PAISA}",
    )

    # -- recorded customer agreements --------------------------------------------------------
    table = CONFIRMATIONS
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.SmallInteger(), nullable=False),
        sa.Column("items_subtotal_paisa", sa.BigInteger(), nullable=False),
        sa.Column("service_fee_paisa", sa.BigInteger(), nullable=False),
        sa.Column("delivery_fee_paisa", sa.BigInteger(), nullable=False),
        sa.Column("total_paisa", sa.BigInteger(), nullable=False),
        sa.Column("method", sa.String(length=32), nullable=False),
        sa.Column("pricing_note", sa.String(length=200), nullable=True),
        sa.Column("consent_note", sa.String(length=500), nullable=True),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        _timestamp("recorded_at"),
        _check(table, "sequence_positive", "sequence >= 1"),
        _check(
            table,
            "components_not_negative",
            "items_subtotal_paisa > 0 AND service_fee_paisa >= 0 AND delivery_fee_paisa >= 0",
        ),
        _check(
            table,
            "total_is_the_sum",
            "total_paisa = items_subtotal_paisa + service_fee_paisa + delivery_fee_paisa "
            f"AND total_paisa <= {MAX_PAISA}",
        ),
        _check(table, "method_valid", f"method IN ({METHODS})"),
        _fk(table, "order_id", ORDERS),
        _fk(table, "recorded_by", "users"),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}")),
        sa.UniqueConstraint(
            "order_id", "sequence", name="uq_grocery_order_confirmations_order_id_sequence"
        ),
    )

    # -- the cash collection -----------------------------------------------------------------
    table = PAYMENTS
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("method", sa.String(length=32), nullable=False),
        sa.Column("amount_due_paisa", sa.BigInteger(), nullable=False),
        sa.Column("amount_collected_paisa", sa.BigInteger(), nullable=False),
        sa.Column("collected_by", sa.Uuid(), nullable=False),
        _timestamp("collected_at"),
        _check(table, "method_valid", "method IN ('cash_on_delivery')"),
        _check(
            table,
            "amount_due_valid",
            f"amount_due_paisa > 0 AND amount_due_paisa <= {MAX_PAISA}",
        ),
        _check(table, "collected_is_the_amount_due", "amount_collected_paisa = amount_due_paisa"),
        _fk(table, "order_id", ORDERS),
        _fk(table, "collected_by", "users"),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}")),
        sa.UniqueConstraint("order_id", name="uq_grocery_payments_order_id"),
    )

    # -- other staff operations --------------------------------------------------------------
    table = EVENTS
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("subject_user_id", sa.Uuid(), nullable=True),
        sa.Column("amount_before_paisa", sa.BigInteger(), nullable=True),
        sa.Column("amount_after_paisa", sa.BigInteger(), nullable=True),
        sa.Column("issue_kind", sa.String(length=32), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        _timestamp("created_at", "clock_timestamp()"),
        _check(table, "action_valid", f"action IN ({ACTIONS})"),
        _check(table, "issue_kind_valid", f"issue_kind IS NULL OR issue_kind IN ({ISSUE_KINDS})"),
        _check(
            table,
            "subject_iff_assignment",
            "(subject_user_id IS NOT NULL) = (action IN ('claimed', 'released'))",
        ),
        _check(
            table,
            "amounts_iff_reduction",
            "(amount_before_paisa IS NOT NULL) = (action = 'amount_reduced') "
            "AND (amount_after_paisa IS NOT NULL) = (action = 'amount_reduced') "
            "AND (action <> 'amount_reduced' "
            "OR (amount_after_paisa > 0 AND amount_after_paisa < amount_before_paisa))",
        ),
        _check(table, "kind_iff_issue", "(issue_kind IS NOT NULL) = (action = 'issue_recorded')"),
        _check(
            table,
            "reason_required",
            "action NOT IN ('amount_reduced', 'issue_recorded') "
            "OR (note IS NOT NULL AND char_length(btrim(note)) >= 1)",
        ),
        _fk(table, "order_id", ORDERS),
        _fk(table, "actor_user_id", "users"),
        _fk(table, "subject_user_id", "users"),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}")),
    )
    op.create_index(
        "ix_grocery_order_events_order_id_created_at", table, ["order_id", "created_at"]
    )

    for name in APPEND_ONLY_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{name}_append_only BEFORE UPDATE OR DELETE ON {name} "
            "FOR EACH ROW EXECUTE FUNCTION grocery_append_only()"
        )


def downgrade() -> None:
    bind = op.get_bind()
    # Lock first, so nothing can be written between the check and the drop.
    bind.execute(
        sa.text(
            f"LOCK TABLE {ORDERS}, {HISTORY}, {SETTINGS}, {CONFIRMATIONS}, {PAYMENTS}, {EVENTS} "
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
            f"Refusing to downgrade 0012: it would destroy Grocery order handling ({listing}). "
            "Nothing was changed. Older application code cannot read these records either: roll "
            "forward, or export and remove the data deliberately first."
        )

    for name in APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{name}_append_only ON {name}")
    op.drop_index("ix_grocery_order_events_order_id_created_at", table_name=EVENTS)
    for name in (EVENTS, PAYMENTS, CONFIRMATIONS):
        op.drop_table(name)

    op.drop_constraint(op.f(f"ck_{SETTINGS}_max_order_value_range"), SETTINGS, type_="check")
    op.drop_column(SETTINGS, "max_order_value_paisa")

    op.drop_index("ix_grocery_orders_assigned_to", table_name=ORDERS)
    op.drop_index("ix_grocery_orders_service_date", table_name=ORDERS)
    op.drop_index("ix_grocery_orders_status_submitted_at", table_name=ORDERS)
    for name, _ in ORDER_CHECKS:
        op.drop_constraint(op.f(f"ck_{ORDERS}_{name}"), ORDERS, type_="check")
    _set_vocabularies(OLD_STATUSES, OLD_ACTOR_ROLES)
    op.drop_constraint(op.f(f"fk_{ORDERS}_assigned_to_users"), ORDERS, type_="foreignkey")
    for column in (
        "delivered_at",
        "final_due_paisa",
        "agreed_total_paisa",
        "assigned_at",
        "assigned_to",
    ):
        op.drop_column(ORDERS, column)
