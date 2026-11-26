"""Grocery order-intake schemas (GROCERY-1b; docs/backend/API_CONTRACT.md §18).

Requests are strict (``StrictRequest``): an undeclared key — ``customerId``, ``status``,
``reference``, ``submittedAt``, ``serviceDate``, ``price``, ``total`` … — is ``422 not_allowed``.
The customer is always the session user; every status, timestamp and reference is the server's.

Everything checked HERE is independent of the stored settings (shape, text bounds, units,
quantities, the phone number). What depends on the settings — enabled, opening hours, the
serviceable blocks, the configured line limit, capacity — is the service's, checked AFTER an
idempotency key is looked up, so a retry still finds its order after the settings change.

No error message repeats what the client sent. Responses are explicit field lists; there is no
price, supplier or payment field, because none exists yet.
"""

import datetime
import re
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, StrictStr, StringConstraints, field_validator
from pydantic_core import PydanticCustomError
from pydantic_core.core_schema import ValidationInfo

from app.core.phone import MAX_RAW_LENGTH, normalize_phone
from app.models.enums import GroceryOrderStatus, GrocerySubstitution, GroceryUnit
from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.write import MAX_REVISION, StrictRequest, printable
from app.services import grocery_rules as rules

#: No settings value may allow more lines than this in one request.
ABSOLUTE_MAX_ITEMS = 100

_CLOCK = re.compile(r"([01][0-9]|2[0-3]):[0-5][0-9]")

ItemName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80), printable(False)
]
BrandText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=60), printable(False)
]
ItemNote = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), printable(False)
]
ContactName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80), printable(False)
]
BlockText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40), printable(False)
]
AddressLine = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=5, max_length=200), printable(False)
]
LandmarkText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=100), printable(False)
]
Instructions = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=500), printable(True)
]
CancelReason = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), printable(False)
]
Revision = Annotated[StrictInt, Field(ge=1, le=MAX_REVISION)]


def _invalid(code: str, message: str) -> PydanticCustomError:
    return PydanticCustomError(code, message)


def _blank_is_none(value: str | None) -> str | None:
    return value or None


# ------------------------------------------------------------------------------ order requests


class GroceryItemInput(StrictRequest):
    name: ItemName
    #: Declared BEFORE ``quantity``: the quantity is judged against its unit.
    unit: GroceryUnit
    #: A STRING ("1.5"), never a JSON number: no binary floating point anywhere.
    quantity: Annotated[str, StringConstraints(max_length=12)]
    preferred_brand: BrandText | None = None
    substitution: GrocerySubstitution = GrocerySubstitution.ASK
    note: ItemNote | None = None

    _optional = field_validator("preferred_brand", "note")(_blank_is_none)

    @field_validator("quantity")
    @classmethod
    def _exact_quantity(cls, value: str, info: ValidationInfo) -> str:
        quantity = rules.parse_quantity(value)
        if quantity is None:
            raise _invalid(
                "invalid_quantity",
                'Write a quantity above zero as digits with at most three decimals, like "1.5".',
            )
        unit = info.data.get("unit")
        if unit is not None:  # an invalid unit is reported on its own field
            problem = rules.quantity_problem(unit, quantity)
            if problem is not None:
                raise _invalid(*problem)
        return rules.format_quantity(quantity)

    @property
    def amount(self) -> Decimal:
        return Decimal(self.quantity)


class GroceryDeliveryInput(StrictRequest):
    contact_name: ContactName
    #: A Pakistani number in any common spelling; stored as E.164 (``+92…``).
    contact_phone: Annotated[str, StringConstraints(max_length=MAX_RAW_LENGTH)]
    block: BlockText
    address_line: AddressLine
    landmark: LandmarkText | None = None

    _optional = field_validator("landmark")(_blank_is_none)

    @field_validator("contact_phone")
    @classmethod
    def _pakistani_number(cls, value: str) -> str:
        normalized = normalize_phone(value)
        if normalized is None or not normalized.startswith("+92"):
            raise _invalid("invalid_phone", "Enter a valid Pakistani phone number.")
        return normalized

    @field_validator("block")
    @classmethod
    def _block_label(cls, value: str) -> str:
        if not rules.is_block_label(value):
            raise _invalid("invalid_block", "Use letters, numbers, spaces, -, / or . only.")
        return value


