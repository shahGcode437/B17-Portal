"""The pure rules of admin moderation (Phase 12E; docs/backend/API_CONTRACT.md §10.3, §10.4).

One transition table decides which moderation action is legal from which status — routers and the
service never repeat it. Nothing here touches the database.

=======  ==========================  ===============================================================
action   from -> to                  notes
=======  ==========================  ===============================================================
approve  ``pending -> approved``     only a pending listing can be approved
reject   ``pending -> rejected``     a reason of at least 10 characters
reject   ``approved -> rejected``    the takedown (DATA_MODEL O-5): same action, same history row
=======  ==========================  ===============================================================

Everything else — approving a ``rejected`` / ``approved`` / ``archived`` listing, rejecting a
``rejected`` / ``archived`` one — is ``invalid_state_transition``. Moderation never edits content
and never changes ``revision``: it acts *on* the revision the admin reviewed.
"""

import re
from enum import StrEnum

from app.models.enums import MIN_REJECTION_REASON_LENGTH, HistoryAction, ListingStatus

#: An abuse bound (not frozen elsewhere); the owner reads this text.
MAX_REJECTION_REASON_LENGTH = 500


class ModerationAction(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"


TRANSITIONS: dict[ModerationAction, dict[ListingStatus, ListingStatus]] = {
    ModerationAction.APPROVE: {ListingStatus.PENDING: ListingStatus.APPROVED},
    ModerationAction.REJECT: {
        ListingStatus.PENDING: ListingStatus.REJECTED,
        ListingStatus.APPROVED: ListingStatus.REJECTED,
    },
}

#: The history vocabulary is the frozen one; a takedown is a ``rejected`` row from ``approved``.
HISTORY_ACTION: dict[ModerationAction, HistoryAction] = {
    ModerationAction.APPROVE: HistoryAction.APPROVED,
    ModerationAction.REJECT: HistoryAction.REJECTED,
}


def target_status(action: ModerationAction, current: ListingStatus) -> ListingStatus | None:
    """Where ``action`` takes a listing that is ``current``, or ``None`` if it is not allowed."""
    return TRANSITIONS[action].get(current)


def is_takedown(action: ModerationAction, current: ListingStatus) -> bool:
    return action is ModerationAction.REJECT and current is ListingStatus.APPROVED


_SPACES = re.compile(r"[ \t]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def normalize_reason(raw: str) -> str:
    """The reason as stored and shown to the owner: line endings unified, runs of spaces / tabs
    collapsed, more than one blank line collapsed, leading / trailing whitespace removed."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def reason_problem(reason: str) -> tuple[str, str] | None:
    """``(code, message)`` if the NORMALISED reason is unusable (the database also checks >= 10)."""
    if len(reason) < MIN_REJECTION_REASON_LENGTH:
        return (
            "too_short",
            f"Give a specific reason of at least {MIN_REJECTION_REASON_LENGTH} characters.",
        )
    if len(reason) > MAX_REJECTION_REASON_LENGTH:
        return ("too_long", f"Keep the reason under {MAX_REJECTION_REASON_LENGTH} characters.")
    return None
