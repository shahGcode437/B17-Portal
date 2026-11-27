"""Grocery order handling by STAFF: queue, detail, assignment, the recorded customer agreement,
preparation, delivery, cash on delivery and cancellation (GROCERY-2;
docs/backend/API_CONTRACT.md §19, AUTH_RBAC.md §37).

The business is deliberately simple: the team receives a list, agrees a price with the customer by
telephone, buys the goods, delivers them and takes cash. There is no quotation engine, supplier,
inventory or online payment here.

EVERY change is one transaction, in this order (AUTH_RBAC.md §36.4):

1. the order row ``FOR UPDATE`` (the same lock the customer's cancellation takes);
2. the actor and the acting session, ``FOR SHARE`` (``hold_acting_session``);
3. the actor's staff role, locked → no longer staff ``403``; then an ended session ``401``;
4. for a Moderator, the ``grocery`` scope row, locked → ``403``;
5. only now the order: missing ``404``; the actor's OWN order ``403 own_order``;
6. a Moderator must hold the order (``409 order_not_claimed``); a Super Admin need not;
7. the status allows the operation (``409 invalid_state_transition``), the ``revision`` the actor
   saw is current (``409 order_conflict``), then the operation's own rules (``422``);
8. the guarded update and its record(s), committed together.

The route guard is only a front door. Reads use the request-start principal: a read is stale for at
most its own duration and changes nothing.

NOBODY SEES THEIR OWN ORDER ON THE STAFF SIDE, a Super Admin included: it is left out of the
queue, the total and the counts, and its detail is refused like a change (``403 own_order``).
They follow it as any customer does.

WHAT A STAFF MEMBER RECORDS IS NEVER PRESENTED AS THE CUSTOMER'S OWN ACTION. An agreement row says
that a named staff member states the customer agreed, how, and when.
"""

import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.db.session import transaction
from app.models import (
    GroceryOrder,
    GroceryOrderConfirmation,
    GroceryOrderEvent,
    GroceryOrderStatusHistory,
    GroceryPayment,
)
from app.models.enums import (
    GroceryActorRole,
    GroceryEventAction,
    GroceryIssueKind,
    GroceryOrderStatus,
    GroceryPaymentMethod,
    RoleName,
)
from app.repositories.grocery_staff import GroceryStaffRepository, QueueFilter, QueueRow
from app.repositories.staff import StaffAuthorityRepository
from app.schemas.grocery import GroceryDeliveryRead, GroceryItemRead
from app.schemas.grocery_staff import (
    GroceryAgreementRequest,
    GroceryCompleteRequest,
    GroceryDeliveryAttemptRead,
    GroceryDeliveryFailedRequest,
    GroceryDispatchRequest,
    GroceryIssueRequest,
    GroceryQueueMeta,
    GroceryQueueQuery,
    GroceryReagreementRequest,
    GroceryReduceAmountRequest,
    GroceryRevisionRequest,
    GroceryStaffAction,
    GroceryStaffCancelRequest,
    GroceryStaffConfirmationRead,
    GroceryStaffEventRead,
    GroceryStaffHistoryRead,
    GroceryStaffMemberRef,
    GroceryStaffOrderDetail,
    GroceryStaffOrderSummary,
    GroceryStaffPaymentRead,
)
from app.services import grocery_rules as rules
from app.services.auth_sessions import Principal, hold_acting_session
from app.services.grocery_errors import private_database_errors
from app.services.service_requests import invalid_transition, not_found, parse_id
from app.services.staff_scopes import GROCERY_SCOPE

_STAFF = GroceryActorRole.STAFF


@dataclass(frozen=True)
class _Actor:
    user_id: uuid.UUID
    is_super_admin: bool


def _forbidden(code: str | None = None, message: str = "") -> AppError:
    details = None if code is None else [ErrorDetail(field="order", code=code, message=message)]
    return AppError(ErrorCode.FORBIDDEN, status_code=403, details=details)


