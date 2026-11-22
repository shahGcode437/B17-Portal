"""Reading service requests against real PostgreSQL (Phase 12F; API_CONTRACT.md §13, RBAC-D §16):
the requester's list, one request's detail and the PORTAL's queue (``/admin/requests``).

A Service / Professional listing is portal-managed and has no owner, so a request to it has two
readers and no more: the REQUESTER (their own list and detail) and PORTAL STAFF with services
authority (the queue and the detail on the staff API). Nobody else sees it, and nobody learns that a
request exists. The target listing's later status never hides or changes an existing request.
"""

from typing import Any

import pytest
from sqlalchemy import event, text

from app.models.enums import CategoryModule, ListingStatus, PlanCode
from tests.db.auth_helpers import AuthEnv
from tests.db.request_helpers import (
    LEADS,
    PORTAL_REQUESTS,
    REQUESTS,
    approved_provider,
    detail,
    error_code,
    moderator_signed_in,
    provider_signed_in,
    requester_signed_in,
    seed_requests,
    send,
    sent_id,
    set_request_status,
    staff_detail,
    world,
)
from tests.db.write_helpers import archive_provider, set_status, signed_in

SERVICES = CategoryModule.SERVICES


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


def test_the_requester_and_the_portal_see_the_same_request_from_their_own_side(
    auth_env: AuthEnv,
) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    as_requester = detail(w.resident, request_id)
    as_portal = staff_detail(w.author, request_id)

    assert as_requester["viewerRole"] == "requester" and as_portal["viewerRole"] == "provider"
    for key in ("id", "status", "service", "details", "area", "providerName", "history",
                "preferredDate", "preferredTime", "notes", "preferredContactChannel",
                "requesterName", "providerListingId"):  # fmt: skip
        assert as_requester[key] == as_portal[key], key
    assert as_portal["requesterName"] == "Rana Resident"
    assert as_portal["area"] == "B-17, Block C"  # the portal needs the area to do the work


def test_a_services_moderator_reads_it_exactly_like_a_super_admin(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)
    moderator = moderator_signed_in(auth_env, "mod-services", SERVICES)

    assert staff_detail(moderator, request_id) == staff_detail(w.author, request_id)


def test_nobody_else_can_read_a_request(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)
    other_resident = requester_signed_in(auth_env, "other@example.org")
    plain_pro = signed_in(auth_env, "rival@example.org", professional=PlanCode.PREMIUM)
    directory = moderator_signed_in(auth_env, "mod-directory", CategoryModule.DIRECTORY)
    zero_scope = moderator_signed_in(auth_env, "mod-zero")

    # the requester's API: everyone who is not the requester — staff included — is a non-party
    for name, api in {
        "another resident": other_resident,
        "a professional": plain_pro,
        "the staff author": w.author,
        "a directory moderator": directory,
    }.items():
        response = api.get(f"{REQUESTS}/{request_id}")
        assert (response.status_code, error_code(response)) == (404, "not_found"), name
    # the portal's API: not staff = 403; staff without ``services`` = the concealing 404
    for name, api in {"another resident": other_resident, "a professional": plain_pro}.items():
        assert api.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 403, name
    assert directory.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 404
    assert (
        zero_scope.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 403
    )  # no authority at all
    for path in (f"{REQUESTS}/{request_id}", f"{PORTAL_REQUESTS}/{request_id}"):
        anonymous = auth_env.client().get(path)
        assert (anonymous.status_code, error_code(anonymous)) == (401, "unauthenticated")


def test_a_detail_never_contains_contact_or_account_data(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id, preferredContactChannel="phone")

    for body in (
        w.resident.get(f"{REQUESTS}/{request_id}").text,
        w.author.get(f"{PORTAL_REQUESTS}/{request_id}").text,
        w.author.get(PORTAL_REQUESTS).text,
    ):
        for secret in ("resident@example.org", "provider@example.org", "@", "password", 'phone":'):
            assert secret not in body, secret
        assert "requesterId" not in body and "ownerId" not in body and "userId" not in body
        assert "actorUserId" not in body and "actor_user_id" not in body


