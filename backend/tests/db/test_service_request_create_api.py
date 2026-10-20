"""Creating a service request against real PostgreSQL (Phase 12F; API_CONTRACT.md §13).

The requester is the session user, the provider is derived from the target listing's owner, the
status starts ``submitted``, and only an approved *provider* listing that is not the requester's
own can be the target. The contact channel is a preference: it sends and stores nothing else.
"""

from typing import Any
from unittest.mock import patch

import pytest

from app.models.enums import ListingStatus
from app.repositories.service_requests import ServiceRequestRepository
from tests.db.auth_helpers import AuthEnv
from tests.db.request_helpers import (
    REQUESTS,
    TODAY,
    TOMORROW,
    approved,
    approved_business,
    approved_provider,
    approved_tutor,
    detail_codes,
    error_code,
    history_rows,
    new_id,
    provider_signed_in,
    request_body,
    request_count,
    requester_signed_in,
    send,
    sent_id,
    stored_request,
    world,
)
from tests.db.write_helpers import created_id, set_status, signed_in
from tests.db.write_helpers import patch as patch_listing
from tests.write_payloads import food_body, property_body, provider_body

# -- the happy path ----------------------------------------------------------------------------------


def test_a_verified_resident_creates_a_request_that_starts_submitted(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id)

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert response.headers["location"] == f"/api/v1/requests/{data['id']}"
    assert data["status"] == "submitted"
    assert data["providerListingId"] == w.listing_id
    assert data["providerName"] == "Bright Spark Electricians"  # the snapshot
    assert data["requesterName"] == "Rana Resident"
    assert data["viewerRole"] == "requester"
    assert data["service"] == "Fix wiring"
    assert data["details"] == "The kitchen socket sparks when I plug the kettle in."
    assert data["area"] == "B-17, Block C"
    assert data["preferredDate"] == TOMORROW and data["preferredTime"] == "10:30"
    assert data["notes"] == "Please call before arriving."
    assert data["preferredContactChannel"] == "in_app"
    assert data["createdAt"] and data["updatedAt"]
    assert [(h.get("fromStatus"), h["toStatus"], h["actorRole"]) for h in data["history"]] == [
        (None, "submitted", "requester")
    ]


def test_the_stored_row_has_the_session_user_as_requester_and_the_listing_as_target(
    auth_env: AuthEnv,
) -> None:
    w = world(auth_env)

    request_id = sent_id(w.resident, w.listing_id)

    row = stored_request(auth_env.session, request_id)
    requester = auth_env.session.execute(
        __import__("sqlalchemy").text("SELECT id FROM users WHERE email = 'resident@example.org'")
    ).scalar_one()
    assert row["requester_id"] == requester
    assert str(row["provider_listing_id"]) == w.listing_id
    assert row["status"] == "submitted"
    assert row["provider_name_snapshot"] == "Bright Spark Electricians"
    assert history_rows(auth_env.session, request_id) == [(None, "submitted", "requester")]


