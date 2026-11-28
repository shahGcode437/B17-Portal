"""grocery payment methods, manual refunds and the all-of-B-17 confirmation

GROCERY-4C (docs/backend/DATA_MODEL.md §24, API_CONTRACT.md §21) — **additive**. No existing row
is rewritten and no data statement runs: every settings version takes the safe defaults (cash on
delivery only; all of B-17 NOT confirmed) and every existing cash collection stays as it is.

* ``grocery_settings_revisions``: ``payment_methods`` (always contains cash) and
  ``covers_all_b17`` (false; only possible with at least one block).
* ``grocery_payments``: card and verified external payments, each with a transaction reference
  (cash has none). Still one row per order, for exactly the amount due, insert-only. One online
  transaction reference can't pay two orders.
* ``grocery_refunds`` (new, insert-only): the one FULL refund of a payment, recorded after the
  money was returned outside the application.
* Three triggers keep the money consistent whatever code writes it: a payment must match its
  order; a paid order's amounts can't change and it can't be cancelled without a refund; a
  delivered order has a payment; a refund fits its order's status.

``downgrade`` REFUSES (nothing is changed) while a payment other than cash, any refund, or a
settings version with other than the defaults exists. Rolling the APPLICATION back is only safe
under the same condition: docs/backend/DEPLOYMENT.md §22.

Revision ID: 0014
Revises: 0013
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Closed value sets, repeated on purpose (a migration must not import application code).
CASH = "'cash_on_delivery'"
METHODS = "'cash_on_delivery', 'card', 'bank_transfer', 'easypaisa', 'jazzcash'"
#: The methods whose transaction reference identifies one movement of money.
ONLINE = "'bank_transfer', 'easypaisa', 'jazzcash'"
REFUND_METHODS = "'cash', 'card', 'bank_transfer', 'easypaisa', 'jazzcash'"
#: A reference is stored upper-cased without spaces or hyphens.
REFERENCE = "'^[A-Z0-9/._#]{4,64}$'"

ORDERS = "grocery_orders"
SETTINGS = "grocery_settings_revisions"
PAYMENTS = "grocery_payments"
REFUNDS = "grocery_refunds"

DEFAULT_METHODS = f"ARRAY[{CASH}]::varchar[]"

#: What the downgrade refuses to destroy: (description, SQL returning a row count).
LIVE_DATA = (
    ("payments other than cash", f"SELECT count(*) FROM {PAYMENTS} WHERE method <> {CASH}"),
    ("refunds", f"SELECT count(*) FROM {REFUNDS}"),
    (
        "settings versions with payment methods or an all-of-B-17 confirmation",
        f"SELECT count(*) FROM {SETTINGS} "
        f"WHERE covers_all_b17 OR payment_methods <> {DEFAULT_METHODS}",
    ),
)

#: A payment is written only for an order that is being handled, for exactly what is due.
PAYMENT_GUARD = """
CREATE FUNCTION grocery_payment_matches_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    found record;
BEGIN
    SELECT status, final_due_paisa INTO found FROM grocery_orders WHERE id = NEW.order_id;
    IF found.status NOT IN ('confirmed', 'preparing', 'out_for_delivery')
       OR found.final_due_paisa IS DISTINCT FROM NEW.amount_due_paisa THEN
        RAISE EXCEPTION 'grocery_payment_matches_order: not the amount due on an open order'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'grocery_payment_matches_order';
    END IF;
    RETURN NEW;
END
$$
"""

#: Whatever updates an order: a recorded payment can't be undone by changing the order.
ORDER_GUARD = """
CREATE FUNCTION grocery_order_keeps_its_money() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM grocery_payments WHERE order_id = OLD.id) THEN
        IF NEW.final_due_paisa IS DISTINCT FROM OLD.final_due_paisa
           OR NEW.agreed_total_paisa IS DISTINCT FROM OLD.agreed_total_paisa THEN
            RAISE EXCEPTION 'grocery_paid_amount_fixed: a paid order keeps its amount'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'grocery_paid_amount_fixed';
        END IF;
        IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
           AND NOT EXISTS (SELECT 1 FROM grocery_refunds WHERE order_id = OLD.id) THEN
            RAISE EXCEPTION 'grocery_paid_cancel_needs_refund: refund before cancelling'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'grocery_paid_cancel_needs_refund';
        END IF;
    ELSIF NEW.status = 'delivered' AND OLD.status <> 'delivered'
          AND NEW.delivered_at IS NOT NULL THEN
        RAISE EXCEPTION 'grocery_delivery_needs_payment: delivered orders are paid orders'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'grocery_delivery_needs_payment';
    END IF;
    RETURN NEW;
