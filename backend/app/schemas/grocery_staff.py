"""Schemas of the Grocery STAFF API (GROCERY-2; docs/backend/API_CONTRACT.md §19).

Requests are strict: an undeclared key — ``status``, ``total``, ``assignedTo``, ``collectedAt`` … —
is ``422 not_allowed``. The actor is always the session user; statuses, totals and times are the
server's. Money is an integer number of paisa: a float, a string or a boolean is refused.

Nothing here is ever served to a customer. The queue summary carries no name, phone, address or
item text; only the one-order detail does.
"""

import datetime
import uuid
from typing import Annotated, Any, Literal

from pydantic import (
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError
from pydantic_core.core_schema import ValidationInfo

from app.models.enums import (
    GroceryConfirmationMethod,
    GroceryEventAction,
    GroceryIssueKind,
    GroceryOrderStatus,
    GroceryPaymentMethod,
    GroceryRefundMethod,
)
from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.grocery import GroceryDeliveryRead, GroceryItemRead, Revision
from app.schemas.write import StrictRequest, printable
from app.services import grocery_rules as rules

ShortNote = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), printable(False)
]
RequiredReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), printable(False)
]
LongNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), printable(True)]
RequiredNote = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500), printable(True)
]

PositivePaisa = Annotated[StrictInt, Field(ge=1, le=rules.MAX_AMOUNT_PAISA)]
FeePaisa = Annotated[StrictInt, Field(ge=0, le=rules.MAX_AMOUNT_PAISA)]


def _blank_is_none(value: str | None) -> str | None:
    return value or None


# ------------------------------------------------------------------------------ requests


class GroceryRevisionRequest(StrictRequest):
    #: The revision the staff member was looking at.
    revision: Revision


class GroceryAgreementRequest(StrictRequest):
    """The customer's agreement as a staff member RECORDS it, after speaking with them."""

    revision: Revision
    items_subtotal_paisa: PositivePaisa
    service_fee_paisa: FeePaisa = 0
    delivery_fee_paisa: FeePaisa = 0
    #: The total the customer agreed to. It must equal what the server computes from the parts.
    agreed_total_paisa: PositivePaisa
    #: Must be ``true``: "the customer explicitly agreed to these items and this total".
    customer_agreed: StrictBool
    method: GroceryConfirmationMethod
    #: Required, with no default: did the customer accept any substitute? Declared BEFORE the
    #: note, whose rule depends on it.
    substitutions_agreed: StrictBool
    #: INTERNAL.
    pricing_note: ShortNote | None = None
    #: INTERNAL: what the customer accepted. Required when substitutions were agreed.
    consent_note: LongNote | None = None

    _optional = field_validator("pricing_note")(_blank_is_none)

    @model_validator(mode="before")
    @classmethod
    def _judge_an_absent_note(cls, data: Any) -> Any:
        """A declared substitution with NO note must reach the check below. Checking a default
        would name the field ``consent_note``; an explicit null is reported as ``consentNote``.
        (Where the note is required anyway, its absence stays ``required``.)"""
        if (
            isinstance(data, dict)
            and data.get("substitutionsAgreed") is True
            and "consentNote" not in data
            and not cls.model_fields["consent_note"].is_required()
        ):
            return {**data, "consentNote": None}
        return data

    @field_validator("consent_note")
    @classmethod
    def _substitutions_need_a_note(cls, value: str | None, info: ValidationInfo) -> str | None:
        if not value and info.data.get("substitutions_agreed"):
            raise PydanticCustomError(
                "substitution_note_required", "Say which substitutions the customer agreed to."
            )
        return value or None

    @field_validator("customer_agreed")
    @classmethod
    def _must_agree(cls, value: bool) -> bool:
        if value is not True:
            raise PydanticCustomError(
                "agreement_required", "Record the agreement only after the customer has agreed."
            )
        return value


class GroceryReagreementRequest(GroceryAgreementRequest):
    """A NEW agreement after the first. It must say WHAT the customer newly agreed to: the amounts
    alone cannot show an approved substitution (the total may not even change)."""

    #: INTERNAL and required: the substitution and / or price change the customer accepted.
    consent_note: RequiredNote


class GroceryReduceAmountRequest(StrictRequest):
    revision: Revision
    final_amount_paisa: PositivePaisa
    reason: RequiredReason


class GroceryDispatchRequest(StrictRequest):
    revision: Revision
    #: INTERNAL: e.g. who is carrying the order.
    note: ShortNote | None = None

    _optional = field_validator("note")(_blank_is_none)


