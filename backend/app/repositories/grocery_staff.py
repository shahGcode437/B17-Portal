"""Persistence for the staff side of Grocery orders (GROCERY-2). Query / add / guarded-update /
lock only — **never commits**: the service owns every transaction.

LOCK ORDER of every staff change (binding; BACKEND_ARCHITECTURE.md §5, AUTH_RBAC.md §36.4 and §37):

    the order row ``FOR UPDATE``  →  the actor's ``users`` row, then the acting session,
    ``FOR SHARE``  →  ``user_roles``  →  the ``grocery`` scope row (a Moderator)
    →  the settings lock, shared (recording an agreement only)

The order row comes first, as in the customer's own cancellation, so the two simply queue on it.
"""

import datetime
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import ColumnElement, Select, func, select, update

from app.models import (
    GroceryOrder,
    GroceryOrderEvent,
    GroceryOrderItem,
    GroceryOrderStatusHistory,
    GroceryPayment,
    GroceryRefund,
    User,
)
from app.models.enums import GroceryEventAction, GroceryOrderStatus, GroceryPaymentMethod
from app.repositories.grocery import GroceryRepository
from app.repositories.search import LIKE_ESCAPE, escape_like


@dataclass(frozen=True)
class QueueFilter:
    #: Who is looking. THEIR OWN orders are never listed or counted. Required on purpose.
    viewer_id: uuid.UUID
    status: GroceryOrderStatus | None = None
    #: A normalized reference prefix (``GRC-…``).
    reference_prefix: str | None = None
    #: The Asia/Karachi calendar day the order was submitted on.
    submitted_on: datetime.date | None = None
    unassigned: bool = False
    assigned_to: uuid.UUID | None = None


@dataclass(frozen=True)
class QueueRow:
    order: GroceryOrder
    item_count: int
    failed_delivery_attempts: int
    issue_count: int
    paid: bool
    refunded: bool
    assignee_name: str | None


