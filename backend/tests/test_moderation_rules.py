"""The pure moderation rules (Phase 12E): the transition table and the rejection reason
(docs/backend/API_CONTRACT.md §10.3). No database."""

import pytest

from app.models.enums import MIN_REJECTION_REASON_LENGTH, HistoryAction, ListingStatus
from app.services.moderation_rules import (
    HISTORY_ACTION,
    MAX_REJECTION_REASON_LENGTH,
    TRANSITIONS,
    ModerationAction,
    is_takedown,
    normalize_reason,
    reason_problem,
    target_status,
)

P, A, R, X = (
    ListingStatus.PENDING,
    ListingStatus.APPROVED,
    ListingStatus.REJECTED,
    ListingStatus.ARCHIVED,
)


@pytest.mark.parametrize(
    ("action", "current", "expected"),
    [
        (ModerationAction.APPROVE, P, A),
        (ModerationAction.APPROVE, A, None),  # a double approval is not a transition
        (ModerationAction.APPROVE, R, None),  # the owner must edit and resubmit first
        (ModerationAction.APPROVE, X, None),
        (ModerationAction.REJECT, P, R),
        (ModerationAction.REJECT, A, R),  # the takedown (DATA_MODEL O-5)
        (ModerationAction.REJECT, R, None),
        (ModerationAction.REJECT, X, None),
    ],
)
def test_the_full_transition_matrix(
    action: ModerationAction, current: ListingStatus, expected: ListingStatus | None
) -> None:
    assert target_status(action, current) is expected


def test_every_status_and_action_pair_is_decided() -> None:
    allowed = {
        (action, source): target
        for action, table in TRANSITIONS.items()
        for source, target in table.items()
    }

    assert allowed == {
        (ModerationAction.APPROVE, P): A,
        (ModerationAction.REJECT, P): R,
        (ModerationAction.REJECT, A): R,
    }


def test_only_a_reject_of_an_approved_listing_is_a_takedown() -> None:
    assert is_takedown(ModerationAction.REJECT, A)
    assert not is_takedown(ModerationAction.REJECT, P)
    assert not is_takedown(ModerationAction.APPROVE, P)


def test_the_history_vocabulary_is_the_frozen_one() -> None:
    assert HISTORY_ACTION == {
        ModerationAction.APPROVE: HistoryAction.APPROVED,
        ModerationAction.REJECT: HistoryAction.REJECTED,
    }
    # the database CHECK ties the action to where the listing ended up: they must agree
    for action, table in TRANSITIONS.items():
        for target in table.values():
            assert HISTORY_ACTION[action].value == target.value


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Add your opening hours.  ", "Add your opening hours."),
        ("Too   many    spaces\there", "Too many spaces here"),
        ("Line one.\r\nLine two.", "Line one.\nLine two."),
        ("Line one.\rLine two.", "Line one.\nLine two."),
        ("First.\n\n\n\n\nSecond.", "First.\n\nSecond."),
        ("  indented  \n   second   line  ", "indented\nsecond line"),
        ("\n\nleading blank lines", "leading blank lines"),
    ],
)
def test_a_reason_is_normalised(raw: str, expected: str) -> None:
    assert normalize_reason(raw) == expected


def test_normalisation_is_idempotent() -> None:
    once = normalize_reason("  A   messy \r\n\r\n\r\n reason  here ")

    assert normalize_reason(once) == once


@pytest.mark.parametrize("length", [0, 1, MIN_REJECTION_REASON_LENGTH - 1])
def test_a_reason_shorter_than_ten_characters_is_refused(length: int) -> None:
    result = reason_problem("x" * length)

    assert result is not None and result[0] == "too_short"


def test_ten_characters_is_enough_and_five_hundred_is_the_limit() -> None:
    assert reason_problem("x" * MIN_REJECTION_REASON_LENGTH) is None
    assert reason_problem("x" * MAX_REJECTION_REASON_LENGTH) is None
    too_long = reason_problem("x" * (MAX_REJECTION_REASON_LENGTH + 1))
    assert too_long is not None and too_long[0] == "too_long"


def test_a_reason_that_only_looks_long_is_judged_after_normalisation() -> None:
    padded = "ok" + " " * 30 + "now"  # 35 characters raw, "ok now" (6) once normalised

    result = reason_problem(normalize_reason(padded))

    assert result is not None and result[0] == "too_short"
