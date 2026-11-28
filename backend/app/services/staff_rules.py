"""Pure staff-management rules (RBAC-C; docs/backend/AUTH_RBAC.md §27.2, §27.6, §27.7, §27.14).

Nothing here touches the database, the clock or the web layer, so every rule is unit-testable and
the CLI and the HTTP API cannot disagree about it: both go through ``StaffAuthorityService``, which
calls these.

* **Scopes.** Only the assignable scopes may ever be stored by staff management; ``news`` (reserved)
  and anything unknown is refused, and a set is never empty (an empty set is a *pause*, which has
  its own explicit operation).
* **Hosted identities.** A privileged grant in staging / production refuses fixture, demo and
  reserved-TLD addresses.
* **Super Admin count policy.** Operational target 2, a configurable safety ceiling (default 3);
  nothing here ever limits a demotion or blocks recovery from zero.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum

from app.models.enums import StaffScope
from app.services.moderation_rules import MAX_REJECTION_REASON_LENGTH, normalize_reason
from app.services.staff_scopes import ASSIGNABLE_STAFF_SCOPES

#: The normal operational number of Super Admins (``AUTH_RBAC.md §27.6``). A promotion that would
#: take the usable count ABOVE this needs an explicit override.
NORMAL_SUPER_ADMIN_TARGET = 2
MIN_REASON_CHARS = 10

#: Reserved by RFC 2606 / 6761: never a real mailbox. A hosted privileged grant refuses them.
RESERVED_IDENTITY_TLDS = frozenset({"example", "test", "invalid", "localhost"})
#: The development fixtures' own address domain (``scripts/dev_fixtures.py``); also reserved by
#: its ``.example`` TLD, named here so the intent survives a change of either rule.
FIXTURE_EMAIL_DOMAIN = "fixtures.example"


class StaffCode(StrEnum):
    """The stable ``details[].code`` of every staff-management refusal (never user-supplied)."""

    #: The target is not a Moderator (or does not exist): one answer for both, so a user id is
    #: never an account-existence oracle.
    MODERATOR_NOT_FOUND = "moderator_not_found"
    #: Appointment / resume / promotion target refused: unknown, suspended, unverified or a
    #: fixture / demo / reserved identity in a hosted environment. One answer for all of them.
    TARGET_NOT_ELIGIBLE = "target_not_eligible"
    INVALID_STAFF_SCOPE = "invalid_staff_scope"
    SUPER_ADMIN_TARGET_FORBIDDEN = "super_admin_target_forbidden"
    ALREADY_MODERATOR = "already_moderator"
    MODERATOR_PAUSED = "moderator_paused"
    MODERATOR_NOT_PAUSED = "moderator_not_paused"
    MODERATOR_ALREADY_PAUSED = "moderator_already_paused"
    LAST_SUPER_ADMIN = "last_super_admin"
    #: The account's staff access is not at the revision the change was decided on (§39).
    STAFF_CHANGED = "staff_changed"
    #: The acting Super Admin lost the role between the request and the transaction.
    ACTOR_NOT_AUTHORISED = "forbidden"
    # -- operator CLI only ---------------------------------------------------------------------
    REASON_REQUIRED = "reason_required"
    ACCOUNT_NOT_FOUND = "account_not_found"
    NOT_SUPER_ADMIN = "not_super_admin"
    POLICY_OVERRIDE_REQUIRED = "policy_override_required"
    BREAK_GLASS_REQUIRED = "break_glass_required"


class StaffAuthorityError(Exception):
    """A refusal that changed nothing. ``code`` is stable; ``message`` is safe to show."""

    def __init__(
        self,
        code: StaffCode,
        message: str,
        *,
        field: str | None = None,
        current_revision: int | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.field = field
        #: Set for ``staff_changed`` only: where the account stands now.
        self.current_revision = current_revision
        super().__init__(message)


def validate_scopes(requested: Iterable[StaffScope]) -> frozenset[StaffScope]:
    """The de-duplicated scope set, or ``invalid_staff_scope``.

    Refuses an empty set (that is a pause, not an update) and every non-assignable value —
    ``news`` included, so a reserved scope can never become stored, let alone effective, through
    staff management."""
    scopes = frozenset(requested)
    if not scopes:
        raise StaffAuthorityError(
            StaffCode.INVALID_STAFF_SCOPE,
            "Choose at least one scope. To remove all scopes, pause the moderator instead.",
            field="scopes",
        )
    if not scopes <= ASSIGNABLE_STAFF_SCOPES:
        raise StaffAuthorityError(
            StaffCode.INVALID_STAFF_SCOPE,
            "One of the chosen scopes cannot be assigned.",
            field="scopes",
        )
    return scopes


def is_reserved_identity(email: str) -> bool:
    """A fixture, demo or reserved-TLD address (``@fixtures.example``, ``*.example`` / ``.test`` /
    ``.invalid`` / ``.localhost``). Judged by the address's domain labels, never by a substring."""
    if "@" not in email:
        return True  # not an address at all: fail closed
    domain = email.strip().rsplit("@", 1)[-1].lower().rstrip(".")
    if not domain:
        return True
    return domain == FIXTURE_EMAIL_DOMAIN or domain.rsplit(".", 1)[-1] in RESERVED_IDENTITY_TLDS