def test_unverified_party_can_still_read_a_request(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)
    auth_env.session.execute(
        text("UPDATE users SET email_verified_at = NULL WHERE email = 'resident@example.org'")
    )
    auth_env.session.commit()

    assert w.resident.get(f"{REQUESTS}/{request_id}").status_code == 200
    assert send(w.resident, w.listing_id).status_code == 403  # but cannot send a new one


# -- the portal's queue -----------------------------------------------------------------------------


def test_the_queue_holds_the_requests_to_every_provider(auth_env: AuthEnv) -> None:
    """The queue is the portal's, not any author's: requests to Providers authored by different
    staff all appear, for any staff member with services authority."""
    w = world(auth_env)
    rival = provider_signed_in(auth_env, "rival@example.org")
    rival_listing = approved_provider(auth_env, rival, name="Rival Provider Co")
    first = sent_id(w.resident, w.listing_id)
    second = sent_id(w.resident, rival_listing)
    moderator = moderator_signed_in(auth_env, "mod-services", SERVICES)

    for api in (w.author, rival, moderator):
        assert set(ids(api.get(PORTAL_REQUESTS))) == {first, second}


def test_a_queue_row_names_the_requester_by_display_name_only(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id, notes="Gate code is 4321.")

    row = w.author.get(PORTAL_REQUESTS).json()["data"][0]

    assert row["id"] == request_id and row["requesterName"] == "Rana Resident"
    assert row["area"] == "B-17, Block C" and row["notes"] == "Gate code is 4321."
    assert "history" not in row
    assert "resident@example.org" not in w.author.get(PORTAL_REQUESTS).text


