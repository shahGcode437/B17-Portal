"""The pure service-request rules (Phase 12F): the state machine, who may drive it, and the date
rules. No database. The expectations are written out literally (not derived from the module) so a
change to the rules has to change this file too."""

import datetime
import itertools

import pytest

from app.models.enums import ContactChannel, RequestActorRole, RequestStatus
from app.services.request_rules import (
    LOCAL_UTC_OFFSET,
    MAX_DAYS_AHEAD,
    TERMINAL,
    RequestAction,
    can_transition,
    clean_optional,
    date_problem,
    has_authority,
    local_today,
    target_status,
)

S, A, P, C, X = (
    RequestStatus.SUBMITTED,
    RequestStatus.ACCEPTED,
    RequestStatus.IN_PROGRESS,
    RequestStatus.COMPLETED,
    RequestStatus.CANCELLED,
)
PROVIDER, REQUESTER = RequestActorRole.PROVIDER, RequestActorRole.REQUESTER
ACCEPT, START, COMPLETE, CANCEL = (
    RequestAction.ACCEPT,
    RequestAction.START,
    RequestAction.COMPLETE,
    RequestAction.CANCEL,
)

#: Every allowed (action, role, from-status). Anything not in this set is NOT allowed.
ALLOWED = {
    (ACCEPT, PROVIDER, S),
    (START, PROVIDER, A),
    (COMPLETE, PROVIDER, P),
    (CANCEL, PROVIDER, S),
    (CANCEL, PROVIDER, A),
    (CANCEL, PROVIDER, P),
    (CANCEL, REQUESTER, S),
    (CANCEL, REQUESTER, A),
}


# -- vocabulary ---------------------------------------------------------------------------------------


def test_the_wire_values_are_exactly_the_frozen_ones() -> None:
    assert [s.value for s in RequestStatus] == [
        "submitted",
        "accepted",
        "in-progress",  # hyphenated, as the frontend and DATA_MODEL.md spell it
        "completed",
        "cancelled",
    ]
    assert [c.value for c in ContactChannel] == ["in_app", "whatsapp", "phone"]
    assert [r.value for r in RequestActorRole] == ["requester", "provider"]
    assert [a.value for a in RequestAction] == ["accept", "start", "complete", "cancel"]


def test_each_action_has_one_target_status() -> None:
    assert target_status(ACCEPT) is A
    assert target_status(START) is P
    assert target_status(COMPLETE) is C
    assert target_status(CANCEL) is X


def test_the_terminal_statuses() -> None:
    assert {C, X} == TERMINAL


# -- the transition matrix ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("action", "role", "status"),
    list(itertools.product(RequestAction, RequestActorRole, RequestStatus)),
)
def test_can_transition_matches_the_frozen_table_for_every_combination(
    action: RequestAction, role: RequestActorRole, status: RequestStatus
) -> None:
    assert can_transition(action, role, status) is ((action, role, status) in ALLOWED)


@pytest.mark.parametrize("terminal", [C, X])
@pytest.mark.parametrize("action", list(RequestAction))
@pytest.mark.parametrize("role", list(RequestActorRole))
def test_nothing_leaves_a_terminal_status(
    terminal: RequestStatus, action: RequestAction, role: RequestActorRole
) -> None:
    assert not can_transition(action, role, terminal)


@pytest.mark.parametrize("action", [ACCEPT, START, COMPLETE])
def test_the_requester_has_no_authority_over_the_forward_actions(action: RequestAction) -> None:
    assert not has_authority(action, REQUESTER)
    assert has_authority(action, PROVIDER)


def test_both_parties_have_authority_over_cancel() -> None:
    assert has_authority(CANCEL, REQUESTER) and has_authority(CANCEL, PROVIDER)


def test_the_requester_can_cancel_only_before_work_starts() -> None:
    assert [can_transition(CANCEL, REQUESTER, s) for s in RequestStatus] == [
        True,  # submitted
        True,  # accepted
        False,  # in-progress
        False,  # completed
        False,  # cancelled
    ]


