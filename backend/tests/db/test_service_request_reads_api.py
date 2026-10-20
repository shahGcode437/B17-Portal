"""Reading service requests against real PostgreSQL (Phase 12F; API_CONTRACT.md §13): the
requester's list, the provider inbox (``/users/me/leads``) and one request's detail.

Both parties see a request; nobody else does, and nobody learns that a request exists. The target
listing's later status never hides or changes an existing request.
"""

from typing import Any

import pytest
from sqlalchemy import event, text

from app.models.enums import ListingStatus
from tests.db.auth_helpers import AuthEnv
from tests.db.request_helpers import (
    LEADS,
    REQUESTS,
    act,
    approved_provider,
    detail,
    error_code,
    provider_signed_in,
    requester_signed_in,
    seed_requests,
    send,
    sent_id,
    set_request_status,
    world,
)
from tests.db.write_helpers import archive, set_status, signed_in


def ids(response: Any) -> list[str]:
    assert response.status_code == 200, response.text
    return [str(item["id"]) for item in response.json()["data"]]


# -- the requester's list ---------------------------------------------------------------------------


def test_a_new_account_has_no_requests(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)

    response = resident.get(REQUESTS)

    assert response.json() == {"data": [], "meta": {"total": 0, "limit": 12, "offset": 0}}


