"""Grocery orders for the CUSTOMER: availability, submit, history, detail and cancel
(GROCERY-1b, extended by GROCERY-2; docs/backend/API_CONTRACT.md §18 and §19).

The customer is always the session user; no method takes an owner id from a request. Staff work
on orders through ``grocery_staff_orders``, never through this service.

SUBMIT is one transaction, and its order matters:

1. the requester's advisory lock (one customer's submissions run one at a time);
2. the account and session, re-read and locked (a suspension or revocation that committed is seen;
   one that has not waits);
3. **the idempotency key, before any business rule**: a stored key returns its order (same
   payload) or ``409`` (different payload), even if ordering is now off, closed or full — a retry
   never creates a second order and never takes a second place;
4. the submission rate limits;
5. the settings, under the shared settings lock (a change either finished before, or waits);
   the time is read AFTER the locks, so a request that waited past closing is refused;
6. enabled and a service area → opening hours → line limit and block → active-order limit;
7. one place of the day's capacity (a single guarded UPDATE);
8. the order, its items, its history row and the rate-limit counts.

Any failure rolls all of it back, the capacity place included.
"""

import datetime
import uuid

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.core.rate_limit import GROCERY_SUBMIT_DAY, GROCERY_SUBMIT_HOUR, RateLimiter
from app.db.session import transaction
from app.models import (
    GroceryOrder,
    GroceryOrderItem,
    GroceryOrderStatusHistory,
    GroceryPayment,
    GroceryRefund,
    GrocerySettingsRevision,
)
from app.models.enums import (
    GroceryActorRole,
    GroceryOrderStatus,
    GroceryPaymentMethod,
    GrocerySubstitution,
    UserStatus,
)
from app.repositories.grocery import GroceryRepository
from app.schemas.envelope import PageMeta
from app.schemas.grocery import (
    GroceryAgreementRead,
    GroceryAvailability,
    GroceryCancelRequest,
    GroceryDeliveryRead,
    GroceryHistoryRead,
    GroceryItemRead,
    GroceryLimits,
    GroceryOrderCreate,
    GroceryOrderDetail,
    GroceryOrdersQuery,
    GroceryOrderSummary,
    GroceryPaymentRead,
    GrocerySchedule,
    GroceryUnitRead,
    UnavailableReason,
)
from app.services import grocery_rules as rules
from app.services.auth_sessions import Principal
from app.services.grocery_errors import private_database_errors
from app.services.service_requests import invalid_transition, not_found, parse_id

#: Attempts at an unused random reference before giving up (one is practically always enough).
_REFERENCE_ATTEMPTS = 5


def _refuse(code: ErrorCode, status_code: int) -> AppError:
    return AppError(code, status_code=status_code)


def _validation(problems: list[ErrorDetail]) -> AppError:
    return AppError(ErrorCode.VALIDATION_ERROR, status_code=422, details=problems)


def clock_text(value: datetime.time) -> str:
    return f"{value.hour:02d}:{value.minute:02d}"


def check_idempotency_key(raw: str | None) -> str:
    if raw is None or not raw.strip():
        raise _refuse(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 400)
    if not rules.is_idempotency_key(raw):
        raise _refuse(ErrorCode.IDEMPOTENCY_KEY_INVALID, 400)
    return raw


def _window_open(settings: GrocerySettingsRevision, now: datetime.datetime) -> bool:
    return rules.is_open(
        now,
        operating_days=settings.operating_days,
        opens_at=settings.opens_at,
        closes_at=settings.closes_at,
        timezone=settings.timezone,
    )