def test_the_provider_can_cancel_any_non_terminal_status() -> None:
    assert [can_transition(CANCEL, PROVIDER, s) for s in RequestStatus] == [
        True,
        True,
        True,
        False,
        False,
    ]


def test_the_forward_path_is_a_chain_with_no_skipped_step() -> None:
    chain = [(ACCEPT, S, A), (START, A, P), (COMPLETE, P, C)]
    for action, source, target in chain:
        assert can_transition(action, PROVIDER, source) and target_status(action) is target
        others = [s for s in RequestStatus if s is not source]
        assert not any(can_transition(action, PROVIDER, s) for s in others)


# -- dates ---------------------------------------------------------------------------------------------


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime.datetime:
    return datetime.datetime(year, month, day, hour, minute, tzinfo=datetime.UTC)


def test_b17_is_five_hours_ahead_of_utc() -> None:
    assert datetime.timedelta(hours=5) == LOCAL_UTC_OFFSET


@pytest.mark.parametrize(
    ("now", "today"),
    [
        (utc(2026, 10, 17, 0, 0), datetime.date(2026, 10, 17)),
        (utc(2026, 10, 17, 18, 59), datetime.date(2026, 10, 17)),  # 23:59 in B-17
        (utc(2026, 10, 17, 19, 0), datetime.date(2026, 10, 18)),  # midnight in B-17
        (utc(2026, 12, 31, 20, 0), datetime.date(2027, 1, 1)),  # across a year
        (utc(2028, 2, 28, 19, 30), datetime.date(2028, 2, 29)),  # leap day
    ],
)
def test_today_is_today_in_b17(now: datetime.datetime, today: datetime.date) -> None:
    assert local_today(now) == today


def test_a_timezone_aware_instant_in_another_zone_is_converted() -> None:
    karachi = datetime.timezone(datetime.timedelta(hours=5))
    pacific = datetime.timezone(datetime.timedelta(hours=-8))
    now = datetime.datetime(2026, 10, 17, 23, 30, tzinfo=karachi)  # 18:30 UTC
    same_instant = datetime.datetime(2026, 10, 17, 10, 30, tzinfo=pacific)

    assert local_today(now) == local_today(same_instant) == datetime.date(2026, 10, 17)


NOW = utc(2026, 10, 17, 12, 0)  # 17:00 on 2026-10-17 in B-17


@pytest.mark.parametrize(
    "date",
    [datetime.date(2026, 10, 17), datetime.date(2026, 10, 18), datetime.date(2027, 10, 17)],
)
def test_today_tomorrow_and_a_year_out_are_acceptable(date: datetime.date) -> None:
    assert date_problem(date, NOW) is None


def test_yesterday_and_earlier_are_in_the_past() -> None:
    for date in (datetime.date(2026, 10, 16), datetime.date(2000, 1, 1), datetime.date(1, 1, 1)):
        problem = date_problem(date, NOW)
        assert problem is not None
        assert (problem.field, problem.code) == ("preferredDate", "in_the_past")


def test_more_than_a_year_out_is_too_far() -> None:
    assert MAX_DAYS_AHEAD == 365
    problem = date_problem(datetime.date(2027, 10, 18), NOW)
    assert problem is not None
    assert (problem.field, problem.code) == ("preferredDate", "too_far_ahead")
    assert date_problem(datetime.date(9999, 12, 31), NOW) is not None


def test_the_boundary_moves_with_the_local_midnight() -> None:
    late = utc(2026, 10, 17, 19, 0)  # already 2026-10-18 in B-17

    assert date_problem(datetime.date(2026, 10, 17), late) is not None
    assert date_problem(datetime.date(2026, 10, 18), late) is None


# -- optional text -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, None), ("", None), ("   ", None), ("\n\t", None), (" hi ", "hi"), ("a  b", "a  b")],
)
def test_clean_optional_trims_and_turns_blank_into_absent(
    value: str | None, expected: str | None
) -> None:
    assert clean_optional(value) == expected