class GroceryOrderCreate(StrictRequest):
    items: Annotated[list[GroceryItemInput], Field(min_length=1, max_length=ABSOLUTE_MAX_ITEMS)]
    delivery: GroceryDeliveryInput
    instructions: Instructions | None = None

    _optional = field_validator("instructions")(_blank_is_none)

    def canonical(self) -> dict[str, object]:
        """The one form of the validated payload that an idempotency key is bound to. It depends
        on the payload alone: the block is compared by its key, never by the configured spelling."""
        return {
            "v": 1,
            "items": [
                {
                    "name": item.name,
                    "unit": item.unit.value,
                    "quantity": item.quantity,
                    "preferredBrand": item.preferred_brand,
                    "substitution": item.substitution.value,
                    "note": item.note,
                }
                for item in self.items
            ],
            "delivery": {
                "contactName": self.delivery.contact_name,
                "contactPhone": self.delivery.contact_phone,
                "block": rules.block_key(self.delivery.block),
                "addressLine": self.delivery.address_line,
                "landmark": self.delivery.landmark,
            },
            "instructions": self.instructions,
        }


class GroceryCancelRequest(StrictRequest):
    #: The revision the customer was looking at.
    revision: Revision
    reason: CancelReason | None = None

    _optional = field_validator("reason")(_blank_is_none)


class GroceryOrdersQuery(ApiModel):
    status: GroceryOrderStatus | None = None
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)


# ------------------------------------------------------------------------------ settings request


class GrocerySettingsPatch(StrictRequest):
    """``revision`` is the version the Super Admin read. Every other field: omitted = unchanged;
    ``null`` is refused; the block list and the days replace whole."""

    revision: Revision
    enabled: StrictBool | None = None
    serviceable_blocks: (
        Annotated[list[StrictStr], Field(max_length=rules.MAX_SERVICEABLE_BLOCKS)] | None
    ) = None
    operating_days: Annotated[list[StrictInt], Field(min_length=1, max_length=7)] | None = None
    opens_at: StrictStr | None = None
    closes_at: StrictStr | None = None
    timezone: StrictStr | None = None
    daily_capacity: Annotated[StrictInt, Field(ge=1, le=200)] | None = None
    max_active_orders_per_customer: Annotated[StrictInt, Field(ge=1, le=10)] | None = None
    max_items_per_order: Annotated[StrictInt, Field(ge=1, le=ABSOLUTE_MAX_ITEMS)] | None = None

    @field_validator(
        "enabled",
        "serviceable_blocks",
        "operating_days",
        "opens_at",
        "closes_at",
        "timezone",
        "daily_capacity",
        "max_active_orders_per_customer",
        "max_items_per_order",
        mode="before",
    )
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise _invalid("not_nullable", "Leave the field out to keep it unchanged.")
        return value

    @field_validator("serviceable_blocks")
    @classmethod
    def _blocks(cls, value: list[str]) -> list[str]:
        blocks = [rules.collapse_spaces(block) for block in value]
        if not all(rules.is_block_label(block) for block in blocks):
            raise _invalid(
                "invalid_block",
                "Each block is 1 to 40 letters, numbers, spaces, -, / or . and starts with a "
                "letter or number.",
            )
        if len({rules.block_key(block) for block in blocks}) != len(blocks):
            raise _invalid("duplicate_block", "A block is listed more than once.")
        return blocks

    @field_validator("operating_days")
    @classmethod
    def _days(cls, value: list[int]) -> list[int]:
        if any(day < 1 or day > 7 for day in value) or len(set(value)) != len(value):
            raise _invalid("invalid_days", "Use each weekday number from 1 (Monday) to 7 once.")
        return sorted(value)

    @field_validator("opens_at", "closes_at")
    @classmethod
    def _clock_time(cls, value: str) -> str:
        if not _CLOCK.fullmatch(value):
            raise _invalid("invalid_time", "Use a 24-hour time written as HH:MM.")
        return value

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, value: str) -> str:
        if value not in rules.ALLOWED_TIMEZONES:
            raise _invalid("unsupported_timezone", "This time zone is not supported.")
        return value


