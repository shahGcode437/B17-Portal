"""Pure Grocery order-intake rules (GROCERY-1b; docs/backend/API_CONTRACT.md §18,
DATA_MODEL.md §21).

Nothing here touches the database, the web layer or the clock (the caller passes "now"), so every
rule is unit-testable and the services, the schemas and the tests cannot disagree.

* **Lifecycle.** One table of allowed transitions. Anything not listed is refused.
* **Quantities** are exact ``Decimal`` values with a per-unit minimum, maximum and step. They are
  never parsed from, or turned into, a binary floating-point number.
* **Operating window.** Opening time inclusive, closing time exclusive, judged on the calendar and
  clock of the configured time zone — never the server's.
* **Idempotency.** The key and the validated payload are stored only as SHA-256 hashes. The payload
  hash depends on the payload ALONE, never on current settings, so a retry still matches after the
  configuration changes.
"""

import datetime
import hashlib
import json
import re
import secrets
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from zoneinfo import ZoneInfo

from app.models.enums import GroceryActorRole, GroceryOrderStatus, GroceryUnit

# ------------------------------------------------------------------------------ lifecycle

#: A terminal order never changes again. ``delivered`` joins this set when delivery exists.
TERMINAL_STATUSES: frozenset[GroceryOrderStatus] = frozenset({GroceryOrderStatus.CANCELLED})
#: "Active" is every non-terminal order — the set the per-customer limit counts. A new status is
#: active unless it is deliberately made terminal.
ACTIVE_STATUSES: frozenset[GroceryOrderStatus] = frozenset(GroceryOrderStatus) - TERMINAL_STATUSES


class GroceryAction(StrEnum):
    CANCEL = "cancel"


#: (current status, action, who acts) -> new status. The COMPLETE list of allowed transitions.
TRANSITIONS: Mapping[
    tuple[GroceryOrderStatus, GroceryAction, GroceryActorRole], GroceryOrderStatus
] = {
    (
        GroceryOrderStatus.SUBMITTED,
        GroceryAction.CANCEL,
        GroceryActorRole.CUSTOMER,
    ): GroceryOrderStatus.CANCELLED,
}


def next_status(
    current: GroceryOrderStatus, action: GroceryAction, actor: GroceryActorRole
) -> GroceryOrderStatus | None:
    """The status ``action`` leads to, or ``None`` if it is not allowed."""
    return TRANSITIONS.get((current, action, actor))


# ------------------------------------------------------------------------------ quantities


@dataclass(frozen=True)
class UnitRule:
    minimum: Decimal
    maximum: Decimal
    #: A quantity must be a whole multiple of this.
    step: Decimal


def _rule(minimum: str, maximum: str, step: str) -> UnitRule:
    return UnitRule(Decimal(minimum), Decimal(maximum), Decimal(step))


#: Conservative per-line bounds for a household order (pilot defaults).
UNIT_RULES: Mapping[GroceryUnit, UnitRule] = {
    GroceryUnit.KG: _rule("0.05", "50", "0.001"),
    GroceryUnit.GRAM: _rule("1", "5000", "1"),
    GroceryUnit.LITRE: _rule("0.1", "50", "0.001"),
    GroceryUnit.ML: _rule("1", "5000", "1"),
    GroceryUnit.PIECE: _rule("1", "100", "1"),
    GroceryUnit.PACK: _rule("1", "50", "1"),
    GroceryUnit.DOZEN: _rule("0.5", "20", "0.5"),
}
#: Units counted in whole numbers (the database CHECK says the same).
WHOLE_UNITS: frozenset[GroceryUnit] = frozenset(
    unit for unit, rule in UNIT_RULES.items() if rule.step == 1
)
#: The largest quantity any unit allows: the database's backstop.
MAX_ANY_QUANTITY = max(rule.maximum for rule in UNIT_RULES.values())

#: A plain non-negative decimal with at most three places: no sign, exponent, "NaN", "Infinity",
#: thousands separator or surrounding space.
_QUANTITY_TEXT = re.compile(r"(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?")


def parse_quantity(text: str) -> Decimal | None:
    """``text`` as an exact ``Decimal`` greater than zero, or ``None``."""
    if not _QUANTITY_TEXT.fullmatch(text):
        return None
    value = Decimal(text)
    return value if value > 0 else None