def test_optional_fields_may_be_omitted_or_blank(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    body = request_body(w.listing_id, notes="   ", preferredTime=None)
    del body["preferredContactChannel"]

    response = w.resident.request("POST", REQUESTS, json=body)

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert "notes" not in data and "preferredTime" not in data  # absent, not empty strings
    assert data["preferredContactChannel"] == "in_app"


def test_text_is_trimmed(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = send(
        w.resident,
        w.listing_id,
        service="  Fix wiring  ",
        area="  B-17 Block C  ",
        details="   Socket sparks when the kettle is on.   ",
    )

    data = response.json()["data"]
    assert (data["service"], data["area"]) == ("Fix wiring", "B-17 Block C")
    assert data["details"] == "Socket sparks when the kettle is on."


def test_multi_line_details_are_allowed(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, details="Line one of the problem.\nLine two of it.")

    assert response.status_code == 201


def test_the_response_carries_no_email_phone_or_user_id(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    body = send(w.resident, w.listing_id).text

    for secret in ("resident@example.org", "provider@example.org", "email", "phone", "password"):
        assert secret not in body, secret
    assert "requesterId" not in body and "ownerId" not in body and "providerId" not in body


def test_responses_are_never_cached(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    assert send(w.resident, w.listing_id).headers["cache-control"] == "no-store"
    assert send(w.resident, new_id()).headers["cache-control"] == "no-store"  # an error too


# -- who may create ----------------------------------------------------------------------------------


def test_anonymous_cannot_create(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = send(auth_env.client(), w.listing_id)

    assert (response.status_code, error_code(response)) == (401, "unauthenticated")
    assert request_count(auth_env.session) == 0


def test_an_unverified_user_cannot_create_and_nothing_is_written(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    unverified = requester_signed_in(auth_env, "unverified@example.org", verified=False)

    response = send(unverified, w.listing_id)

    assert (response.status_code, error_code(response)) == (403, "email_not_verified")
    assert request_count(auth_env.session) == 0
    # not a forced logout: the same session still works
    assert unverified.get("/auth/me").status_code == 200


@pytest.mark.parametrize("who", ["resident", "professional", "premium", "admin"])
def test_every_verified_account_may_create(auth_env: AuthEnv, who: str) -> None:
    w = world(auth_env)
    api = {
        "resident": lambda: requester_signed_in(auth_env, "a@example.org"),
        "professional": lambda: signed_in(auth_env, "b@example.org"),
        "premium": lambda: provider_signed_in(auth_env, "c@example.org"),
        "admin": lambda: signed_in(auth_env, "d@example.org", professional=None, admin=True),
    }[who]()

    assert send(api, w.listing_id).status_code == 201


def test_a_requester_needs_no_professional_profile(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    plain = requester_signed_in(auth_env, "plain@example.org")
    assert plain.get("/auth/me").json()["data"].get("professional") is None

    assert send(plain, w.listing_id).status_code == 201


# -- own listing, eligible kinds, eligible status ---------------------------------------------------


def test_an_owner_cannot_request_their_own_listing(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = send(w.owner, w.listing_id)

    assert response.status_code == 422
    assert detail_codes(response) == [("providerListingId", "own_listing")]
    assert request_count(auth_env.session) == 0


def test_an_owner_may_request_another_providers_listing(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    other_owner = provider_signed_in(auth_env, "other@example.org")
    other_listing = approved_provider(auth_env, other_owner, name="Other Provider Co")

    assert send(w.owner, other_listing).status_code == 201


@pytest.mark.parametrize(
    "make",
    [
        pytest.param(lambda env, owner: approved_business(env, owner), id="business"),
        pytest.param(lambda env, owner: approved_tutor(env, owner), id="tutor"),
        pytest.param(lambda env, owner: approved(env, owner, property_body()), id="property"),
        pytest.param(lambda env, owner: approved(env, owner, food_body()), id="food"),
    ],
)
def test_only_provider_listings_can_be_requested(auth_env: AuthEnv, make: Any) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = make(auth_env, owner)
    resident = requester_signed_in(auth_env)

    response = send(resident, listing_id)

    assert response.status_code == 422
    assert detail_codes(response) == [("providerListingId", "not_requestable")]
    assert request_count(auth_env.session) == 0


@pytest.mark.parametrize(
    "status", [ListingStatus.PENDING, ListingStatus.REJECTED, ListingStatus.ARCHIVED]
)
def test_a_provider_listing_that_is_not_approved_cannot_be_requested(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = created_id(owner, provider_body())  # pending
    if status is not ListingStatus.PENDING:
        set_status(auth_env.session, listing_id, status)
    resident = requester_signed_in(auth_env)

    response = send(resident, listing_id)

    assert (response.status_code, error_code(response)) == (404, "not_found")
    assert request_count(auth_env.session) == 0


def test_an_unknown_target_is_not_found(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)

    response = send(resident, new_id())

    assert (response.status_code, error_code(response)) == (404, "not_found")


@pytest.mark.parametrize("bad", ["not-a-uuid", "123", "", None, 7, [], {}])
def test_a_malformed_target_id_is_a_validation_error(auth_env: AuthEnv, bad: Any) -> None:
    resident = requester_signed_in(auth_env)

    response = send(resident, bad)

    assert response.status_code == 422
    assert [f for f, _ in detail_codes(response)] == ["providerListingId"]


def test_the_target_is_re_checked_at_creation_not_at_first_sight(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    set_status(auth_env.session, w.listing_id, ListingStatus.REJECTED)  # taken down meanwhile

    assert send(w.resident, w.listing_id).status_code == 404

    set_status(auth_env.session, w.listing_id, ListingStatus.APPROVED)  # re-approved
    assert send(w.resident, w.listing_id).status_code == 201


# -- server-owned fields -----------------------------------------------------------------------------

SERVER_OWNED = [
    "id",
    "requesterId",
    "providerId",
    "providerUserId",
    "ownerId",
    "userId",
    "status",
    "createdAt",
    "updatedAt",
    "acceptedAt",
    "startedAt",
    "completedAt",
    "cancelledAt",
    "requestedBy",
    "requesterName",
    "providerName",
    "viewerRole",
    "history",
    "roles",
    "isAdmin",
    "revision",
    "adminNote",
    "auditLog",
]


@pytest.mark.parametrize("field", SERVER_OWNED)
@pytest.mark.parametrize("value", ["injected", None])
def test_a_server_owned_field_is_rejected_whatever_its_value(
    auth_env: AuthEnv, field: str, value: Any
) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, **{field: value})

    assert response.status_code == 422
    assert (field, "not_allowed") in detail_codes(response)
    assert request_count(auth_env.session) == 0


@pytest.mark.parametrize(
    "field", ["phone", "contactPhone", "whatsapp", "whatsappNumber", "email", "contactEmail"]
)
def test_no_contact_detail_can_be_submitted(auth_env: AuthEnv, field: str) -> None:
    """The contact model stores a preference only; there is no number to send (DECISIONS.md)."""
    w = world(auth_env)

    response = send(w.resident, w.listing_id, **{field: "+92 300 1234567"})

    assert response.status_code == 422
    assert (field, "not_allowed") in detail_codes(response)


def test_snake_case_names_are_not_accepted(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    body = request_body(w.listing_id)
    body["provider_listing_id"] = body.pop("providerListingId")

    response = w.resident.request("POST", REQUESTS, json=body)

    assert response.status_code == 422


# -- the contact channel -----------------------------------------------------------------------------


@pytest.mark.parametrize("channel", ["in_app", "whatsapp", "phone"])
def test_the_closed_set_of_contact_channels_is_accepted_and_stored(
    auth_env: AuthEnv, channel: str
) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, preferredContactChannel=channel)

    assert response.status_code == 201
    assert response.json()["data"]["preferredContactChannel"] == channel
    row = stored_request(auth_env.session, response.json()["data"]["id"])
    assert row["preferred_contact_channel"] == channel


@pytest.mark.parametrize(
    "channel", ["sms", "email", "telegram", "WhatsApp", "in-app", "", " phone", None, 1, True, []]
)
def test_any_other_contact_channel_is_rejected(auth_env: AuthEnv, channel: Any) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, preferredContactChannel=channel)

    assert response.status_code == 422
    assert [f for f, _ in detail_codes(response)] == ["preferredContactChannel"]
    assert request_count(auth_env.session) == 0


def test_a_whatsapp_preference_sends_nothing(auth_env: AuthEnv) -> None:
    """A preference is metadata: no e-mail, message, call or extra row is produced."""
    w = world(auth_env)
    emails_before = len(auth_env.outbox.outbox)

    send(w.resident, w.listing_id, preferredContactChannel="whatsapp")

    assert len(auth_env.outbox.outbox) == emails_before
    assert request_count(auth_env.session) == 1


# -- field validation --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("service", "", "string_too_short"),
        ("service", "   ", "string_too_short"),
        ("service", "x" * 81, "string_too_long"),
        ("service", "Fix\x00wiring", "invalid_characters"),
        ("service", "Fix\nwiring", "invalid_characters"),
        ("service", 5, "string_type"),
        ("service", None, "string_type"),
        ("details", "too short", "string_too_short"),
        ("details", " " * 30, "string_too_short"),
        ("details", "x" * 501, "string_too_long"),
        ("details", "Contains a\x07 bell character here", "invalid_characters"),
        ("details", None, "string_type"),
        ("area", "B", "string_too_short"),
        ("area", "x" * 81, "string_too_long"),
        ("area", "Block\tC", "invalid_characters"),
        ("area", None, "string_type"),
        ("notes", "x" * 501, "string_too_long"),
        ("notes", "bell\x07", "invalid_characters"),
        ("notes", 5, "string_type"),
    ],
)
def test_text_fields_are_bounded_printable_and_typed(
    auth_env: AuthEnv, field: str, value: Any, code: str
) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, **{field: value})

    assert response.status_code == 422
    assert (field, code) in detail_codes(response)
    assert request_count(auth_env.session) == 0


@pytest.mark.parametrize(
    ("field", "value"),
    [("service", "x" * 80), ("details", "x" * 500), ("details", "x" * 10), ("area", "B-"),
     ("area", "x" * 80), ("notes", "x" * 500)],
)  # fmt: skip
def test_text_bounds_are_inclusive(auth_env: AuthEnv, field: str, value: str) -> None:
    w = world(auth_env)

    assert send(w.resident, w.listing_id, **{field: value}).status_code == 201


@pytest.mark.parametrize(
    "missing", ["providerListingId", "service", "details", "area", "preferredDate"]
)
def test_required_fields_are_required(auth_env: AuthEnv, missing: str) -> None:
    w = world(auth_env)
    body = request_body(w.listing_id)
    del body[missing]

    response = w.resident.request("POST", REQUESTS, json=body)

    assert response.status_code == 422
    assert [f for f, _ in detail_codes(response)] == [missing]


@pytest.mark.parametrize(
    "value",
    ["2026-10-18T00:00:00", "20261018", "18-10-2026", "2026/10/18", "10/18/2026", "tomorrow",
     "2026-02-30", "2026-13-01", "2026-10-1", " 2026-10-18", "2026-10-18 ", 1760000000, 20261018,
     True, [], {}, None, ""],
)  # fmt: skip
def test_the_preferred_date_must_be_an_iso_calendar_date(auth_env: AuthEnv, value: Any) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, preferredDate=value)

    assert response.status_code == 422
    assert [f for f, _ in detail_codes(response)] == ["preferredDate"]


def test_the_preferred_date_may_not_be_in_the_past(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    assert send(w.resident, w.listing_id, preferredDate="2026-10-16").status_code == 422
    response = send(w.resident, w.listing_id, preferredDate="2020-01-01")
    assert detail_codes(response) == [("preferredDate", "in_the_past")]
    assert request_count(auth_env.session) == 0


def test_today_and_tomorrow_are_valid(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    first, second = (approved_provider(auth_env, owner, name=f"Provider {n}") for n in "AB")
    resident = requester_signed_in(auth_env)

    assert send(resident, first, preferredDate=TODAY).status_code == 201
    assert send(resident, second, preferredDate=TOMORROW).status_code == 201


@pytest.mark.parametrize(
    ("now_utc", "date", "ok"),
    [
        ("2026-10-17T18:59:00+00:00", "2026-10-17", True),  # 23:59 in B-17: still today
        ("2026-10-17T19:00:00+00:00", "2026-10-17", False),  # 00:00 next day in B-17
        ("2026-10-17T19:00:00+00:00", "2026-10-18", True),
        ("2026-10-17T00:00:00+00:00", "2026-10-17", True),  # 05:00 in B-17
    ],
)
def test_today_means_today_in_b17_not_in_utc(
    auth_env: AuthEnv, now_utc: str, date: str, ok: bool
) -> None:
    import datetime

    w = world(auth_env)
    auth_env.clock.now = datetime.datetime.fromisoformat(now_utc)

    response = send(w.resident, w.listing_id, preferredDate=date)

    assert (response.status_code == 201) is ok, response.text
    if not ok:
        assert detail_codes(response) == [("preferredDate", "in_the_past")]


def test_the_preferred_date_cannot_be_more_than_a_year_out(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    first, second = (approved_provider(auth_env, owner, name=f"Provider {n}") for n in "AB")
    resident = requester_signed_in(auth_env)

    assert send(resident, first, preferredDate="2027-10-17").status_code == 201  # +365 days
    response = send(resident, second, preferredDate="2027-10-18")  # +366 days
    assert response.status_code == 422
    assert detail_codes(response) == [("preferredDate", "too_far_ahead")]


@pytest.mark.parametrize("value", ["00:00", "09:05", "10:30", "23:59"])
def test_clock_times_are_accepted(auth_env: AuthEnv, value: str) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, preferredTime=value)

    assert response.status_code == 201
    assert response.json()["data"]["preferredTime"] == value


@pytest.mark.parametrize(
    "value", ["24:00", "25:00", "9:30", "10:60", "10:30:00", "10.30", "noon", "10:3", "", " 10:30", 1030, True]
)  # fmt: skip
def test_anything_else_is_not_a_clock_time(auth_env: AuthEnv, value: Any) -> None:
    w = world(auth_env)

    response = send(w.resident, w.listing_id, preferredTime=value)

    assert response.status_code == 422
    assert [f for f, _ in detail_codes(response)] == ["preferredTime"]


def test_a_body_that_is_not_an_object_is_rejected(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    bodies: list[Any] = [[], "text", 5, None]
    for body in bodies:
        assert w.resident.request("POST", REQUESTS, json=body).status_code == 422
    assert w.resident.request("POST", REQUESTS, content=b"{not json").status_code == 422
    assert w.resident.request("POST", REQUESTS).status_code == 422
    assert request_count(auth_env.session) == 0


def test_every_problem_is_reported_together(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = send(
        w.resident, w.listing_id, service="", details="short", area="B", status="accepted"
    )

    fields = {f for f, _ in detail_codes(response)}
    assert fields == {"service", "details", "area", "status"}


# -- the snapshot ------------------------------------------------------------------------------------


def test_the_provider_name_is_a_snapshot_that_survives_a_rename(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    assert patch_listing(w.owner, w.listing_id, 1, name="Totally Renamed Co").status_code == 200

    data = w.resident.get(f"{REQUESTS}/{request_id}").json()["data"]
    assert data["providerName"] == "Bright Spark Electricians"


# -- failure leaves nothing behind ------------------------------------------------------------------


def test_a_failure_while_writing_rolls_the_whole_request_back(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    with patch.object(
        ServiceRequestRepository, "record_history", side_effect=RuntimeError("history failed")
    ):
        response = send(w.resident, w.listing_id)

    assert response.status_code == 500
    assert request_count(auth_env.session) == 0  # no request without its history
    assert send(w.resident, w.listing_id).status_code == 201  # and the failure cost no quota


# -- rate limits (API_CONTRACT.md §10.8: 5/hour per user, 1 per provider per day) ------------------


def test_the_same_provider_can_be_asked_once_a_day(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    assert send(w.resident, w.listing_id).status_code == 201

    second = send(w.resident, w.listing_id)

    assert (second.status_code, error_code(second)) == (429, "rate_limited")
    assert int(second.headers["retry-after"]) > 0
    assert request_count(auth_env.session) == 1
    # another requester is not affected, and neither is another provider
    other = requester_signed_in(auth_env, "other@example.org")
    assert send(other, w.listing_id).status_code == 201
    elsewhere = approved_provider(auth_env, w.owner, name="Second Provider Co")
    assert send(w.resident, elsewhere).status_code == 201


def test_the_per_provider_limit_resets_after_a_day(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    assert send(w.resident, w.listing_id).status_code == 201
    assert send(w.resident, w.listing_id).status_code == 429

    auth_env.clock.advance(hours=24, minutes=1)

    assert send(w.resident, w.listing_id, preferredDate="2026-10-19").status_code == 201


def test_a_user_can_send_five_requests_an_hour(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    targets = [approved_provider(auth_env, owner, name=f"Provider {n}") for n in range(6)]
    resident = requester_signed_in(auth_env)

    results = [send(resident, target).status_code for target in targets]

    assert results == [201, 201, 201, 201, 201, 429]
    assert request_count(auth_env.session) == 5
    auth_env.clock.advance(hours=1, minutes=1)
    assert send(resident, targets[5]).status_code == 201


def test_a_rejected_request_does_not_use_up_the_allowance(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    for _ in range(3):
        assert send(w.resident, w.listing_id, details="short").status_code == 422
        assert send(w.resident, new_id()).status_code == 404
        assert send(w.owner, w.listing_id).status_code == 422  # own listing

    assert send(w.resident, w.listing_id).status_code == 201


def test_the_limits_belong_to_the_user_not_the_session(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    assert send(w.resident, w.listing_id).status_code == 201

    second_browser = auth_env.client()
    assert second_browser.login("resident@example.org").status_code == 200

    assert send(second_browser, w.listing_id).status_code == 429