class GroceryOrderService:
    def __init__(self, session: Session, *, clock: Clock, limiter: RateLimiter) -> None:
        self._session = session
        self._clock = clock
        self._limiter = limiter
        self._repository = GroceryRepository(session)

    # -- availability ----------------------------------------------------------------------------

    def availability(self) -> GroceryAvailability:
        """Whether a new order would be accepted right now, and what it may contain. A hint: the
        submission decides again, under lock. Fails closed if no settings row exists."""
        settings = self._repository.current_settings()
        if settings is None:
            raise _refuse(ErrorCode.GROCERY_UNAVAILABLE, 503)
        now = self._clock()
        reason: UnavailableReason | None = None
        if not settings.enabled:
            reason = "disabled"
        elif not settings.serviceable_blocks:
            reason = "no_service_area"
        elif not _window_open(settings, now):
            reason = "closed"
        elif (
            self._repository.reserved_on(rules.service_date(now, settings.timezone))
            >= settings.daily_capacity
        ):
            reason = "daily_limit_reached"
        return GroceryAvailability(
            accepting_orders=reason is None,
            unavailable_reason=reason,
            serviceable_blocks=list(settings.serviceable_blocks),
            covers_all_b17=settings.covers_all_b17 and bool(settings.serviceable_blocks),
            payment_methods=rules.ordered_methods(settings.payment_methods),
            schedule=GrocerySchedule(
                timezone=settings.timezone,
                operating_days=list(settings.operating_days),
                opens_at=clock_text(settings.opens_at),
                closes_at=rules.closing_time_text(settings.closes_at),
            ),
            limits=GroceryLimits(
                max_items_per_order=settings.max_items_per_order,
                max_active_orders=settings.max_active_orders_per_customer,
            ),
            units=[
                GroceryUnitRead(
                    unit=unit,
                    minimum=rules.format_quantity(rule.minimum),
                    maximum=rules.format_quantity(rule.maximum),
                    step=rules.format_quantity(rule.step),
                )
                for unit, rule in rules.UNIT_RULES.items()
            ],
            substitution_options=list(GrocerySubstitution),
        )

    # -- submit ----------------------------------------------------------------------------------

    def submit(
        self, principal: Principal, idempotency_key: str | None, payload: GroceryOrderCreate
    ) -> tuple[uuid.UUID, bool]:
        """``(order id, replayed)``. ``replayed`` is true when the key already had this order."""
        key = rules.key_hash(check_idempotency_key(idempotency_key))
        body = rules.payload_hash(payload.canonical())
        customer_id = principal.user_id

        with private_database_errors(), transaction(self._session):
            self._repository.lock_customer(customer_id)
            self._require_live_account(principal)

            existing = self._repository.find_by_key(customer_id, key)
            if existing is not None:
                if existing.request_hash != body:
                    raise _refuse(ErrorCode.IDEMPOTENCY_KEY_REUSED, 409)
                return existing.id, True

            for policy in (GROCERY_SUBMIT_HOUR, GROCERY_SUBMIT_DAY):
                decision = self._limiter.blocked(str(customer_id), policy)
                if not decision.allowed:
                    raise AppError(
                        ErrorCode.RATE_LIMITED,
                        status_code=429,
                        headers={"Retry-After": str(decision.retry_after_seconds)},
                    )

            self._repository.lock_settings_shared()
            settings = self._repository.current_settings()
            now = self._clock()  # after the locks: waiting never extends the opening hours
            if settings is None or not settings.enabled or not settings.serviceable_blocks:
                raise _refuse(ErrorCode.GROCERY_UNAVAILABLE, 503)
            if not _window_open(settings, now):
                raise _refuse(ErrorCode.GROCERY_CLOSED, 409)

            problems: list[ErrorDetail] = []
            if len(payload.items) > settings.max_items_per_order:
                problems.append(
                    ErrorDetail(
                        field="items",
                        code="too_many_items",
                        message=f"An order can have at most {settings.max_items_per_order} items.",
                    )
                )
            block = rules.match_block(payload.delivery.block, settings.serviceable_blocks)
            if block is None:
                problems.append(
                    ErrorDetail(
                        field="delivery.block",
                        code="not_serviceable",
                        message="Grocery delivery is not available in this block.",
                    )
                )
            if problems or block is None:
                raise _validation(problems)

            if (
                self._repository.count_active(customer_id)
                >= settings.max_active_orders_per_customer
            ):
                raise _refuse(ErrorCode.GROCERY_ACTIVE_ORDER_LIMIT, 409)

            day = rules.service_date(now, settings.timezone)
            if not self._repository.reserve_place(day, settings.daily_capacity):
                raise _refuse(ErrorCode.GROCERY_CAPACITY_REACHED, 409)

            order = self._repository.add_order(
                GroceryOrder(
                    reference=self._new_reference(),
                    customer_id=customer_id,
                    status=GroceryOrderStatus.SUBMITTED,
                    contact_name=payload.delivery.contact_name,
                    contact_phone=payload.delivery.contact_phone,
                    block=block,
                    address_line=payload.delivery.address_line,
                    landmark=payload.delivery.landmark,
                    instructions=payload.instructions,
                    service_date=day,
                    submitted_at=now,
                    idempotency_key_hash=key,
                    request_hash=body,
                ),
                [
                    GroceryOrderItem(
                        position=position,
                        name=item.name,
                        quantity=item.amount,
                        unit=item.unit,
                        preferred_brand=item.preferred_brand,
                        substitution=item.substitution,
                        note=item.note,
                    )
                    for position, item in enumerate(payload.items, start=1)
                ],
            )
            self._repository.add_history(
                GroceryOrderStatusHistory(
                    order_id=order.id,
                    from_status=None,
                    to_status=GroceryOrderStatus.SUBMITTED,
                    actor_user_id=customer_id,
                    actor_role=GroceryActorRole.CUSTOMER,
                )
            )
            self._limiter.record(str(customer_id), GROCERY_SUBMIT_HOUR)
            self._limiter.record(str(customer_id), GROCERY_SUBMIT_DAY)
            return order.id, False

    # -- reads -----------------------------------------------------------------------------------

    def list_own(
        self, principal: Principal, query: GroceryOrdersQuery
    ) -> tuple[list[GroceryOrderSummary], PageMeta]:
        total, rows = self._repository.own_page(
            principal.user_id, query.status, query.limit, query.offset
        )
        return (
            [
                GroceryOrderSummary(**_summary_fields(order, count, paid=paid, refunded=refunded))
                for order, count, paid, refunded in rows
            ],
            PageMeta(total=total, limit=query.limit, offset=query.offset),
        )

    def detail(self, principal: Principal, raw_id: str) -> GroceryOrderDetail:
        return self._detail(principal.user_id, parse_id(raw_id))

    def _detail(self, customer_id: uuid.UUID, order_id: uuid.UUID) -> GroceryOrderDetail:
        order = self._repository.own_order(order_id, customer_id)
        if order is None:
            raise not_found()  # missing and someone else's are indistinguishable
        items = self._repository.items_of(order.id)
        history = self._repository.history_of(order.id)
        cancelled_by = next(
            (row.actor_role for row in history if row.to_status is GroceryOrderStatus.CANCELLED),
            None,
        )
        collected = self._repository.payment_of(order.id)
        refund = None if collected is None else self._repository.refund_of(order.id)
        return GroceryOrderDetail(
            **_summary_fields(
                order, len(items), paid=collected is not None, refunded=refund is not None
            ),
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
                for item in items
            ],
            delivery=GroceryDeliveryRead(
                contact_name=order.contact_name,
                contact_phone=order.contact_phone,
                block=order.block,
                address_line=order.address_line,
                landmark=order.landmark,
            ),
            instructions=order.instructions,
            cancel_reason=order.cancel_reason,
            cancelled_by=None if cancelled_by is None else cancelled_by.value,
            agreed_total_paisa=order.agreed_total_paisa,
            agreements=[
                GroceryAgreementRead(
                    sequence=row.sequence,
                    items_subtotal_paisa=row.items_subtotal_paisa,
                    service_fee_paisa=row.service_fee_paisa,
                    delivery_fee_paisa=row.delivery_fee_paisa,
                    total_paisa=row.total_paisa,
                    method=row.method,
                    recorded_by="staff",
                    recorded_at=row.recorded_at,
                )
                for row in self._repository.confirmations_of(order.id)
            ],
            payment=_payment(order, collected, refund),
            can_cancel=rules.next_status(
                order.status, rules.GroceryAction.CANCEL, GroceryActorRole.CUSTOMER
            )
            is not None,
            history=[
                GroceryHistoryRead(
                    from_status=row.from_status,
                    to_status=row.to_status,
                    actor_role=row.actor_role.value,
                    # a staff member's reason or note is internal
                    reason=row.reason if row.actor_role is GroceryActorRole.CUSTOMER else None,
                    created_at=row.created_at,
                )
                for row in history
            ],
            updated_at=order.updated_at,
        )

    # -- cancel ----------------------------------------------------------------------------------

    def cancel(
        self, principal: Principal, raw_id: str, payload: GroceryCancelRequest
    ) -> GroceryOrderDetail:
        """The customer cancels their own order. Allowed whether or not ordering is on or open.
        Order of refusal: not theirs (``404``) → the status does not allow it
        (``409 invalid_state_transition``, so a repeated cancel changes nothing) → a stale
        ``revision`` (``409 order_conflict``)."""
        order_id = parse_id(raw_id)
        customer_id = principal.user_id
        with private_database_errors(), transaction(self._session):
            order = self._repository.own_order(order_id, customer_id, lock=True)
            if order is None:
                raise not_found()
            self._require_live_account(principal)
            current = order.status
            target = rules.next_status(
                current, rules.GroceryAction.CANCEL, GroceryActorRole.CUSTOMER
            )
            if target is None:
                raise invalid_transition()
            if order.revision != payload.revision:
                raise _stale(order.revision)
            if not self._repository.guarded_cancel(
                order_id,
                from_status=current,
                to_status=target,
                revision=payload.revision,
                cancelled_at=self._clock(),
                reason=payload.reason,
            ):  # pragma: no cover - the row lock makes this unreachable; kept as the safety net
                raise _stale(payload.revision)
            self._repository.add_history(
                GroceryOrderStatusHistory(
                    order_id=order_id,
                    from_status=current,
                    to_status=target,
                    actor_user_id=customer_id,
                    actor_role=GroceryActorRole.CUSTOMER,
                    reason=payload.reason,
                )
            )
        return self._detail(customer_id, order_id)

    # -- internals -------------------------------------------------------------------------------

    def _require_live_account(self, principal: Principal) -> None:
        """The request was authenticated before this transaction began. Decide again, under
        lock, that the account is still active and verified and the session still valid."""
        state = self._repository.lock_account(principal.user_id, principal.session_id)
        now = self._clock()
        if (
            state is None
            or state.status is not UserStatus.ACTIVE
            or state.session_revoked
            or now >= state.session_expires_at
            or now >= state.session_absolute_expires_at
        ):
            raise AppError(ErrorCode.SESSION_EXPIRED, status_code=401)
        if not state.email_verified:
            raise AppError(ErrorCode.EMAIL_NOT_VERIFIED, status_code=403)

    def _new_reference(self) -> str:
        for _ in range(_REFERENCE_ATTEMPTS):
            reference = rules.new_reference()
            if not self._repository.reference_taken(reference):
                return reference
        raise RuntimeError("no free grocery order reference")  # pragma: no cover - 31**8 values


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