class GroceryStaffRepository(GroceryRepository):
    # -- the order ------------------------------------------------------------------------------

    def order_for_staff(self, order_id: uuid.UUID, *, lock: bool = False) -> GroceryOrder | None:
        """Any customer's order. ONLY the staff service calls this, after (or while) it proves
        Grocery authority; customer paths use the owner-scoped ``own_order``."""
        statement = select(GroceryOrder).where(GroceryOrder.id == order_id)
        if lock:
            statement = statement.with_for_update()
        return self._session.scalars(
            statement.execution_options(populate_existing=True)
        ).one_or_none()

    def guarded_update(
        self,
        order_id: uuid.UUID,
        *,
        from_status: GroceryOrderStatus,
        revision: int,
        values: dict[str, Any],
    ) -> bool:
        """``UPDATE … WHERE id, status and revision still match``; bumps the revision."""
        changed = self._session.scalar(
            update(GroceryOrder)
            .where(
                GroceryOrder.id == order_id,
                GroceryOrder.status == from_status,
                GroceryOrder.revision == revision,
            )
            .values(revision=GroceryOrder.revision + 1, updated_at=func.now(), **values)
            .returning(GroceryOrder.id)
            .execution_options(synchronize_session=False)
        )
        return changed is not None

    def set_assignment(
        self,
        order_id: uuid.UUID,
        *,
        expected: uuid.UUID | None,
        assignee: uuid.UUID | None,
        at: datetime.datetime | None,
    ) -> bool:
        """Assign or release, only if the assignee is still ``expected``. It does NOT change the
        revision: handling an order internally must not invalidate what the customer is looking
        at (their cancellation carries the revision)."""
        current: ColumnElement[bool] = (
            GroceryOrder.assigned_to.is_(None)
            if expected is None
            else GroceryOrder.assigned_to == expected
        )
        changed = self._session.scalar(
            update(GroceryOrder)
            .where(GroceryOrder.id == order_id, current)
            .values(assigned_to=assignee, assigned_at=at, updated_at=func.now())
            .returning(GroceryOrder.id)
            .execution_options(synchronize_session=False)
        )
        return changed is not None

    # -- staff records --------------------------------------------------------------------------

    def add_record(self, row: object) -> None:
        """Add an agreement, a cash collection or an event, and flush (constraints apply now)."""
        self._session.add(row)
        self._session.flush()

    def reference_used(self, method: GroceryPaymentMethod, reference: str) -> bool:
        """Whether another payment already carries this online reference (the unique index is
        what guarantees it; this only gives the ordinary case a clear answer)."""
        found = self._session.scalar(
            select(GroceryPayment.id).where(
                GroceryPayment.method == method, GroceryPayment.reference == reference
            )
        )
        return found is not None

    def events_of(self, order_id: uuid.UUID) -> list[GroceryOrderEvent]:
        return list(
            self._session.scalars(
                select(GroceryOrderEvent)
                .where(GroceryOrderEvent.order_id == order_id)
                .order_by(GroceryOrderEvent.created_at, GroceryOrderEvent.id)
            )
        )

    def display_names(self, user_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not user_ids:
            return {}
        rows = self._session.execute(
            select(User.id, User.display_name).where(User.id.in_(set(user_ids)))
        )
        return {row[0]: row[1] for row in rows}

    # -- the queue ------------------------------------------------------------------------------

    @staticmethod
    def _conditions(wanted: QueueFilter) -> list[ColumnElement[bool]]:
        conditions: list[ColumnElement[bool]] = [GroceryOrder.customer_id != wanted.viewer_id]
        if wanted.reference_prefix is not None:
            conditions.append(
                GroceryOrder.reference.like(
                    f"{escape_like(wanted.reference_prefix)}%", escape=LIKE_ESCAPE
                )
            )
        if wanted.submitted_on is not None:
            conditions.append(GroceryOrder.service_date == wanted.submitted_on)
        if wanted.unassigned:
            conditions.append(GroceryOrder.assigned_to.is_(None))
        if wanted.assigned_to is not None:
            conditions.append(GroceryOrder.assigned_to == wanted.assigned_to)
        return conditions

    def status_counts(self, wanted: QueueFilter) -> dict[GroceryOrderStatus, int]:
        """Orders per status under every filter EXCEPT the status one."""
        rows = self._session.execute(
            select(GroceryOrder.status, func.count())
            .where(*self._conditions(wanted))
            .group_by(GroceryOrder.status)
        )
        return {row[0]: int(row[1]) for row in rows}

    def queue_page(
        self,
        wanted: QueueFilter,
        *,
        sort: Literal["oldest", "newest"],
        limit: int,
        offset: int,
    ) -> tuple[int, list[QueueRow]]:
        conditions = self._conditions(wanted)
        if wanted.status is not None:
            conditions.append(GroceryOrder.status == wanted.status)
        total = int(
            self._session.scalar(select(func.count()).select_from(GroceryOrder).where(*conditions))
            or 0
        )
        order_by = (
            (GroceryOrder.submitted_at.asc(), GroceryOrder.id.asc())
            if sort == "oldest"
            else (GroceryOrder.submitted_at.desc(), GroceryOrder.id.desc())
        )
        rows = self._session.execute(
            self._queue_select().where(*conditions).order_by(*order_by).limit(limit).offset(offset)
        ).all()
        return total, [self._queue_row(row) for row in rows]

    def queue_row(self, order_id: uuid.UUID) -> QueueRow | None:
        row = self._session.execute(
            self._queue_select()
            .where(GroceryOrder.id == order_id)
            .execution_options(populate_existing=True)
        ).one_or_none()
        return None if row is None else self._queue_row(row)

    @staticmethod
    def _queue_select() -> Select[Any]:
        """One statement per page: the order with its counts and assignee name. No delivery
        detail, item text or customer identity is selected into a summary."""
        items = (
            select(func.count())
            .select_from(GroceryOrderItem)
            .where(GroceryOrderItem.order_id == GroceryOrder.id)
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        failed = (
            select(func.count())
            .select_from(GroceryOrderStatusHistory)
            .where(
                GroceryOrderStatusHistory.order_id == GroceryOrder.id,
                GroceryOrderStatusHistory.from_status == GroceryOrderStatus.OUT_FOR_DELIVERY,
                GroceryOrderStatusHistory.to_status == GroceryOrderStatus.PREPARING,
            )
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        issues = (
            select(func.count())
            .select_from(GroceryOrderEvent)
            .where(
                GroceryOrderEvent.order_id == GroceryOrder.id,
                GroceryOrderEvent.action == GroceryEventAction.ISSUE_RECORDED,
            )
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        paid = (
            select(func.count())
            .select_from(GroceryPayment)
            .where(GroceryPayment.order_id == GroceryOrder.id)
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        refunded = (
            select(func.count())
            .select_from(GroceryRefund)
            .where(GroceryRefund.order_id == GroceryOrder.id)
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        assignee = (
            select(User.display_name)
            .where(User.id == GroceryOrder.assigned_to)
            .correlate(GroceryOrder)
            .scalar_subquery()
        )
        return select(GroceryOrder, items, failed, issues, paid, refunded, assignee)

    @staticmethod
    def _queue_row(row: Any) -> QueueRow:
        order, items, failed, issues, paid, refunded, assignee = row
        return QueueRow(
            order, int(items), int(failed), int(issues), bool(paid), bool(refunded), assignee
        )
