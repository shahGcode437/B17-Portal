"""Grocery order intake (GROCERY-1b, migration ``0011``; docs/backend/DATA_MODEL.md §21).

An INDEPENDENT domain: no foreign key to listings, categories or service requests. The only shared
references are ``users``.

* ``grocery_orders`` + ``grocery_order_items`` — what a customer asked for, with the delivery
  details as they were at submission (a snapshot). No price, quotation, supplier or payment column
  exists: those arrive with the phases that give them meaning. Items never change.
* ``grocery_order_status_history`` — one row per creation or transition, in the same transaction.
  Append-only: a database trigger refuses UPDATE and DELETE.
* ``grocery_daily_capacity`` — one counter per Asia/Karachi calendar day. A place is reserved by a
  single guarded UPDATE and is NEVER released: a cancelled order keeps its day's place.
* ``grocery_settings_revisions`` — the operating settings. Every change INSERTS a complete new
  row; the highest ``revision`` is current. Append-only (triggers), so the table is its own
  audit: who changed the settings, when, and exactly what they became.

The triggers live only in the migration (SQLAlchemy does not describe them and Alembic neither
compares nor drops them).
"""

import datetime
import uuid
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    String,
    Time,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import (
    GroceryActorRole,
    GroceryOrderStatus,
    GrocerySubstitution,
    GroceryUnit,
)


class GroceryOrder(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "grocery_orders"

    #: Random and non-sequential: it reveals no order volume.
    reference: Mapped[str] = mapped_column(String(16), nullable=False)
    #: ``RESTRICT``: users are tombstoned, never deleted, so an order always keeps its owner.
    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[GroceryOrderStatus] = mapped_column(
        str_enum(GroceryOrderStatus),
        nullable=False,
        server_default=GroceryOrderStatus.SUBMITTED.value,
    )
    #: Optimistic concurrency: bumped by every status change.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # -- the delivery snapshot (PRIVATE: only the owner reads it in this phase) ----------------
    contact_name: Mapped[str] = mapped_column(String(80), nullable=False)
    contact_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    #: The CONFIGURED spelling of the serviceable block at the time of submission.
    block: Mapped[str] = mapped_column(String(40), nullable=False)
    address_line: Mapped[str] = mapped_column(String(200), nullable=False)
    landmark: Mapped[str | None] = mapped_column(String(100))
    instructions: Mapped[str | None] = mapped_column(String(500))
    # -- submission and cancellation ------------------------------------------------------------
    #: The Asia/Karachi calendar day whose capacity this order consumed.
    service_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    #: The application clock at submission (the clock the operating window was judged on).
    submitted_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(String(200))
    # -- idempotency (hashes only; kept as long as the order, so a key can never create twice) --
    idempotency_key_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    request_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    __table_args__ = (
        UniqueConstraint("reference", name="uq_grocery_orders_reference"),
        UniqueConstraint(
            "customer_id",
            "idempotency_key_hash",
            name="uq_grocery_orders_customer_id_idempotency_key_hash",
        ),
        in_values("status", GroceryOrderStatus, name="status_valid"),
        CheckConstraint(r"reference ~ '^GRC-[2-9A-HJKMNP-Z]{8}$'", name="reference_format"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("char_length(btrim(contact_name)) >= 2", name="contact_name_min_length"),
        CheckConstraint(r"contact_phone ~ '^\+92[0-9]{9,10}$'", name="contact_phone_pk_e164"),
        CheckConstraint("char_length(btrim(block)) >= 1", name="block_not_blank"),
        CheckConstraint("char_length(btrim(address_line)) >= 5", name="address_line_min_length"),
        CheckConstraint(
            "landmark IS NULL OR char_length(btrim(landmark)) >= 1", name="landmark_not_blank"
        ),
        CheckConstraint(
            "instructions IS NULL OR char_length(btrim(instructions)) >= 1",
            name="instructions_not_blank",
        ),
        CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)", name="cancelled_at_iff_cancelled"
        ),
        CheckConstraint(
            "cancel_reason IS NULL OR "
            "(status = 'cancelled' AND char_length(btrim(cancel_reason)) >= 1)",
            name="cancel_reason_only_when_cancelled",
        ),
        CheckConstraint(
            "octet_length(idempotency_key_hash) = 32 AND octet_length(request_hash) = 32",
            name="hash_lengths",
        ),
        # The per-customer active-order count.
        Index("ix_grocery_orders_customer_id_status", "customer_id", "status"),
    )


# The customer's own history: newest first.
Index(
    "ix_grocery_orders_customer_id_submitted_at",
    GroceryOrder.customer_id,
    GroceryOrder.submitted_at.desc(),
)