def test_the_queue_is_newest_first_filterable_and_paginated(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    seeded = seed_requests(auth_env.session, "resident@example.org", w.listing_id, 5)
    set_request_status(auth_env.session, seeded[0], "accepted")
    set_request_status(auth_env.session, seeded[4], "completed")

    everything = w.author.get(PORTAL_REQUESTS, params={"limit": "50"})
    accepted = w.author.get(PORTAL_REQUESTS, params={"status": "accepted"})
    page = w.author.get(PORTAL_REQUESTS, params={"limit": "2", "offset": "2"})

    assert ids(everything) == list(reversed(seeded))
    assert ids(accepted) == [seeded[0]]
    assert page.json()["meta"] == {"total": 5, "limit": 2, "offset": 2}
    assert ids(page) == [seeded[2], seeded[1]]


def test_the_queue_is_a_collection_for_services_authority_only(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    sent_id(w.resident, w.listing_id)
    outsiders = {
        "a resident": requester_signed_in(auth_env, "other@example.org"),
        "a professional": signed_in(auth_env, "pro@example.org", professional=PlanCode.PREMIUM),
    }
    others = {
        "directory": moderator_signed_in(auth_env, "m-d", CategoryModule.DIRECTORY),
        "food": moderator_signed_in(auth_env, "m-f", CategoryModule.FOOD),
        "education": moderator_signed_in(auth_env, "m-e", CategoryModule.EDUCATION),
        "property": moderator_signed_in(auth_env, "m-p", CategoryModule.PROPERTY),
        "news only": moderator_signed_in(auth_env, "m-n", CategoryModule.NEWS),
        "no scope": moderator_signed_in(auth_env, "m-z"),
    }

    for name, api in {**outsiders, **others}.items():
        response = api.get(PORTAL_REQUESTS)
        assert (response.status_code, error_code(response)) == (403, "forbidden"), name
        assert "data" not in response.json()
    anonymous = auth_env.client().get(PORTAL_REQUESTS)
    assert (anonymous.status_code, error_code(anonymous)) == (401, "unauthenticated")


@pytest.mark.parametrize("params", [{"status": "in_progress"}, {"limit": "0"}, {"limit": "51"}])
def test_invalid_queue_parameters_are_validation_errors(
    auth_env: AuthEnv, params: dict[str, str]
) -> None:
    w = world(auth_env)

    assert w.author.get(PORTAL_REQUESTS, params=params).status_code == 422


def test_the_legacy_owner_inbox_is_empty_for_everyone(auth_env: AuthEnv) -> None:
    """``/users/me/leads`` lists requests to listings the caller OWNS. No Provider has an owner, so
    for everyone — the staff author, another professional, a Moderator — it is empty, and the
    request is in the portal's queue instead. (It is kept for the existing Professional Workspace.)"""
    w = world(auth_env)
    sent_id(w.resident, w.listing_id)
    rival = signed_in(auth_env, "rival@example.org", professional=PlanCode.PREMIUM)

    assert ids(w.author.get(LEADS)) == []
    assert ids(rival.get(LEADS)) == []
    assert len(ids(w.author.get(PORTAL_REQUESTS))) == 1


def test_the_legacy_inbox_still_needs_a_verified_professional(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)
    unverified_pro = signed_in(auth_env, "pro@example.org", verified=False)
    admin = signed_in(auth_env, "admin@example.org", professional=None, admin=True)

    anonymous = auth_env.client().get(LEADS)
    plain = resident.get(LEADS)
    unverified = unverified_pro.get(LEADS)

    assert (anonymous.status_code, error_code(anonymous)) == (401, "unauthenticated")
    assert (plain.status_code, error_code(plain)) == (403, "professional_profile_required")
    assert (unverified.status_code, error_code(unverified)) == (403, "email_not_verified")
    assert admin.get(LEADS).status_code == 403  # Admin is a role, not a capability


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
    assert ids(w.author.get(PORTAL_REQUESTS)) == [request_id]
    assert detail(w.resident, request_id)["providerName"] == "Bright Spark Electricians"
    assert staff_detail(w.author, request_id)["status"] == "submitted"


def test_archiving_the_provider_through_the_staff_api_keeps_the_queue(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    assert archive_provider(w.author, w.listing_id, 1).status_code == 200

    assert ids(w.author.get(PORTAL_REQUESTS)) == [request_id]


def test_a_hard_deleted_listing_keeps_the_requesters_history_and_the_portal_loses_the_scope(
    auth_env: AuthEnv,
) -> None:
    """``ON DELETE SET NULL`` + the name snapshot: the requester's record survives. The staff scope
    that handles a request is derived from its target listing, so with the listing gone the request
    is unmapped: only a Super Admin can still open it, a services Moderator gets the concealing
    ``404``, and the queue (which lists requests to Providers) no longer shows it."""
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)
    moderator = moderator_signed_in(auth_env, "mod-services", SERVICES)

    auth_env.session.execute(text("DELETE FROM listings WHERE id = :i"), {"i": w.listing_id})
    auth_env.session.commit()

    data = detail(w.resident, request_id)
    assert "providerListingId" not in data and data["providerName"] == "Bright Spark Electricians"
    assert ids(w.resident.get(REQUESTS)) == [request_id]
    assert w.author.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 200
    assert moderator.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 404
    assert ids(w.author.get(PORTAL_REQUESTS)) == []


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


def test_the_queue_uses_a_bounded_number_of_queries(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    seed_requests(auth_env.session, "resident@example.org", w.listing_id, 5)
    other = requester_signed_in(auth_env, "other@example.org")
    seed_requests(auth_env.session, "other@example.org", w.listing_id, 5)
    assert other  # a second requester so the display-name join is exercised

    small, few = statements_for(
        auth_env, lambda: w.author.get(PORTAL_REQUESTS, params={"limit": "2"})
    )
    large, many = statements_for(
        auth_env, lambda: w.author.get(PORTAL_REQUESTS, params={"limit": "10"})
    )

    assert len(small.json()["data"]) == 2 and len(large.json()["data"]) == 10
    assert many <= few + 1


def test_lists_and_details_are_never_cached(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    request_id = sent_id(w.resident, w.listing_id)

    for response in (
        w.resident.get(REQUESTS),
        w.author.get(LEADS),
        w.author.get(PORTAL_REQUESTS),
        w.author.get(f"{PORTAL_REQUESTS}/{request_id}"),
        w.resident.get(f"{REQUESTS}/x"),
    ):
        assert response.headers["cache-control"] == "no-store"