class GroceryDeliveryFailedRequest(StrictRequest):
    revision: Revision
    reason: RequiredReason


class GroceryCompleteRequest(StrictRequest):
    revision: Revision
    #: The cash actually received: required for an unpaid order, equal to the amount due. Left
    #: out for an order already paid, so nothing is collected twice.
    amount_collected_paisa: PositivePaisa | None = None


def _checked_reference(value: str) -> str:
    """Normalized, and refused if it could be a card or account number. The message never
    repeats what was sent."""
    reference = rules.normalize_reference(value)
    problem = rules.reference_problem(reference)
    if problem is not None:
        raise PydanticCustomError(*problem)
    return reference


TransactionReference = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]


class GroceryRecordPaymentRequest(StrictRequest):
    """A card or external payment a staff member has VERIFIED (money received, or approved on
    the business's card machine). A customer's word alone is never recorded."""

    revision: Revision
    method: GroceryPaymentMethod
    #: The money received: exactly the amount due.
    amount_paisa: PositivePaisa
    reference: TransactionReference
    #: Must be ``true``: "I checked that this money was received".
    money_verified: StrictBool

    _reference = field_validator("reference")(_checked_reference)

    @field_validator("method")
    @classmethod
    def _not_cash(cls, value: GroceryPaymentMethod) -> GroceryPaymentMethod:
        if value not in rules.RECORDABLE_METHODS:
            raise PydanticCustomError("cash_at_delivery", "Cash is recorded with the delivery.")
        return value

    @field_validator("money_verified")
    @classmethod
    def _must_be_verified(cls, value: bool) -> bool:
        if value is not True:
            raise PydanticCustomError(
                "verification_required", "Record a payment only after checking it was received."
            )
        return value


class GroceryRefundRequest(StrictRequest):
    """A Super Admin's record that the WHOLE payment has already been returned outside the
    application. The application returns no money itself."""

    revision: Revision
    #: Must equal the payment: partial refunds are not supported.
    amount_paisa: PositivePaisa
    #: How the money went back. Declared before ``reference``, whose rule depends on it.
    method: GroceryRefundMethod
    #: Required unless returned in cash.
    reference: TransactionReference | None = None
    #: INTERNAL.
    reason: RequiredReason
    #: Must be ``true``: "the money has been returned".
    money_returned: StrictBool
    #: Required (``true``) when this cancels an order that is being prepared.
    procurement_acknowledged: StrictBool = False

    @model_validator(mode="before")
    @classmethod
    def _judge_an_absent_reference(cls, data: Any) -> Any:
        """So that a missing reference is reported on ``reference``, not on the whole body."""
        if isinstance(data, dict) and data.get("method") != "cash" and "reference" not in data:
            return {**data, "reference": None}
        return data

    @field_validator("reference")
    @classmethod
    def _reference_by_method(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value:
            return _checked_reference(value)
        if info.data.get("method") is not GroceryRefundMethod.CASH:
            raise PydanticCustomError(
                "reference_required", "Give the reference of the money you sent back."
            )
        return None

    @field_validator("money_returned")
    @classmethod
    def _must_be_returned(cls, value: bool) -> bool:
        if value is not True:
            raise PydanticCustomError(
                "return_required", "Record a refund only after the money has been returned."
            )
        return value


class GroceryStaffCancelRequest(StrictRequest):
    revision: Revision
    #: INTERNAL: the customer sees only that the team cancelled the order.
    reason: RequiredReason
    #: Required (``true``) once purchasing may have started.
    procurement_acknowledged: StrictBool = False


class GroceryIssueRequest(StrictRequest):
    kind: GroceryIssueKind
    note: RequiredNote

    @field_validator("kind")
    @classmethod
    def _not_system_only(cls, value: GroceryIssueKind) -> GroceryIssueKind:
        if value is GroceryIssueKind.CANCELLED_AFTER_PROCUREMENT:
            raise PydanticCustomError("system_only", "This kind is recorded by the system.")
        return value


class GroceryQueueQuery(ApiModel):
    status: GroceryOrderStatus | None = None
    #: An order reference or its beginning, with or without ``GRC-``; any case.
    reference: Annotated[str, Field(min_length=3, max_length=16)] | None = None
    #: The Asia/Karachi calendar day of submission.
    submitted_on: datetime.date | None = None
    assigned: Annotated[str, Field(max_length=40)] | None = None
    sort: Literal["oldest", "newest"] = "oldest"
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)


# ------------------------------------------------------------------------------ responses


class GroceryStaffMemberRef(ApiModel):
    user_id: uuid.UUID
    display_name: str | None = None