# ------------------------------------------------------------------------------ responses


class GroceryItemRead(ApiModel):
    position: int
    name: str
    unit: GroceryUnit
    quantity: str
    preferred_brand: str | None = None
    substitution: GrocerySubstitution
    note: str | None = None


class GroceryDeliveryRead(ApiModel):
    """PRIVATE: served only to the order's own customer."""

    contact_name: str
    contact_phone: str
    block: str
    address_line: str
    landmark: str | None = None


class GroceryHistoryRead(ApiModel):
    from_status: GroceryOrderStatus | None = None
    to_status: GroceryOrderStatus
    #: In which capacity, never who: no user id or name.
    actor_role: Literal["customer"]
    reason: str | None = None
    created_at: datetime.datetime


class GroceryOrderSummary(ApiModel):
    id: uuid.UUID
    reference: str
    status: GroceryOrderStatus
    revision: int
    item_count: int
    block: str
    submitted_at: datetime.datetime
    cancelled_at: datetime.datetime | None = None


class GroceryOrderDetail(GroceryOrderSummary):
    items: list[GroceryItemRead]
    delivery: GroceryDeliveryRead
    instructions: str | None = None
    cancel_reason: str | None = None
    #: Whether the customer may cancel it now (a hint; the server decides again on the request).
    can_cancel: bool
    history: list[GroceryHistoryRead]
    updated_at: datetime.datetime


class GroceryOrderEnvelope(ApiModel):
    data: GroceryOrderDetail


class GroceryOrdersEnvelope(ApiModel):
    data: list[GroceryOrderSummary]
    meta: PageMeta


class GrocerySchedule(ApiModel):
    timezone: str
    operating_days: list[int]
    #: Orders are accepted from ``opensAt`` (included) until ``closesAt`` (excluded).
    opens_at: str
    closes_at: str


class GroceryUnitRead(ApiModel):
    unit: GroceryUnit
    minimum: str
    maximum: str
    step: str


class GroceryLimits(ApiModel):
    max_items_per_order: int
    max_active_orders: int


UnavailableReason = Literal["disabled", "no_service_area", "closed", "daily_limit_reached"]


class GroceryAvailability(ApiModel):
    """What a customer needs to fill in an order. No order volume, capacity number or person."""

    accepting_orders: bool
    #: Present only when ``acceptingOrders`` is false.
    unavailable_reason: UnavailableReason | None = None
    serviceable_blocks: list[str]
    schedule: GrocerySchedule
    limits: GroceryLimits
    units: list[GroceryUnitRead]
    substitution_options: list[GrocerySubstitution]


class GroceryAvailabilityEnvelope(ApiModel):
    data: GroceryAvailability


class GrocerySettingsActor(ApiModel):
    user_id: uuid.UUID
    display_name: str | None = None


class GrocerySettingsRead(ApiModel):
    revision: int
    enabled: bool
    serviceable_blocks: list[str]
    operating_days: list[int]
    opens_at: str
    closes_at: str
    timezone: str
    daily_capacity: int
    max_active_orders_per_customer: int
    max_items_per_order: int
    updated_at: datetime.datetime
    #: Absent for the default the migration created.
    updated_by: GrocerySettingsActor | None = None


class GrocerySettingsEnvelope(ApiModel):
    data: GrocerySettingsRead