def clean_reason(raw: str | None) -> str:
    """The normalised operator reason (required: ``MIN_REASON_CHARS`` .. 500 characters)."""
    text = normalize_reason(raw or "")
    if len(text) < MIN_REASON_CHARS or len(text) > MAX_REJECTION_REASON_LENGTH:
        raise StaffAuthorityError(
            StaffCode.REASON_REQUIRED,
            f"Give a reason of {MIN_REASON_CHARS} to {MAX_REJECTION_REASON_LENGTH} characters.",
            field="reason",
        )
    return text


@dataclass(frozen=True)
class PromotionDecision:
    #: Usable Super Admins once this promotion has happened.
    new_count: int
    #: ``True`` when the count rule needed (and the operator gave) the policy override.
    policy_override_used: bool
    #: ``True`` when break-glass was needed (above the ceiling) or used to recover from zero.
    break_glass_used: bool

    @property
    def above_target(self) -> bool:
        """An operator warning: the count is above the normal target."""
        return self.new_count > NORMAL_SUPER_ADMIN_TARGET


def decide_promotion(
    usable_before: int, *, ceiling: int, override_policy: bool, break_glass: bool
) -> PromotionDecision:
    """The count policy for ONE promotion (``AUTH_RBAC.md §27.6``).

    * up to the normal target (2): no flag needed — which is also how an empty system recovers;
    * above 2, up to the ceiling: ``override_policy`` (or break-glass, which is stronger) needed;
    * above the ceiling: ``break_glass`` needed;
    * a flag that was not needed is accepted but not recorded as used, so an audit query for
      break-glass events finds only real ones. Recovery from zero with ``break_glass`` IS recorded.

    This only ever evaluates a PROMOTION: no limit applies to a demotion or a recovery grant."""
    new_count = usable_before + 1
    needs_break_glass = new_count > ceiling
    needs_override = new_count > NORMAL_SUPER_ADMIN_TARGET
    if needs_break_glass and not break_glass:
        raise StaffAuthorityError(
            StaffCode.BREAK_GLASS_REQUIRED,
            f"This would make {new_count} usable Super Admins, above the safety ceiling of "
            f"{ceiling}. Re-run with --break-glass and a reason if that is really intended.",
        )
    if needs_override and not (override_policy or break_glass):
        raise StaffAuthorityError(
            StaffCode.POLICY_OVERRIDE_REQUIRED,
            f"This would make {new_count} usable Super Admins; the normal target is "
            f"{NORMAL_SUPER_ADMIN_TARGET}. Re-run with --override-policy and a reason if that "
            "is really intended (for example a credential rotation).",
        )
    return PromotionDecision(
        new_count=new_count,
        policy_override_used=needs_override,
        break_glass_used=break_glass and (needs_break_glass or usable_before == 0),
    )