class GroceryStaffOrderSummary(ApiModel):
    """NO customer identity, phone, address or item text."""

    id: uuid.UUID
    reference: str
    status: GroceryOrderStatus
    revision: int
    submitted_at: datetime.datetime
    service_date: datetime.date
    block: str
    item_count: int
    assignee: GroceryStaffMemberRef | None = None
    agreed_total_paisa: int | None = None
    final_amount_due_paisa: int | None = None
    #: Money is held for this order: paid and not refunded.
    payment_collected: bool
    #: Absent until a price is agreed, and on an order cancelled unpaid.
    payment_status: Literal["unpaid", "paid", "refunded"] | None = None
    failed_delivery_attempts: int
    issue_count: int


class GroceryStaffConfirmationRead(ApiModel):
    sequence: int
    items_subtotal_paisa: int
    service_fee_paisa: int
    delivery_fee_paisa: int
    total_paisa: int
    method: GroceryConfirmationMethod
    substitutions_agreed: bool
    pricing_note: str | None = None
    consent_note: str | None = None
    #: The staff member who RECORDED the customer's agreement. Not a customer's own action.
    recorded_by: GroceryStaffMemberRef
    recorded_at: datetime.datetime


class GroceryStaffPaymentRead(ApiModel):
    method: GroceryPaymentMethod
    amount_due_paisa: int
    amount_collected_paisa: int
    #: The external transaction reference of a non-cash payment. Grocery staff only.
    reference: str | None = None
    #: Who collected the cash or verified the payment, and when.
    collected_by: GroceryStaffMemberRef
    collected_at: datetime.datetime


class GroceryStaffRefundRead(ApiModel):
    amount_paisa: int
    method: GroceryRefundMethod
    reference: str | None = None
    reason: str
    refunded_by: GroceryStaffMemberRef
    refunded_at: datetime.datetime


class GroceryDeliveryAttemptRead(ApiModel):
    attempt: int
    dispatched_by: GroceryStaffMemberRef
    dispatched_at: datetime.datetime
    note: str | None = None
    outcome: Literal["in_progress", "failed", "delivered"]
    outcome_by: GroceryStaffMemberRef | None = None
    outcome_at: datetime.datetime | None = None
    failure_reason: str | None = None


class GroceryStaffHistoryRead(ApiModel):
    from_status: GroceryOrderStatus | None = None
    to_status: GroceryOrderStatus
    actor_role: Literal["customer", "staff"]
    #: Absent for the customer's own rows: staff see a customer's capacity, not their account.
    actor: GroceryStaffMemberRef | None = None
    reason: str | None = None
    created_at: datetime.datetime


class GroceryStaffEventRead(ApiModel):
    action: GroceryEventAction
    actor: GroceryStaffMemberRef
    subject: GroceryStaffMemberRef | None = None
    amount_before_paisa: int | None = None
    amount_after_paisa: int | None = None
    issue_kind: GroceryIssueKind | None = None
    note: str | None = None
    created_at: datetime.datetime


GroceryStaffAction = Literal[
    "claim",
    "release",
    "confirm",
    "reconfirm",
    "reduce_amount",
    "start_preparing",
    "dispatch",
    "delivery_failed",
    "complete",
    "cancel",
    "record_payment",
    "record_refund",
    "record_issue",
]


class GroceryStaffOrderDetail(GroceryStaffOrderSummary):
    items: list[GroceryItemRead]
    delivery: GroceryDeliveryRead
    instructions: str | None = None
    cancelled_at: datetime.datetime | None = None
    delivered_at: datetime.datetime | None = None
    confirmations: list[GroceryStaffConfirmationRead]
    payment: GroceryStaffPaymentRead | None = None
    refund: GroceryStaffRefundRead | None = None
    #: The non-cash methods switched on now, for recording a payment. Empty once paid.
    recordable_methods: list[GroceryPaymentMethod]
    delivery_attempts: list[GroceryDeliveryAttemptRead]
    history: list[GroceryStaffHistoryRead]
    events: list[GroceryStaffEventRead]
    #: What this staff member could do now (a hint; the server decides again on the request).
    available_actions: list[GroceryStaffAction]
    updated_at: datetime.datetime


class GroceryStaffOrderEnvelope(ApiModel):
    data: GroceryStaffOrderDetail


class GroceryQueueMeta(PageMeta):
    #: Orders per status under the other filters.
    counts: dict[str, int]


class GroceryStaffOrdersEnvelope(ApiModel):
    data: list[GroceryStaffOrderSummary]
    meta: GroceryQueueMeta