def _conflict(code: ErrorCode) -> AppError:
    return AppError(code, status_code=409)


def _invalid(field: str, code: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        status_code=422,
        details=[ErrorDetail(field=field, code=code, message=message)],
    )


def _stale(current_revision: int) -> AppError:
    return AppError(
        ErrorCode.ORDER_CONFLICT,
        status_code=409,
        details=[
            ErrorDetail(
                field="revision",
                code="stale_revision",
                message=f"The order is now at revision {current_revision}.",
            )
        ],
    )


class GroceryStaffOrderService:
    def __init__(self, session: Session, *, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._repository = GroceryStaffRepository(session)
        self._authority = StaffAuthorityRepository(session)

    # -- reads -----------------------------------------------------------------------------------

    def queue(
        self, principal: Principal, query: GroceryQueueQuery
    ) -> tuple[list[GroceryStaffOrderSummary], GroceryQueueMeta]:
        wanted = self._filter(principal, query)
        total, rows = self._repository.queue_page(
            wanted, sort=query.sort, limit=query.limit, offset=query.offset
        )
        counted = self._repository.status_counts(wanted)
        meta = GroceryQueueMeta(
            total=total,
            limit=query.limit,
            offset=query.offset,
            counts={status.value: counted.get(status, 0) for status in GroceryOrderStatus},
        )
        return [GroceryStaffOrderSummary(**_summary_fields(row)) for row in rows], meta

    def detail(self, principal: Principal, raw_id: str) -> GroceryStaffOrderDetail:
        row = self._repository.queue_row(parse_id(raw_id))
        if row is None:
            raise not_found()
        self._refuse_own(row.order, principal.user_id)  # before any internal record is read
        return self._present(principal, row)

    # -- assignment ------------------------------------------------------------------------------

    def claim(self, principal: Principal, raw_id: str) -> uuid.UUID:
        """Take an unassigned order. Claiming one you already hold changes nothing."""
        with self._change(principal, raw_id) as (order, actor):
            if order.status in rules.TERMINAL_STATUSES:
                raise invalid_transition()
            if order.assigned_to != actor.user_id:
                if order.assigned_to is not None or not self._repository.set_assignment(
                    order.id, expected=None, assignee=actor.user_id, at=self._clock()
                ):
                    raise _conflict(ErrorCode.ORDER_ALREADY_CLAIMED)
                self._event(order, actor, GroceryEventAction.CLAIMED, subject=actor.user_id)
            return order.id

    def release(self, principal: Principal, raw_id: str) -> uuid.UUID:
        """Give an order back: its holder, or a Super Admin for anyone's."""
        with self._change(principal, raw_id) as (order, actor):
            if order.status in rules.TERMINAL_STATUSES:
                raise invalid_transition()
            holder = order.assigned_to
            if holder is None or (holder != actor.user_id and not actor.is_super_admin):
                raise _conflict(ErrorCode.ORDER_NOT_CLAIMED)
            if not self._repository.set_assignment(
                order.id, expected=holder, assignee=None, at=None
            ):  # pragma: no cover - the row lock makes this unreachable
                raise _conflict(ErrorCode.ORDER_NOT_CLAIMED)
            self._event(order, actor, GroceryEventAction.RELEASED, subject=holder)
            return order.id

    # -- the customer's agreement and the price --------------------------------------------------

    def confirm(
        self, principal: Principal, raw_id: str, payload: GroceryAgreementRequest
    ) -> uuid.UUID:
        """``submitted -> confirmed``. There is no way into ``confirmed`` without this record."""
        with self._change(principal, raw_id) as (order, actor):
            self._require_holder(order, actor)
            target = self._require_move(order, rules.GroceryAction.CONFIRM)
            self._require_revision(order, payload.revision)
            total = self._record_agreement(order, actor, payload)
            before = order.status
            self._apply(
                order,
                payload.revision,
                {"status": target, "agreed_total_paisa": total, "final_due_paisa": total},
            )
            self._history(order, actor, before, target)
            return order.id

    def reconfirm(
        self, principal: Principal, raw_id: str, payload: GroceryReagreementRequest
    ) -> uuid.UUID:
        """A NEW agreement for a changed price or substitution, with a note of what the customer
        agreed to. The earlier ones stay. This is the only way the amount due can ever go up."""
        with self._change(principal, raw_id) as (order, actor):
            self._require_holder(order, actor)
            if order.status not in rules.RECONFIRM_STATUSES:
                raise invalid_transition()
            self._require_revision(order, payload.revision)
            total = self._record_agreement(order, actor, payload)
            self._apply(
                order,
                payload.revision,
                {"agreed_total_paisa": total, "final_due_paisa": total},
            )
            return order.id

    def reduce_amount(
        self, principal: Principal, raw_id: str, payload: GroceryReduceAmountRequest
    ) -> uuid.UUID:
        """LOWER the amount due, with a reason (something unavailable, damaged or refused)."""
        with self._change(principal, raw_id) as (order, actor):
            self._require_holder(order, actor)
            if order.status not in rules.REDUCE_STATUSES:
                raise invalid_transition()
            self._require_revision(order, payload.revision)
            due = order.final_due_paisa
            assert due is not None  # a database CHECK: these statuses always have an amount
            if payload.final_amount_paisa >= due:
                raise _invalid(
                    "finalAmountPaisa",
                    "not_a_reduction",
                    "Only a lower amount can be set here. A higher one needs a new agreement.",
                )
            self._event(
                order,
                actor,
                GroceryEventAction.AMOUNT_REDUCED,
                amounts=(due, payload.final_amount_paisa),
                note=payload.reason,
            )
            self._apply(order, payload.revision, {"final_due_paisa": payload.final_amount_paisa})
            return order.id

    # -- preparation and delivery ----------------------------------------------------------------

    def start_preparing(
        self, principal: Principal, raw_id: str, payload: GroceryRevisionRequest
    ) -> uuid.UUID:
        return self._move(
            principal, raw_id, payload.revision, rules.GroceryAction.START_PREPARING, None
        )

    def dispatch(
        self, principal: Principal, raw_id: str, payload: GroceryDispatchRequest
    ) -> uuid.UUID:
        """``preparing -> out_for_delivery``: one delivery attempt begins."""
        return self._move(
            principal, raw_id, payload.revision, rules.GroceryAction.DISPATCH, payload.note
        )

    def delivery_failed(
        self, principal: Principal, raw_id: str, payload: GroceryDeliveryFailedRequest
    ) -> uuid.UUID:
        """The attempt failed: back to ``preparing``. Nothing is delivered and nothing is paid."""
        return self._move(
            principal,
            raw_id,
            payload.revision,
            rules.GroceryAction.DELIVERY_FAILED,
            payload.reason,
        )

    def complete(
        self, principal: Principal, raw_id: str, payload: GroceryCompleteRequest
    ) -> uuid.UUID:
        """Delivered AND paid, together or not at all. The cash must equal the amount due; any
        other outcome stays open for a person to resolve."""
        with self._change(principal, raw_id) as (order, actor):
            self._require_holder(order, actor)
            target = self._require_move(order, rules.GroceryAction.COMPLETE)
            self._require_revision(order, payload.revision)
            due = order.final_due_paisa
            assert due is not None
            if payload.amount_collected_paisa != due:
                raise _invalid(
                    "amountCollectedPaisa",
                    "amount_mismatch",
                    "The cash collected must equal the amount due. If it does not, leave the "
                    "order open and record an issue.",
                )
            now = self._clock()
            self._repository.add_record(
                GroceryPayment(
                    order_id=order.id,
                    method=GroceryPaymentMethod.CASH_ON_DELIVERY,
                    amount_due_paisa=due,
                    amount_collected_paisa=payload.amount_collected_paisa,
                    collected_by=actor.user_id,
                    collected_at=now,
                )
            )
            before = order.status
            self._apply(order, payload.revision, {"status": target, "delivered_at": now})
            self._history(order, actor, before, target)
            return order.id

    def cancel(
        self, principal: Principal, raw_id: str, payload: GroceryStaffCancelRequest
    ) -> uuid.UUID:
        """Staff cancellation, always with a reason. Once purchasing may have started it needs a
        Super Admin and an explicit acknowledgement, and leaves an issue for manual resolution.
        Never while out for delivery (record the failed attempt first); never a refund."""
        with self._change(principal, raw_id) as (order, actor):
            self._require_holder(order, actor)
            target = self._require_move(order, rules.GroceryAction.CANCEL)
            before = order.status
            after_procurement = before in rules.AFTER_PROCUREMENT
            if after_procurement and not actor.is_super_admin:
                raise _forbidden(
                    "super_admin_required",
                    "Only a Super Admin can cancel once the order is being prepared.",
                )
            self._require_revision(order, payload.revision)
            if after_procurement and not payload.procurement_acknowledged:
                raise _invalid(
                    "procurementAcknowledged",
                    "acknowledgement_required",
                    "Goods may already be bought. Confirm that you will resolve this manually.",
                )
            self._apply(order, payload.revision, {"status": target, "cancelled_at": self._clock()})
            self._history(order, actor, before, target, payload.reason)
            if after_procurement:
                self._event(
                    order,
                    actor,
                    GroceryEventAction.ISSUE_RECORDED,
                    issue=GroceryIssueKind.CANCELLED_AFTER_PROCUREMENT,
                    note=payload.reason,
                )
            return order.id

    def record_issue(
        self, principal: Principal, raw_id: str, payload: GroceryIssueRequest
    ) -> uuid.UUID:
        """Write down something a person has to resolve. It changes nothing else, so any Grocery
        staff member may add one, in any status."""
        with self._change(principal, raw_id) as (order, actor):
            self._event(
                order,
                actor,
                GroceryEventAction.ISSUE_RECORDED,
                issue=payload.kind,
                note=payload.note,
            )
            return order.id

    # -- the gate every change passes ------------------------------------------------------------

    @contextmanager
    def _change(self, principal: Principal, raw_id: str) -> Iterator[tuple[GroceryOrder, _Actor]]:
        order_id = parse_id(raw_id)
        with private_database_errors(), transaction(self._session):
            order = self._repository.order_for_staff(order_id, lock=True)
            actor = self._authorise(principal)
            if order is None:
                raise not_found()
            self._refuse_own(order, actor.user_id)
            yield order, actor

    def _authorise(self, principal: Principal) -> _Actor:
        """Grocery authority as it stands NOW, locked until the change ends."""
        user_id = principal.user_id
        acting = hold_acting_session(self._authority, user_id, principal.session_id, self._clock)
        roles = self._authority.share_staff_roles(user_id)
        is_super_admin = RoleName.ADMIN in roles
        if not (is_super_admin or RoleName.MODERATOR in roles):
            raise _forbidden()
        acting.require()
        if not is_super_admin and not self._authority.share_moderator_scope(user_id, GROCERY_SCOPE):
            raise _forbidden()  # one scope covers every order, so this conceals nothing
        return _Actor(user_id, is_super_admin)

    @staticmethod
    def _refuse_own(order: GroceryOrder, user_id: uuid.UUID) -> None:
        if order.customer_id == user_id:
            raise _forbidden("own_order", "Another staff member must handle your own order.")

    @staticmethod
    def _require_holder(order: GroceryOrder, actor: _Actor) -> None:
        if not actor.is_super_admin and order.assigned_to != actor.user_id:
            raise _conflict(ErrorCode.ORDER_NOT_CLAIMED)

    @staticmethod
    def _require_move(order: GroceryOrder, action: rules.GroceryAction) -> GroceryOrderStatus:
        target = rules.next_status(order.status, action, _STAFF)
        if target is None:
            raise invalid_transition()
        return target

    @staticmethod
    def _require_revision(order: GroceryOrder, revision: int) -> None:
        if order.revision != revision:
            raise _stale(order.revision)

    def _apply(self, order: GroceryOrder, revision: int, values: dict[str, object]) -> None:
        if not self._repository.guarded_update(
            order.id, from_status=order.status, revision=revision, values=values
        ):  # pragma: no cover - the row lock makes this unreachable; kept as the safety net
            raise _stale(revision)

    def _move(
        self,
        principal: Principal,
        raw_id: str,
        revision: int,
        action: rules.GroceryAction,
        reason: str | None,
    ) -> uuid.UUID:
        """A change of status and nothing else."""
        with self._change(principal, raw_id) as (order, actor):
            self._require_holder(order, actor)
            target = self._require_move(order, action)
            self._require_revision(order, revision)
            before = order.status
            self._apply(order, revision, {"status": target})
            self._history(order, actor, before, target, reason)
            return order.id

    def _record_agreement(
        self, order: GroceryOrder, actor: _Actor, payload: GroceryAgreementRequest
    ) -> int:
        """Store what the customer agreed to, after checking the arithmetic and the pilot cap. The
        settings are read under their shared lock: a change of the cap either finished before or
        waits."""
        total = rules.order_total(
            payload.items_subtotal_paisa, payload.service_fee_paisa, payload.delivery_fee_paisa
        )
        if payload.agreed_total_paisa != total:
            raise _invalid(
                "agreedTotalPaisa",
                "total_mismatch",
                "The agreed total is not the sum of the items and fees.",
            )
        self._repository.lock_settings_shared()
        settings = self._repository.current_settings()
        if settings is None:
            raise AppError(ErrorCode.GROCERY_UNAVAILABLE, status_code=503)
        if total > settings.max_order_value_paisa:
            raise _invalid(
                "agreedTotalPaisa",
                "exceeds_order_limit",
                "The total is above the largest order value currently allowed.",
            )
        self._repository.add_record(
            GroceryOrderConfirmation(
                order_id=order.id,
                sequence=len(self._repository.confirmations_of(order.id)) + 1,
                items_subtotal_paisa=payload.items_subtotal_paisa,
                service_fee_paisa=payload.service_fee_paisa,
                delivery_fee_paisa=payload.delivery_fee_paisa,
                total_paisa=total,
                method=payload.method,
                substitutions_agreed=payload.substitutions_agreed,
                pricing_note=payload.pricing_note,
                consent_note=payload.consent_note,
                recorded_by=actor.user_id,
                recorded_at=self._clock(),
            )
        )
        return total

    def _history(
        self,
        order: GroceryOrder,
        actor: _Actor,
        before: GroceryOrderStatus,
        after: GroceryOrderStatus,
        reason: str | None = None,
    ) -> None:
        self._repository.add_history(
            GroceryOrderStatusHistory(
                order_id=order.id,
                from_status=before,
                to_status=after,
                actor_user_id=actor.user_id,
                actor_role=_STAFF,
                reason=reason,
            )
        )

    def _event(
        self,
        order: GroceryOrder,
        actor: _Actor,
        action: GroceryEventAction,
        *,
        subject: uuid.UUID | None = None,
        amounts: tuple[int, int] | None = None,
        issue: GroceryIssueKind | None = None,
        note: str | None = None,
    ) -> None:
        self._repository.add_record(
            GroceryOrderEvent(
                order_id=order.id,
                action=action,
                actor_user_id=actor.user_id,
                subject_user_id=subject,
                amount_before_paisa=None if amounts is None else amounts[0],
                amount_after_paisa=None if amounts is None else amounts[1],
                issue_kind=issue,
                note=note,
            )
        )

    # -- presentation ----------------------------------------------------------------------------

    @staticmethod
    def _filter(principal: Principal, query: GroceryQueueQuery) -> QueueFilter:
        unassigned, assigned_to = False, None
        if query.assigned == "me":
            assigned_to = principal.user_id
        elif query.assigned == "unassigned":
            unassigned = True
        elif query.assigned is not None:
            try:
                assigned_to = uuid.UUID(query.assigned)
            except ValueError:
                raise _invalid(
                    "assigned", "invalid_assignee", 'Use "me", "unassigned" or a staff id.'
                ) from None
        reference = None
        if query.reference is not None:
            text = query.reference.strip().upper()
            reference = (
                text if text.startswith(rules.REFERENCE_PREFIX) else rules.REFERENCE_PREFIX + text
            )
        return QueueFilter(
            viewer_id=principal.user_id,
            status=query.status,
            reference_prefix=reference,
            submitted_on=query.submitted_on,
            unassigned=unassigned,
            assigned_to=assigned_to,
        )

    def _present(self, principal: Principal, row: QueueRow) -> GroceryStaffOrderDetail:
        order = row.order
        history = self._repository.history_of(order.id)
        confirmations = self._repository.confirmations_of(order.id)
        payment = self._repository.payment_of(order.id)
        events = self._repository.events_of(order.id)
        staff_ids = {r.actor_user_id for r in history if r.actor_role is _STAFF}
        staff_ids.update(c.recorded_by for c in confirmations)
        staff_ids.update(e.actor_user_id for e in events)
        staff_ids.update(e.subject_user_id for e in events if e.subject_user_id is not None)
        if payment is not None:
            staff_ids.add(payment.collected_by)
        names = self._repository.display_names(staff_ids)

        def member(user_id: uuid.UUID) -> GroceryStaffMemberRef:
            return GroceryStaffMemberRef(user_id=user_id, display_name=names.get(user_id))

        return GroceryStaffOrderDetail(
            **_summary_fields(row),
            items=[
                GroceryItemRead(
                    position=item.position,
                    name=item.name,
                    unit=item.unit,
                    quantity=rules.format_quantity(item.quantity),
                    preferred_brand=item.preferred_brand,
                    substitution=item.substitution,
                    note=item.note,
                )
                for item in self._repository.items_of(order.id)
            ],
            delivery=GroceryDeliveryRead(
                contact_name=order.contact_name,
                contact_phone=order.contact_phone,
                block=order.block,
                address_line=order.address_line,
                landmark=order.landmark,
            ),
            instructions=order.instructions,
            cancelled_at=order.cancelled_at,
            delivered_at=order.delivered_at,
            confirmations=[
                GroceryStaffConfirmationRead(
                    sequence=c.sequence,
                    items_subtotal_paisa=c.items_subtotal_paisa,
                    service_fee_paisa=c.service_fee_paisa,
                    delivery_fee_paisa=c.delivery_fee_paisa,
                    total_paisa=c.total_paisa,
                    method=c.method,
                    substitutions_agreed=c.substitutions_agreed,
                    pricing_note=c.pricing_note,
                    consent_note=c.consent_note,
                    recorded_by=member(c.recorded_by),
                    recorded_at=c.recorded_at,
                )
                for c in confirmations
            ],
            payment=None
            if payment is None
            else GroceryStaffPaymentRead(
                method=payment.method,
                amount_due_paisa=payment.amount_due_paisa,
                amount_collected_paisa=payment.amount_collected_paisa,
                collected_by=member(payment.collected_by),
                collected_at=payment.collected_at,
            ),
            delivery_attempts=_attempts(history, member),
            history=[
                GroceryStaffHistoryRead(
                    from_status=r.from_status,
                    to_status=r.to_status,
                    actor_role=r.actor_role.value,
                    actor=member(r.actor_user_id) if r.actor_role is _STAFF else None,
                    reason=r.reason,
                    created_at=r.created_at,
                )
                for r in history
            ],
            events=[
                GroceryStaffEventRead(
                    action=e.action,
                    actor=member(e.actor_user_id),
                    subject=None if e.subject_user_id is None else member(e.subject_user_id),
                    amount_before_paisa=e.amount_before_paisa,
                    amount_after_paisa=e.amount_after_paisa,
                    issue_kind=e.issue_kind,
                    note=e.note,
                    created_at=e.created_at,
                )
                for e in events
            ],
            available_actions=available_actions(principal, order),
            updated_at=order.updated_at,
        )


def available_actions(principal: Principal, order: GroceryOrder) -> list[GroceryStaffAction]:
    """A hint for the screen; every request is decided again under lock. (A viewer's own order
    never gets here: its staff detail is refused.)"""
    status = order.status
    active = status in rules.ACTIVE_STATUSES
    holder = principal.is_super_admin or order.assigned_to == principal.user_id
    actions: list[GroceryStaffAction] = []
    if active and order.assigned_to is None:
        actions.append("claim")
    if active and order.assigned_to is not None and holder:
        actions.append("release")
    if holder:

        def moves(action: rules.GroceryAction) -> bool:
            return rules.next_status(status, action, _STAFF) is not None

        if moves(rules.GroceryAction.CONFIRM):
            actions.append("confirm")
        if status in rules.RECONFIRM_STATUSES:
            actions.append("reconfirm")
        if status in rules.REDUCE_STATUSES:
            actions.append("reduce_amount")
        if moves(rules.GroceryAction.START_PREPARING):
            actions.append("start_preparing")
        if moves(rules.GroceryAction.DISPATCH):
            actions.append("dispatch")
        if moves(rules.GroceryAction.DELIVERY_FAILED):
            actions.append("delivery_failed")
        if moves(rules.GroceryAction.COMPLETE):
            actions.append("complete")
        if moves(rules.GroceryAction.CANCEL) and (
            principal.is_super_admin or status not in rules.AFTER_PROCUREMENT
        ):
            actions.append("cancel")
    actions.append("record_issue")
    return actions


def _attempts(
    history: list[GroceryOrderStatusHistory],
    member: Callable[[uuid.UUID], GroceryStaffMemberRef],
) -> list[GroceryDeliveryAttemptRead]:
    """The delivery attempts, read from the immutable status history: each move to
    ``out_for_delivery`` begins one; the next move out of it decides it."""
    attempts: list[GroceryDeliveryAttemptRead] = []
    for row in history:
        if row.to_status is GroceryOrderStatus.OUT_FOR_DELIVERY:
            attempts.append(
                GroceryDeliveryAttemptRead(
                    attempt=len(attempts) + 1,
                    dispatched_by=member(row.actor_user_id),
                    dispatched_at=row.created_at,
                    note=row.reason,
                    outcome="in_progress",
                )
            )
        elif row.from_status is GroceryOrderStatus.OUT_FOR_DELIVERY and attempts:
            failed = row.to_status is GroceryOrderStatus.PREPARING
            attempts[-1] = attempts[-1].model_copy(
                update={
                    "outcome": "failed" if failed else "delivered",
                    "outcome_by": member(row.actor_user_id),
                    "outcome_at": row.created_at,
                    "failure_reason": row.reason if failed else None,
                }
            )
    return attempts


def _summary_fields(row: QueueRow) -> dict[str, object]:
    order = row.order
    return {
        "id": order.id,
        "reference": order.reference,
        "status": order.status,
        "revision": order.revision,
        "submitted_at": order.submitted_at,
        "service_date": order.service_date,
        "block": order.block,
        "item_count": row.item_count,
        "assignee": None
        if order.assigned_to is None
        else GroceryStaffMemberRef(user_id=order.assigned_to, display_name=row.assignee_name),
        "agreed_total_paisa": order.agreed_total_paisa,
        "final_amount_due_paisa": order.final_due_paisa,
        "payment_collected": row.payment_collected,
        "failed_delivery_attempts": row.failed_delivery_attempts,
        "issue_count": row.issue_count,
    }
