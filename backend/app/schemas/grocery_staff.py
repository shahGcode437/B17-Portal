"""Schemas of the Grocery STAFF API (GROCERY-2; docs/backend/API_CONTRACT.md §19).

Requests are strict: an undeclared key — ``status``, ``total``, ``assignedTo``, ``collectedAt`` … —
is ``422 not_allowed``. The actor is always the session user; statuses, totals and times are the
server's. Money is an integer number of paisa: a float, a string or a boolean is refused.

Nothing here is ever served to a customer. The queue summary carries no name, phone, address or
item text; only the one-order detail does.
"""

import datetime
import uuid
from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.models.enums import (
    GroceryConfirmationMethod,
    GroceryEventAction,
    GroceryIssueKind,
    GroceryOrderStatus,
    GroceryPaymentMethod,
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
    #: INTERNAL.
    pricing_note: ShortNote | None = None
    #: INTERNAL: e.g. the substitutions the customer accepted.
    consent_note: LongNote | None = None

    _optional = field_validator("pricing_note", "consent_note")(_blank_is_none)

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
    #: The cash actually received. It must equal the amount due.
    amount_collected_paisa: PositivePaisa


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
    payment_collected: bool
    failed_delivery_attempts: int
    issue_count: int


class GroceryStaffConfirmationRead(ApiModel):
    sequence: int
    items_subtotal_paisa: int
    service_fee_paisa: int
    delivery_fee_paisa: int
    total_paisa: int
    method: GroceryConfirmationMethod
    pricing_note: str | None = None
    consent_note: str | None = None
    #: The staff member who RECORDED the customer's agreement. Not a customer's own action.
    recorded_by: GroceryStaffMemberRef
    recorded_at: datetime.datetime


class GroceryStaffPaymentRead(ApiModel):
    method: GroceryPaymentMethod
    amount_due_paisa: int
    amount_collected_paisa: int
    collected_by: GroceryStaffMemberRef
    collected_at: datetime.datetime


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
