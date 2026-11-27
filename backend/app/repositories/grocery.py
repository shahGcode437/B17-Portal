"""Persistence for Grocery order intake (GROCERY-1b). Query / add / guarded-update / lock only —
**never commits**: the services own every transaction, and each lock lives exactly as long as the
transaction that took it.

LOCK ORDER (binding; BACKEND_ARCHITECTURE.md §5.1). A path takes only the steps it needs, always
in this order:

* **submit:** requester advisory lock → ``users`` ``FOR SHARE`` → the session ``FOR SHARE`` →
  settings advisory lock (shared) → the day's capacity row (updated) → inserts;
* **cancel:** the order row ``FOR UPDATE`` → ``users`` ``FOR SHARE`` → the session ``FOR SHARE``;
* **settings change:** ``users`` → the acting session → ``user_roles``, all ``FOR SHARE`` (the
  staff authority order) → settings advisory lock (exclusive) → insert.

``users`` before ``auth_sessions`` is the order password change, password reset and every staff
mutation use, so none of these can wait on each other in a cycle.
"""

import dataclasses
import datetime
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    AuthSession,
    GroceryDailyCapacity,
    GroceryOrder,
    GroceryOrderConfirmation,
    GroceryOrderItem,
    GroceryOrderStatusHistory,
    GroceryPayment,
    GrocerySettingsRevision,
    User,
)
from app.models.enums import GroceryOrderStatus, UserStatus
from app.services.grocery_rules import ACTIVE_STATUSES

#: The advisory-lock key of the Grocery settings ("GROCSETS" as a 64-bit integer). Different from
#: the staff-authority and taxonomy keys, so they never contend.
SETTINGS_LOCK_KEY = 0x47524F4353455453


@dataclasses.dataclass(frozen=True)
class AccountState:
    """The caller's account and session as they are NOW, both rows locked ``FOR SHARE``."""

    status: UserStatus
    email_verified: bool
    session_revoked: bool
    session_expires_at: datetime.datetime
    session_absolute_expires_at: datetime.datetime


class GroceryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # -- locks -----------------------------------------------------------------------------------

    def lock_customer(self, customer_id: uuid.UUID) -> None:
        """One customer's submissions run one at a time (transaction-scoped advisory lock)."""
        key = func.hashtextextended(f"b17:grocery_order:{customer_id}", 0)
        self._session.execute(select(func.pg_advisory_xact_lock(key)))

    def lock_settings_shared(self) -> None:
        self._session.execute(select(func.pg_advisory_xact_lock_shared(SETTINGS_LOCK_KEY)))

    def lock_settings_exclusive(self) -> None:
        self._session.execute(select(func.pg_advisory_xact_lock(SETTINGS_LOCK_KEY)))

    def lock_account(self, user_id: uuid.UUID, session_id: uuid.UUID) -> AccountState | None:
        """``users`` then the session, both ``FOR SHARE``: a suspension, password change or
        session revocation either committed before this (and is seen) or waits for this
        transaction to end. ``None`` if either row does not exist."""
        user = self._session.execute(
            select(User.status, User.email_verified_at)
            .where(User.id == user_id)
            .with_for_update(read=True)
        ).one_or_none()
        if user is None:
            return None
        found = self._session.execute(
            select(AuthSession.revoked_at, AuthSession.expires_at, AuthSession.absolute_expires_at)
            .where(AuthSession.id == session_id, AuthSession.user_id == user_id)
            .with_for_update(read=True)
        ).one_or_none()
        if found is None:
            return None
        return AccountState(user[0], user[1] is not None, found[0] is not None, found[1], found[2])

    # -- settings --------------------------------------------------------------------------------

    def current_settings(self) -> GrocerySettingsRevision | None:
        return self._session.scalars(
            select(GrocerySettingsRevision)
            .order_by(GrocerySettingsRevision.revision.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        ).first()

    def add_settings(self, row: GrocerySettingsRevision) -> GrocerySettingsRevision:
        self._session.add(row)
        self._session.flush()
        return row

    def display_name(self, user_id: uuid.UUID) -> str | None:
        return self._session.scalar(select(User.display_name).where(User.id == user_id))

    # -- idempotency and limits ------------------------------------------------------------------

    def find_by_key(self, customer_id: uuid.UUID, key_hash: bytes) -> GroceryOrder | None:
        """Scoped by customer: one customer's key can never find another's order."""
        return self._session.scalars(
            select(GroceryOrder).where(
                GroceryOrder.customer_id == customer_id,
                GroceryOrder.idempotency_key_hash == key_hash,
            )
        ).one_or_none()

    def count_active(self, customer_id: uuid.UUID) -> int:
        """Safe to compare with the limit only under :meth:`lock_customer` (the only path that
        adds an order holds it; a concurrent cancel can only lower the number)."""
        return int(
            self._session.scalar(
                select(func.count())
                .select_from(GroceryOrder)
                .where(
                    GroceryOrder.customer_id == customer_id,
                    GroceryOrder.status.in_(ACTIVE_STATUSES),
                )
            )
            or 0
        )

    def reserved_on(self, day: datetime.date) -> int:
        """Places taken on ``day`` (an unlocked read, for the availability answer only)."""
        return int(
            self._session.scalar(
                select(GroceryDailyCapacity.reserved).where(
                    GroceryDailyCapacity.service_date == day
                )
            )
            or 0
        )

    def reserve_place(self, day: datetime.date, limit: int) -> bool:
        """Take one of ``day``'s places, or ``False`` if ``limit`` are taken. ONE guarded UPDATE:
        concurrent submitters queue on the row, each re-reading the committed count, so the limit
        holds across any number of processes. A rollback gives the place back."""
        self._session.execute(
            insert(GroceryDailyCapacity)
            .values(service_date=day, reserved=0)
            .on_conflict_do_nothing()
        )
        taken = self._session.scalar(
            update(GroceryDailyCapacity)
            .where(GroceryDailyCapacity.service_date == day, GroceryDailyCapacity.reserved < limit)
            .values(reserved=GroceryDailyCapacity.reserved + 1)
            .returning(GroceryDailyCapacity.reserved)
            .execution_options(synchronize_session=False)
        )
        return taken is not None

    # -- orders ----------------------------------------------------------------------------------

    def reference_taken(self, reference: str) -> bool:
        return (
            self._session.scalar(select(GroceryOrder.id).where(GroceryOrder.reference == reference))
            is not None
        )

    def add_order(self, order: GroceryOrder, items: list[GroceryOrderItem]) -> GroceryOrder:
        self._session.add(order)
        self._session.flush()
        for item in items:
            item.order_id = order.id
        self._session.add_all(items)
        self._session.flush()
        return order

    def add_history(self, row: GroceryOrderStatusHistory) -> None:
        self._session.add(row)
        self._session.flush()

    def own_order(
        self, order_id: uuid.UUID, customer_id: uuid.UUID, *, lock: bool = False
    ) -> GroceryOrder | None:
        """The order ONLY if ``customer_id`` owns it: there is no unscoped read in this phase."""
        statement = select(GroceryOrder).where(
            GroceryOrder.id == order_id, GroceryOrder.customer_id == customer_id
        )
        if lock:
            statement = statement.with_for_update()
        return self._session.scalars(
            statement.execution_options(populate_existing=True)
        ).one_or_none()

    def own_page(
        self,
        customer_id: uuid.UUID,
        status: GroceryOrderStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[tuple[GroceryOrder, int]]]:
        """The customer's orders, newest first, each with its number of items."""
        conditions = [GroceryOrder.customer_id == customer_id]
        if status is not None:
            conditions.append(GroceryOrder.status == status)
        total = int(
            self._session.scalar(select(func.count()).select_from(GroceryOrder).where(*conditions))
            or 0
        )
        count = (
            select(func.count())
            .select_from(GroceryOrderItem)
            .where(GroceryOrderItem.order_id == GroceryOrder.id)
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        rows = self._session.execute(
            select(GroceryOrder, count)
            .where(*conditions)
            .order_by(GroceryOrder.submitted_at.desc(), GroceryOrder.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return total, [(order, int(items)) for order, items in rows]

    def confirmations_of(self, order_id: uuid.UUID) -> list[GroceryOrderConfirmation]:
        return list(
            self._session.scalars(
                select(GroceryOrderConfirmation)
                .where(GroceryOrderConfirmation.order_id == order_id)
                .order_by(GroceryOrderConfirmation.sequence)
            )
        )

    def payment_of(self, order_id: uuid.UUID) -> GroceryPayment | None:
        return self._session.scalars(
            select(GroceryPayment).where(GroceryPayment.order_id == order_id)
        ).one_or_none()

    def items_of(self, order_id: uuid.UUID) -> list[GroceryOrderItem]:
        return list(
            self._session.scalars(
                select(GroceryOrderItem)
                .where(GroceryOrderItem.order_id == order_id)
                .order_by(GroceryOrderItem.position)
            )
        )

    def history_of(self, order_id: uuid.UUID) -> list[GroceryOrderStatusHistory]:
        return list(
            self._session.scalars(
                select(GroceryOrderStatusHistory)
                .where(GroceryOrderStatusHistory.order_id == order_id)
                .order_by(GroceryOrderStatusHistory.created_at, GroceryOrderStatusHistory.id)
            )
        )

    def guarded_cancel(
        self,
        order_id: uuid.UUID,
        *,
        from_status: GroceryOrderStatus,
        to_status: GroceryOrderStatus,
        revision: int,
        cancelled_at: datetime.datetime,
        reason: str | None,
    ) -> bool:
        """``UPDATE … WHERE id, status and revision still match``: two cancellations cannot both
        apply. The day's capacity is deliberately NOT touched."""
        changed = self._session.scalar(
            update(GroceryOrder)
            .where(
                GroceryOrder.id == order_id,
                GroceryOrder.status == from_status,
                GroceryOrder.revision == revision,
            )
            .values(
                status=to_status,
                revision=GroceryOrder.revision + 1,
                cancelled_at=cancelled_at,
                cancel_reason=reason,
                updated_at=func.now(),
            )
            .returning(GroceryOrder.id)
            .execution_options(synchronize_session=False)
        )
        return changed is not None