class GroceryOrderItem(UUIDPrimaryKeyMixin, Base):
    """One requested line, exactly as submitted. Never changed afterwards."""

    __tablename__ = "grocery_order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grocery_orders.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: Exact: ``NUMERIC`` in the database, ``Decimal`` in Python, a string on the wire.
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    unit: Mapped[GroceryUnit] = mapped_column(str_enum(GroceryUnit), nullable=False)
    preferred_brand: Mapped[str | None] = mapped_column(String(60))
    substitution: Mapped[GrocerySubstitution] = mapped_column(
        str_enum(GrocerySubstitution), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(200))

    __table_args__ = (
        UniqueConstraint("order_id", "position", name="uq_grocery_order_items_order_id_position"),
        CheckConstraint("position BETWEEN 1 AND 100", name="position_range"),
        CheckConstraint("char_length(btrim(name)) >= 1", name="name_not_blank"),
        # A backstop: the exact per-unit bounds are the service's (grocery_rules.UNIT_RULES).
        CheckConstraint("quantity > 0 AND quantity <= 5000", name="quantity_range"),
        CheckConstraint(
            "unit NOT IN ('gram', 'ml', 'piece', 'pack') OR quantity = trunc(quantity)",
            name="whole_units",
        ),
        in_values("unit", GroceryUnit, name="unit_valid"),
        in_values("substitution", GrocerySubstitution, name="substitution_valid"),
    )


class GroceryOrderStatusHistory(UUIDPrimaryKeyMixin, Base):
    """Append-only. There is no ``updated_at`` on purpose."""

    __tablename__ = "grocery_order_status_history"

    order_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grocery_orders.id", ondelete="RESTRICT"), nullable=False
    )
    from_status: Mapped[GroceryOrderStatus | None] = mapped_column(str_enum(GroceryOrderStatus))
    to_status: Mapped[GroceryOrderStatus] = mapped_column(
        str_enum(GroceryOrderStatus), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    actor_role: Mapped[GroceryActorRole] = mapped_column(str_enum(GroceryActorRole), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200))
    #: The wall clock of the write (after the order row was locked), not the transaction start.
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )

    __table_args__ = (
        in_values("from_status", GroceryOrderStatus, name="from_status_valid", nullable=True),
        in_values("to_status", GroceryOrderStatus, name="to_status_valid"),
        in_values("actor_role", GroceryActorRole, name="actor_role_valid"),
        CheckConstraint(
            "(from_status IS NULL) = (to_status = 'submitted')", name="from_status_iff_submitted"
        ),
        Index("ix_grocery_order_status_history_order_id_created_at", "order_id", "created_at"),
    )


class GroceryDailyCapacity(Base):
    """Places taken on one Asia/Karachi calendar day. Only ever counts up."""

    __tablename__ = "grocery_daily_capacity"

    service_date: Mapped[datetime.date] = mapped_column(Date, primary_key=True)
    reserved: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (CheckConstraint("reserved >= 0", name="reserved_not_negative"),)


class GrocerySettingsRevision(Base):
    """One complete version of the Grocery operating settings. Insert-only.

    ``actor_user_id`` has no foreign key on purpose (as in the staff audit): a history row never
    blocks account maintenance, and ``TRUNCATE users CASCADE`` never reaches the settings. It is
    ``NULL`` only for the default row the migration inserts."""

    __tablename__ = "grocery_settings_revisions"

    revision: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    enabled: Mapped[bool] = mapped_column(nullable=False)
    serviceable_blocks: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    #: ISO weekdays: 1 = Monday ... 7 = Sunday.
    operating_days: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), nullable=False)
    opens_at: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    closes_at: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    daily_capacity: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    max_active_orders_per_customer: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    max_items_per_order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    request_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )

    __table_args__ = (
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("cardinality(serviceable_blocks) <= 100", name="blocks_bounded"),
        CheckConstraint("array_position(serviceable_blocks, NULL) IS NULL", name="blocks_no_nulls"),
        CheckConstraint(
            "cardinality(operating_days) BETWEEN 1 AND 7 "
            "AND operating_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] "
            "AND array_position(operating_days, NULL) IS NULL",
            name="operating_days_valid",
        ),
        CheckConstraint("opens_at < closes_at", name="opens_before_closes"),
        CheckConstraint("timezone IN ('Asia/Karachi')", name="timezone_valid"),
        CheckConstraint("daily_capacity BETWEEN 1 AND 200", name="daily_capacity_range"),
        CheckConstraint(
            "max_active_orders_per_customer BETWEEN 1 AND 10", name="max_active_orders_range"
        ),
        CheckConstraint("max_items_per_order BETWEEN 1 AND 100", name="max_items_range"),
        CheckConstraint("revision = 1 OR actor_user_id IS NOT NULL", name="change_has_actor"),
    )