def quantity_problem(unit: GroceryUnit, quantity: Decimal) -> tuple[str, str] | None:
    """``(code, message)`` if ``quantity`` is not allowed for ``unit``, else ``None``."""
    rule = UNIT_RULES[unit]
    if quantity < rule.minimum:
        return "quantity_too_small", f"Use at least {format_quantity(rule.minimum)} {unit.value}."
    if quantity > rule.maximum:
        return "quantity_too_large", f"Use at most {format_quantity(rule.maximum)} {unit.value}."
    if quantity % rule.step != 0:
        return (
            "quantity_precision",
            f"Use steps of {format_quantity(rule.step)} {unit.value}.",
        )
    return None


def format_quantity(quantity: Decimal) -> str:
    """The canonical text of a quantity: no exponent, no trailing zeros (``2.500`` -> ``2.5``)."""
    text = format(quantity, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


# ------------------------------------------------------------------------------ operating window

#: The time zones the settings accept. Adding one is a reviewed change (and a CHECK migration).
ALLOWED_TIMEZONES: tuple[str, ...] = ("Asia/Karachi",)


def local_moment(now: datetime.datetime, timezone: str) -> datetime.datetime:
    """``now`` (timezone-aware) on the clock of ``timezone``."""
    if now.tzinfo is None:
        raise ValueError("the current time must be timezone-aware")
    return now.astimezone(ZoneInfo(timezone))


def service_date(now: datetime.datetime, timezone: str) -> datetime.date:
    """The calendar day an order submitted at ``now`` counts against."""
    return local_moment(now, timezone).date()


def is_open(
    now: datetime.datetime,
    *,
    operating_days: Collection[int],
    opens_at: datetime.time,
    closes_at: datetime.time,
    timezone: str,
) -> bool:
    """Whether new submissions are accepted at ``now``: an operating ISO weekday (1 = Monday), from
    the opening time INCLUDED until the closing time EXCLUDED."""
    local = local_moment(now, timezone)
    return local.isoweekday() in operating_days and opens_at <= local.time() < closes_at


# ------------------------------------------------------------------------------ service blocks

MAX_BLOCK_LENGTH = 40
MAX_SERVICEABLE_BLOCKS = 100
#: The same characters a listing's ``block`` may use (LOCATION_MAP.md §5).
_BLOCK_EXTRA = frozenset(" -/.")


def collapse_spaces(value: str) -> str:
    return " ".join(value.split())


def is_block_label(value: str) -> bool:
    return (
        0 < len(value) <= MAX_BLOCK_LENGTH
        and value[:1].isalnum()
        and all(c.isalnum() or c in _BLOCK_EXTRA for c in value)
    )


def block_key(value: str) -> str:
    """How two spellings of a block are compared: spaces collapsed, case ignored. Nothing else is
    guessed — "C" and "Block C" are different labels."""
    return collapse_spaces(value).casefold()


def match_block(requested: str, configured: Sequence[str]) -> str | None:
    """The CONFIGURED spelling of ``requested``, or ``None`` if it is not serviceable. With no
    configured block, nothing is serviceable."""
    wanted = block_key(requested)
    return next((block for block in configured if block_key(block) == wanted), None)


# ------------------------------------------------------------------------------ references

#: No 0/O, 1/I/L: a reference is read out over the telephone.
REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
REFERENCE_PREFIX = "GRC-"
REFERENCE_LENGTH = 8


def new_reference() -> str:
    """A random, NON-sequential order reference: it reveals neither order volume nor order."""
    return REFERENCE_PREFIX + "".join(
        secrets.choice(REFERENCE_ALPHABET) for _ in range(REFERENCE_LENGTH)
    )


# ------------------------------------------------------------------------------ idempotency

_IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9._:-]{8,128}")


def is_idempotency_key(value: str) -> bool:
    return _IDEMPOTENCY_KEY.fullmatch(value) is not None


def key_hash(key: str) -> bytes:
    return hashlib.sha256(key.encode("utf-8")).digest()


def payload_hash(canonical: Mapping[str, object]) -> bytes:
    """SHA-256 of one canonical JSON form of a validated order payload."""
    text = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).digest()