END
$$
"""

#: A refund belongs to an order that is not on its way and not already cancelled. (That it is the
#: whole payment of that order is a foreign key.)
REFUND_GUARD = """
CREATE FUNCTION grocery_refund_fits_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM grocery_orders
        WHERE id = NEW.order_id AND status IN ('confirmed', 'preparing', 'delivered')
    ) THEN
        RAISE EXCEPTION 'grocery_refund_fits_order: this order cannot be refunded now'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'grocery_refund_fits_order';
    END IF;
    RETURN NEW;
END
$$
"""

TRIGGERS = (
    (
        "trg_grocery_payments_match_order",
        f"BEFORE INSERT ON {PAYMENTS}",
        "grocery_payment_matches_order",
    ),
    (
        "trg_grocery_orders_keep_money",
        f"BEFORE UPDATE ON {ORDERS}",
        "grocery_order_keeps_its_money",
    ),
    ("trg_grocery_refunds_fit_order", f"BEFORE INSERT ON {REFUNDS}", "grocery_refund_fits_order"),
    # the shared function of 0011: UPDATE and DELETE are refused
    (f"trg_{REFUNDS}_append_only", f"BEFORE UPDATE OR DELETE ON {REFUNDS}", "grocery_append_only"),
)
TRIGGER_TABLES = {
    "trg_grocery_payments_match_order": PAYMENTS,
    "trg_grocery_orders_keep_money": ORDERS,
    "trg_grocery_refunds_fit_order": REFUNDS,
    f"trg_{REFUNDS}_append_only": REFUNDS,
}


def _check(table: str, name: str, condition: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(condition, name=op.f(f"ck_{table}_{name}"))


def _add_check(table: str, name: str, condition: str) -> None:
    op.create_check_constraint(op.f(f"ck_{table}_{name}"), table, condition)


def _replace_check(table: str, name: str, condition: str) -> None:
    op.drop_constraint(op.f(f"ck_{table}_{name}"), table, type_="check")
    _add_check(table, name, condition)


def upgrade() -> None:
    # -- settings: which methods, and the coverage confirmation -----------------------------
    op.add_column(
        SETTINGS,
        sa.Column(
            "payment_methods",
            postgresql.ARRAY(sa.String(length=32)),
            server_default=sa.text(DEFAULT_METHODS),
            nullable=False,
        ),
    )
    op.add_column(
        SETTINGS,
        sa.Column("covers_all_b17", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    _add_check(
        SETTINGS,
        "payment_methods_valid",
        f"{CASH} = ANY (payment_methods) "
        f"AND payment_methods <@ ARRAY[{METHODS}]::varchar[] "
        "AND array_position(payment_methods, NULL) IS NULL AND cardinality(payment_methods) <= 5",
    )
    _add_check(
        SETTINGS,
        "full_coverage_needs_blocks",
        "NOT covers_all_b17 OR cardinality(serviceable_blocks) >= 1",
    )

    # -- payments ----------------------------------------------------------------------------
    op.add_column(PAYMENTS, sa.Column("reference", sa.String(length=64), nullable=True))
    _replace_check(PAYMENTS, "method_valid", f"method IN ({METHODS})")
    _add_check(PAYMENTS, "reference_iff_not_cash", f"(method = {CASH}) = (reference IS NULL)")
    _add_check(PAYMENTS, "reference_format", f"reference IS NULL OR reference ~ {REFERENCE}")
    # What a refund points at: this payment, of this order, of this amount.
    op.create_unique_constraint(
        "uq_grocery_payments_id_order_id_amount",
        PAYMENTS,
        ["id", "order_id", "amount_collected_paisa"],
    )
    op.create_index(
        "uq_grocery_payments_online_reference",
        PAYMENTS,
        ["method", "reference"],
        unique=True,
        postgresql_where=sa.text(f"method IN ({ONLINE})"),
    )

    # -- refunds ------------------------------------------------------------------------------
    table = REFUNDS
    op.create_table(
        table,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("amount_paisa", sa.BigInteger(), nullable=False),
        sa.Column("method", sa.String(length=32), nullable=False),
        sa.Column("reference", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.String(length=200), nullable=False),
        sa.Column("refunded_by", sa.Uuid(), nullable=False),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=False),
        _check(table, "method_valid", f"method IN ({REFUND_METHODS})"),
        _check(table, "reference_required", "method = 'cash' OR reference IS NOT NULL"),
        _check(table, "reference_format", f"reference IS NULL OR reference ~ {REFERENCE}"),
        _check(table, "reason_not_blank", "char_length(btrim(reason)) >= 1"),
        sa.ForeignKeyConstraint(
            ["payment_id", "order_id", "amount_paisa"],
            [f"{PAYMENTS}.id", f"{PAYMENTS}.order_id", f"{PAYMENTS}.amount_collected_paisa"],
            name="fk_grocery_refunds_whole_payment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            [f"{ORDERS}.id"],
            name=op.f(f"fk_{table}_order_id_{ORDERS}"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["refunded_by"],
            ["users.id"],
            name=op.f(f"fk_{table}_refunded_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}")),
        sa.UniqueConstraint("order_id", name="uq_grocery_refunds_order_id"),
        sa.UniqueConstraint("payment_id", name="uq_grocery_refunds_payment_id"),
    )

    for function in (PAYMENT_GUARD, ORDER_GUARD, REFUND_GUARD):
        op.execute(function)
    for name, when, function_name in TRIGGERS:
        op.execute(f"CREATE TRIGGER {name} {when} FOR EACH ROW EXECUTE FUNCTION {function_name}()")


def downgrade() -> None:
    bind = op.get_bind()
    # Lock first, so nothing can be written between the check and the drop.
    bind.execute(
        sa.text(f"LOCK TABLE {ORDERS}, {SETTINGS}, {PAYMENTS}, {REFUNDS} IN ACCESS EXCLUSIVE MODE")
    )
    found = {
        description: int(bind.execute(sa.text(query)).scalar_one())
        for description, query in LIVE_DATA
    }
    live = {description: count for description, count in found.items() if count}
    if live:
        listing = ", ".join(f"{count} {description}" for description, count in live.items())
        raise RuntimeError(
            f"Refusing to downgrade 0014: it would destroy Grocery payment records or settings "
            f"({listing}). Nothing was changed. Roll forward, or export and remove the data "
            "deliberately first."
        )

    for name, _, _ in TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {TRIGGER_TABLES[name]}")
    for function_name in (
        "grocery_payment_matches_order",
        "grocery_order_keeps_its_money",
        "grocery_refund_fits_order",
    ):
        op.execute(f"DROP FUNCTION IF EXISTS {function_name}()")
    op.drop_table(REFUNDS)

    op.drop_index("uq_grocery_payments_online_reference", table_name=PAYMENTS)
    op.drop_constraint("uq_grocery_payments_id_order_id_amount", PAYMENTS, type_="unique")
    for name in ("reference_format", "reference_iff_not_cash"):
        op.drop_constraint(op.f(f"ck_{PAYMENTS}_{name}"), PAYMENTS, type_="check")
    _replace_check(PAYMENTS, "method_valid", f"method IN ({CASH})")
    op.drop_column(PAYMENTS, "reference")

    for name in ("full_coverage_needs_blocks", "payment_methods_valid"):
        op.drop_constraint(op.f(f"ck_{SETTINGS}_{name}"), SETTINGS, type_="check")
    op.drop_column(SETTINGS, "covers_all_b17")
    op.drop_column(SETTINGS, "payment_methods")