def test_the_list_holds_only_my_own_requests_newest_first(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    other = requester_signed_in(auth_env, "other@example.org")
    first = sent_id(w.resident, w.listing_id)
    seeded = seed_requests(auth_env.session, "resident@example.org", w.listing_id, 2)
    theirs = sent_id(other, w.listing_id)
    # the real request is the oldest; the seeded ones are +0s and +1s
    auth_env.session.execute(
        text(
            "UPDATE service_requests SET created_at = created_at - interval '1 hour' WHERE id = :i"
        ),
        {"i": first},
    )
    auth_env.session.commit()

    mine = ids(w.resident.get(REQUESTS))

    assert mine == [seeded[1], seeded[0], first]
    assert theirs not in mine
    assert ids(other.get(REQUESTS)) == [theirs]


def test_the_list_row_is_the_requesters_summary(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id, preferredContactChannel="whatsapp")

    row = w.resident.get(REQUESTS).json()["data"][0]

    assert row["id"] == request_id and row["status"] == "submitted"
    assert row["providerName"] == "Bright Spark Electricians"
    assert row["providerListingId"] == w.listing_id
    assert row["preferredContactChannel"] == "whatsapp"
    assert set(row) == {
        "id", "providerListingId", "providerName", "service", "details", "area", "preferredDate",
        "preferredTime", "notes", "preferredContactChannel", "status", "createdAt", "updatedAt",
    }  # fmt: skip
    assert "history" not in row and "requesterName" not in row  # the list stays lean


def test_the_list_filters_by_status_and_paginates(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    seeded = seed_requests(auth_env.session, "resident@example.org", w.listing_id, 5)
    set_request_status(auth_env.session, seeded[0], "accepted")
    set_request_status(auth_env.session, seeded[1], "cancelled")

    accepted = w.resident.get(REQUESTS, params={"status": "accepted"})
    submitted = w.resident.get(
        REQUESTS, params={"status": "submitted", "limit": "2", "offset": "1"}
    )

    assert ids(accepted) == [seeded[0]]
    assert accepted.json()["meta"] == {"total": 1, "limit": 12, "offset": 0}
    assert submitted.json()["meta"] == {"total": 3, "limit": 2, "offset": 1}
    assert len(submitted.json()["data"]) == 2
    assert ids(w.resident.get(REQUESTS, params={"status": "completed"})) == []
    assert ids(w.resident.get(REQUESTS, params={"status": "in-progress"})) == []
    assert ids(w.resident.get(REQUESTS, params={"status": ""})) != []  # blank = no filter


@pytest.mark.parametrize(
    "params",
    [{"status": "in_progress"}, {"status": "done"}, {"status": "ACCEPTED"}, {"limit": "0"},
     {"limit": "51"}, {"offset": "-1"}, {"offset": "x"}],
)  # fmt: skip
def test_invalid_list_parameters_are_validation_errors(
    auth_env: AuthEnv, params: dict[str, str]
) -> None:
    resident = requester_signed_in(auth_env)

    response = resident.get(REQUESTS, params=params)

    assert response.status_code == 422 and error_code(response) == "validation_error"


def test_an_unknown_list_parameter_changes_nothing(auth_env: AuthEnv) -> None:
    """There is no way to name another user or sort arbitrarily: unknown parameters are ignored."""
    w = world(auth_env)
    other = requester_signed_in(auth_env, "other@example.org")
    sent_id(other, w.listing_id)
    mine = sent_id(w.resident, w.listing_id)

    response = w.resident.get(
        REQUESTS, params={"requesterId": "x", "userId": "x", "sort": "oldest", "providerId": "x"}
    )

    assert ids(response) == [mine]


def test_anonymous_cannot_list(auth_env: AuthEnv) -> None:
    response = auth_env.client().get(REQUESTS)

    assert (response.status_code, error_code(response)) == (401, "unauthenticated")


def test_listing_requires_no_verification(auth_env: AuthEnv) -> None:
    """Reading what you already own is always allowed (create is what needs a verified e-mail)."""
    unverified = requester_signed_in(auth_env, "unverified@example.org", verified=False)

    assert unverified.get(REQUESTS).status_code == 200


# -- the detail -------------------------------------------------------------------------------------


def test_both_parties_see_the_same_request_from_their_own_side(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    as_requester = detail(w.resident, request_id)
    as_provider = detail(w.owner, request_id)

    assert as_requester["viewerRole"] == "requester" and as_provider["viewerRole"] == "provider"
    for key in ("id", "status", "service", "details", "area", "providerName", "history",
                "preferredDate", "preferredTime", "notes", "preferredContactChannel",
                "requesterName", "providerListingId"):  # fmt: skip
        assert as_requester[key] == as_provider[key], key
    assert as_provider["requesterName"] == "Rana Resident"
    assert as_provider["area"] == "B-17, Block C"  # the provider needs the area


def test_nobody_else_can_read_a_request(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)
    outsiders = {
        "another resident": requester_signed_in(auth_env, "other@example.org"),
        "another professional": provider_signed_in(auth_env, "rival@example.org"),
        "an admin": signed_in(auth_env, "admin@example.org", professional=None, admin=True),
    }

    for name, api in outsiders.items():
        response = api.get(f"{REQUESTS}/{request_id}")
        assert (response.status_code, error_code(response)) == (404, "not_found"), name
    anonymous = auth_env.client().get(f"{REQUESTS}/{request_id}")
    assert (anonymous.status_code, error_code(anonymous)) == (401, "unauthenticated")


def test_a_detail_never_contains_contact_or_account_data(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id, preferredContactChannel="phone")

    for api in (w.resident, w.owner):
        body = api.get(f"{REQUESTS}/{request_id}").text
        for secret in ("resident@example.org", "provider@example.org", "@", "password", 'phone":'):
            assert secret not in body, secret
        assert "requesterId" not in body and "ownerId" not in body and "userId" not in body


def test_unverified_party_can_still_read_a_request(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)
    auth_env.session.execute(
        text("UPDATE users SET email_verified_at = NULL WHERE email = 'resident@example.org'")
    )
    auth_env.session.commit()

    assert w.resident.get(f"{REQUESTS}/{request_id}").status_code == 200
    assert send(w.resident, w.listing_id).status_code == 403  # but cannot send a new one


# -- the provider inbox -----------------------------------------------------------------------------


def test_the_inbox_shows_requests_to_my_listings_only(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    rival = provider_signed_in(auth_env, "rival@example.org")
    rival_listing = approved_provider(auth_env, rival, name="Rival Provider Co")
    mine = sent_id(w.resident, w.listing_id)
    theirs = sent_id(w.resident, rival_listing)

    assert ids(w.owner.get(LEADS)) == [mine]
    assert ids(rival.get(LEADS)) == [theirs]


def test_the_inbox_covers_every_listing_the_provider_owns(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    second = approved_provider(auth_env, w.owner, name="Second Service Co")
    other = requester_signed_in(auth_env, "other@example.org")
    a = sent_id(w.resident, w.listing_id)
    b = sent_id(other, second)

    assert set(ids(w.owner.get(LEADS))) == {a, b}


def test_a_lead_names_the_requester_by_display_name_only(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id, notes="Gate code is 4321.")

    lead = w.owner.get(LEADS).json()["data"][0]

    assert lead["id"] == request_id and lead["requesterName"] == "Rana Resident"
    assert lead["area"] == "B-17, Block C" and lead["notes"] == "Gate code is 4321."
    assert "history" not in lead
    assert "resident@example.org" not in w.owner.get(LEADS).text


def test_the_inbox_is_newest_first_filterable_and_paginated(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    seeded = seed_requests(auth_env.session, "resident@example.org", w.listing_id, 5)
    set_request_status(auth_env.session, seeded[0], "accepted")
    set_request_status(auth_env.session, seeded[4], "completed")

    everything = w.owner.get(LEADS, params={"limit": "50"})
    accepted = w.owner.get(LEADS, params={"status": "accepted"})
    page = w.owner.get(LEADS, params={"limit": "2", "offset": "2"})

    assert ids(everything) == list(reversed(seeded))
    assert ids(accepted) == [seeded[0]]
    assert page.json()["meta"] == {"total": 5, "limit": 2, "offset": 2}
    assert ids(page) == [seeded[2], seeded[1]]


def test_the_inbox_needs_a_verified_professional(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)
    unverified_pro = signed_in(auth_env, "pro@example.org", verified=False)

    anonymous = auth_env.client().get(LEADS)
    plain = resident.get(LEADS)
    unverified = unverified_pro.get(LEADS)

    assert (anonymous.status_code, error_code(anonymous)) == (401, "unauthenticated")
    assert (plain.status_code, error_code(plain)) == (403, "professional_profile_required")
    assert (unverified.status_code, error_code(unverified)) == (403, "email_not_verified")


def test_an_admin_is_not_a_provider_and_sees_an_empty_inbox_only_with_a_profile(
    auth_env: AuthEnv,
) -> None:
    admin = signed_in(auth_env, "admin@example.org", professional=None, admin=True)
    admin_pro = signed_in(auth_env, "adminpro@example.org", admin=True)
    w = world(auth_env)
    sent_id(w.resident, w.listing_id)

    assert admin.get(LEADS).status_code == 403  # Admin is a role, not a capability
    assert ids(admin_pro.get(LEADS)) == []


def test_a_resident_can_not_read_the_inbox_by_owning_nothing(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    sent_id(w.resident, w.listing_id)

    assert w.resident.get(LEADS).status_code == 403


@pytest.mark.parametrize("params", [{"status": "in_progress"}, {"limit": "0"}, {"limit": "51"}])
def test_invalid_inbox_parameters_are_validation_errors(
    auth_env: AuthEnv, params: dict[str, str]
) -> None:
    w = world(auth_env)

    assert w.owner.get(LEADS, params=params).status_code == 422


# -- a request outlives its listing's status ------------------------------------------------------


@pytest.mark.parametrize(
    "status", [ListingStatus.REJECTED, ListingStatus.ARCHIVED, ListingStatus.PENDING]
)
def test_an_existing_request_stays_readable_whatever_happens_to_the_listing(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    set_status(auth_env.session, w.listing_id, status)

    assert ids(w.resident.get(REQUESTS)) == [request_id]
    assert ids(w.owner.get(LEADS)) == [request_id]
    assert detail(w.resident, request_id)["providerName"] == "Bright Spark Electricians"
    assert detail(w.owner, request_id)["status"] == "submitted"


def test_archiving_the_listing_through_the_api_keeps_the_inbox(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    assert archive(w.owner, w.listing_id, 1).status_code == 200

    assert ids(w.owner.get(LEADS)) == [request_id]
    assert act(w.owner, request_id, "accept").status_code == 200


def test_a_hard_deleted_listing_keeps_the_requesters_history_only(auth_env: AuthEnv) -> None:
    """``ON DELETE SET NULL`` + the name snapshot: the requester's record survives; the provider
    (derived from the listing) no longer has anything to be derived from."""
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    auth_env.session.execute(text("DELETE FROM listings WHERE id = :i"), {"i": w.listing_id})
    auth_env.session.commit()

    data = detail(w.resident, request_id)
    assert "providerListingId" not in data and data["providerName"] == "Bright Spark Electricians"
    assert ids(w.resident.get(REQUESTS)) == [request_id]
    assert w.owner.get(f"{REQUESTS}/{request_id}").status_code == 404
    assert ids(w.owner.get(LEADS)) == []


# -- cost ---------------------------------------------------------------------------------------------


def statements_for(env: AuthEnv, call: Any) -> tuple[Any, int]:
    engine = env.session.get_bind().engine
    counted: list[str] = []

    def count(_c: Any, _cur: Any, statement: str, *_: Any) -> None:
        counted.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        response = call()
    finally:
        event.remove(engine, "before_cursor_execute", count)
    return response, len(counted)


def test_the_requester_list_uses_a_bounded_number_of_queries(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    seed_requests(auth_env.session, "resident@example.org", w.listing_id, 10)

    small, few = statements_for(auth_env, lambda: w.resident.get(REQUESTS, params={"limit": "2"}))
    large, many = statements_for(auth_env, lambda: w.resident.get(REQUESTS, params={"limit": "10"}))

    assert len(small.json()["data"]) == 2 and len(large.json()["data"]) == 10
    assert many <= few + 1


def test_the_inbox_uses_a_bounded_number_of_queries(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    seed_requests(auth_env.session, "resident@example.org", w.listing_id, 5)
    other = requester_signed_in(auth_env, "other@example.org")
    seed_requests(auth_env.session, "other@example.org", w.listing_id, 5)
    assert other  # a second requester so the display-name join is exercised

    small, few = statements_for(auth_env, lambda: w.owner.get(LEADS, params={"limit": "2"}))
    large, many = statements_for(auth_env, lambda: w.owner.get(LEADS, params={"limit": "10"}))

    assert len(small.json()["data"]) == 2 and len(large.json()["data"]) == 10
    assert many <= few + 1


def test_lists_are_never_cached(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    for response in (w.resident.get(REQUESTS), w.owner.get(LEADS), w.resident.get(f"{REQUESTS}/x")):
        assert response.headers["cache-control"] == "no-store"