def _payment(
    order: GroceryOrder, collected: GroceryPayment | None, refund: GroceryRefund | None
) -> GroceryPaymentRead | None:
    """A recorded payment is always shown, a cancelled order's refunded one included. Without
    one, something is owed only on an open or delivered order with an agreed price."""
    if collected is None:
        if order.final_due_paisa is None or order.status is GroceryOrderStatus.CANCELLED:
            return None
        return GroceryPaymentRead(
            method=GroceryPaymentMethod.CASH_ON_DELIVERY,
            status="due",
            amount_due_paisa=order.final_due_paisa,
        )
    return GroceryPaymentRead(
        method=collected.method,
        status="collected" if refund is None else "refunded",
        amount_due_paisa=collected.amount_due_paisa,
        amount_collected_paisa=collected.amount_collected_paisa,
        collected_at=collected.collected_at,
        refunded_amount_paisa=None if refund is None else refund.amount_paisa,
        refunded_at=None if refund is None else refund.refunded_at,
    )


def _summary_fields(
    order: GroceryOrder, item_count: int, *, paid: bool, refunded: bool
) -> dict[str, object]:
    return {
        "id": order.id,
        "reference": order.reference,
        "status": order.status,
        "revision": order.revision,
        "item_count": item_count,
        "block": order.block,
        "submitted_at": order.submitted_at,
        "cancelled_at": order.cancelled_at,
        "final_amount_due_paisa": order.final_due_paisa,
        "delivered_at": order.delivered_at,
        "payment_status": rules.payment_status(
            order.status, order.final_due_paisa, paid=paid, refunded=refunded
        ),
    }
