"""Portal Service requests: the provider side of a request is handled by portal staff (RBAC-D;
docs/backend/AUTH_RBAC.md §31, API_CONTRACT.md §16).

A Service / Professional listing is portal-managed and has NO owner, so a request to it is a request
to B-17 Portal — not to whoever authored the Provider. This module proves, on real PostgreSQL through
the real app and real login, that the portal can actually answer it:

* a resident's request to a Provider is created, and nothing about it depends on the Provider's
  author or owner (there is neither a stored recipient nor a personal one);
* a Super Admin and a Moderator holding the ``services`` scope — and only they — queue, read, accept,
  start, complete and cancel it; every other staff scope, a Professional and a Resident cannot;
* removing, demoting or re-scoping the staff member who authored the Provider (or who handled the
  request) leaves the request manageable by any other authorised staff member;
* the history row records the ACTUAL staff actor, in the provider capacity, and the requester's view
  of the story is unchanged;
* the existing lifecycle is intact (``test_service_request_lifecycle_api.py`` holds the matrix) and a
  failure while handling a request changes nothing.

The races (a scope revoke against an in-flight action) live in
``test_portal_request_concurrency.py``.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.models.enums import CategoryModule, PlanCode
from app.repositories.service_requests import ServiceRequestRepository
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.request_helpers import (
    LEADS,
    PORTAL_REQUESTS,
    REQUESTS,
    World,
    act,
    approved_provider,
    detail,
    history_rows,
    moderator_signed_in,
    request_count,
    requester_signed_in,
    sent_id,
    staff_act,
    staff_detail,
    status_of,
    stored_request,
    world,
)
from tests.db.staff_helpers import MODERATORS, audit_count, remove, super_admin
from tests.db.write_helpers import signed_in

SERVICES = CategoryModule.SERVICES
OTHER_SCOPES = [
    CategoryModule.DIRECTORY,
    CategoryModule.FOOD,
    CategoryModule.EDUCATION,
    CategoryModule.PROPERTY,
]


def user_id(env: AuthEnv, email: str) -> uuid.UUID:
    found = env.session.scalar(text("SELECT id FROM users WHERE email = :e"), {"e": email})
    assert found is not None
    assert isinstance(found, uuid.UUID)
    return found


def history_actors(env: AuthEnv, request_id: str) -> list[tuple[uuid.UUID, str]]:
    """``(actor_user_id, actor_role)`` of every history row, oldest first — the stored truth."""
    env.session.expire_all()
    return [
        (row[0], str(row[1]))
        for row in env.session.execute(
            text(
                "SELECT actor_user_id, actor_role FROM service_request_status_history "
                "WHERE request_id = :i ORDER BY created_at, id"
            ),
            {"i": request_id},
        )
    ]


def scene(env: AuthEnv) -> tuple[World, str]:
    w = world(env)
    return w, sent_id(w.resident, w.listing_id)


# =================================================================================================
# 1-2, 10. A request to a portal-managed Provider, and the absence of any personal recipient
# =================================================================================================


def test_a_resident_can_request_a_portal_managed_provider(auth_env: AuthEnv) -> None:
    w = world(auth_env)

    response = w.resident.request(
        "POST",
        REQUESTS,
        json={
            "providerListingId": w.listing_id,
            "service": "Fix wiring",
            "details": "The kitchen socket sparks when I plug the kettle in.",
            "area": "B-17, Block C",
            "preferredDate": "2026-10-18",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["data"]["status"] == "submitted"
    owner = auth_env.session.scalar(
        text("SELECT owner_id FROM listings WHERE id = :i"), {"i": w.listing_id}
    )
    assert owner is None  # and the request did not give the Provider one


def test_the_request_depends_on_nobody_who_authored_or_owns_the_provider(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)

    columns = {
        row[0]
        for row in auth_env.session.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'service_requests'"
            )
        )
    }
    assert not {"provider_id", "provider_user_id", "provider_owner_id", "recipient_id"} & columns
    # the only account on its history is the requester: the Provider's author appears nowhere
    requester = user_id(auth_env, "resident@example.org")
    assert history_actors(auth_env, request_id) == [(requester, "requester")]
    assert w.author.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 200  # they handle it only
    # ...as ordinary staff: the same call from the requester's API is a non-party
    assert w.author.get(f"{REQUESTS}/{request_id}").status_code == 404


def test_there_is_no_personal_recipient_inbox(auth_env: AuthEnv) -> None:
    """``/users/me/leads`` lists requests to listings the caller OWNS; no Provider has an owner, so
    it is empty for the author, for another professional and for a Moderator alike."""
    w, request_id = scene(auth_env)
    pro = signed_in(auth_env, "rival@example.org", professional=PlanCode.PREMIUM)

    for api in (w.author, pro):
        leads = api.get(LEADS)
        assert leads.status_code == 200, leads.text
        assert leads.json()["data"] == [] and leads.json()["meta"]["total"] == 0
    assert request_id in {row["id"] for row in w.author.get(PORTAL_REQUESTS).json()["data"]}
    assert request_count(auth_env.session) == 1


# =================================================================================================
# 3-4. Who handles it: a Super Admin and a services Moderator
# =================================================================================================


@pytest.mark.parametrize("who", ["super_admin", "services_moderator", "services_and_directory"])
def test_authorised_staff_drive_a_request_to_completion(auth_env: AuthEnv, who: str) -> None:
    w, request_id = scene(auth_env)
    api = {
        "super_admin": lambda: w.author,
        "services_moderator": lambda: moderator_signed_in(auth_env, "mod-s", SERVICES),
        "services_and_directory": lambda: moderator_signed_in(
            auth_env, "mod-sd", SERVICES, CategoryModule.DIRECTORY
        ),
    }[who]()

    for action, status in (
        ("accept", "accepted"),
        ("start", "in-progress"),
        ("complete", "completed"),
    ):
        response = staff_act(api, request_id, action)
        assert response.status_code == 200, (who, action, response.text)
        assert response.json()["data"]["status"] == status
        assert response.json()["data"]["viewerRole"] == "provider"

    assert status_of(w.resident, request_id) == "completed"


# =================================================================================================
# 5. Who cannot
# =================================================================================================


@pytest.mark.parametrize("scope", OTHER_SCOPES + [CategoryModule.NEWS], ids=lambda s: s.value)
def test_a_moderator_of_another_scope_cannot_touch_a_portal_request(
    auth_env: AuthEnv, scope: CategoryModule
) -> None:
    w, request_id = scene(auth_env)
    outsider = moderator_signed_in(auth_env, f"mod-{scope.value}", scope)
    before = (
        stored_request(auth_env.session, request_id)["status"],
        history_rows(auth_env.session, request_id),
    )

    queue = outsider.get(PORTAL_REQUESTS)
    one = outsider.get(f"{PORTAL_REQUESTS}/{request_id}")
    missing = outsider.get(f"{PORTAL_REQUESTS}/{uuid.uuid4()}")
    acts = [
        staff_act(outsider, request_id, action)
        for action in ("accept", "start", "complete", "cancel")
    ]

    if scope is CategoryModule.NEWS:
        # ``news`` confers no authority at all: the front door itself refuses (the same as no scope)
        assert queue.status_code == one.status_code == missing.status_code == 403
        assert [r.status_code for r in acts] == [403] * 4
    else:
        assert queue.status_code == 403  # a collection that exists only for services authority
        # an id is concealed: byte-identical to a request that does not exist
        assert one.status_code == missing.status_code == 404
        assert one.json()["error"]["code"] == missing.json()["error"]["code"] == "not_found"
        assert [r.status_code for r in acts] == [404] * 4
    after = (
        stored_request(auth_env.session, request_id)["status"],
        history_rows(auth_env.session, request_id),
    )
    assert after == before  # nothing changed


@pytest.mark.parametrize("who", ["resident", "professional", "unverified_admin"])
def test_a_non_staff_caller_cannot_use_the_portal_api(auth_env: AuthEnv, who: str) -> None:
    w, request_id = scene(auth_env)
    if who == "resident":
        api = requester_signed_in(auth_env, "other@example.org")
    elif who == "professional":
        api = signed_in(auth_env, "pro@example.org", professional=PlanCode.PREMIUM)
    else:
        make_account(auth_env.session, "ua@example.org", admin=True, verified=False)
        api = auth_env.client()
        api.login("ua@example.org")

    for response in (
        api.get(PORTAL_REQUESTS),
        api.get(f"{PORTAL_REQUESTS}/{request_id}"),
        staff_act(api, request_id, "accept"),
        staff_act(api, request_id, "cancel"),
    ):
        assert response.status_code == 403, (who, response.text)
    assert status_of(w.resident, request_id) == "submitted"


def test_the_requester_cannot_handle_their_own_request_as_the_portal(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)

    for action in ("accept", "start", "complete", "cancel"):
        assert staff_act(w.resident, request_id, action).status_code == 403
    assert status_of(w.resident, request_id) == "submitted"


# =================================================================================================
# 6-7. Nothing depends on a person: removal, demotion, re-scoping, another staff member
# =================================================================================================


def test_the_moderator_who_authored_the_provider_can_be_removed_and_the_request_stays_manageable(
    auth_env: AuthEnv,
) -> None:
    boss = super_admin(auth_env)
    email = "author-mod@example.org"
    make_account(auth_env.session, email, moderator_scopes=[SERVICES])
    author = auth_env.client()
    assert author.login(email).status_code == 200
    listing_id = approved_provider(auth_env, author)
    resident = requester_signed_in(auth_env)
    request_id = sent_id(resident, listing_id)
    author_id = user_id(auth_env, email)

    assert remove(boss, author_id).status_code == 204  # a real RBAC-C removal

    assert staff_act(author, request_id, "accept").status_code == 401  # their sessions are gone
    accepted = staff_act(boss, request_id, "accept")
    assert accepted.status_code == 200, accepted.text
    assert staff_act(boss, request_id, "start").status_code == 200
    assert staff_act(boss, request_id, "complete").status_code == 200
    assert status_of(resident, request_id) == "completed"


def test_demoting_the_staff_member_who_started_the_work_does_not_strand_it(
    auth_env: AuthEnv,
) -> None:
    w, request_id = scene(auth_env)
    worker = moderator_signed_in(auth_env, "mod-worker", SERVICES)
    assert staff_act(worker, request_id, "accept").status_code == 200
    auth_env.session.execute(
        text(
            "DELETE FROM user_roles WHERE role = 'moderator' AND user_id = "
            "(SELECT id FROM users WHERE email = 'mod-worker@example.org')"
        )
    )
    auth_env.session.commit()

    assert staff_act(worker, request_id, "start").status_code == 403  # no staff role now
    assert staff_act(w.author, request_id, "start").status_code == 200  # someone else carries on
    assert staff_act(w.author, request_id, "complete").status_code == 200


def test_another_authorised_staff_member_can_decline_a_request(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)
    first = moderator_signed_in(auth_env, "mod-first", SERVICES)
    second = moderator_signed_in(auth_env, "mod-second", SERVICES)

    assert staff_act(first, request_id, "accept").status_code == 200
    declined = staff_act(second, request_id, "cancel")  # the provider-side "decline / stop"

    assert declined.status_code == 200 and declined.json()["data"]["status"] == "cancelled"
    assert status_of(w.resident, request_id) == "cancelled"
    assert staff_act(first, request_id, "cancel").status_code == 409  # terminal


def test_a_moderator_who_lost_services_keeps_other_scopes_but_loses_the_portal(
    auth_env: AuthEnv,
) -> None:
    boss = super_admin(auth_env)
    w, request_id = scene(auth_env)
    email = "scoped@example.org"
    make_account(auth_env.session, email, moderator_scopes=[SERVICES, CategoryModule.DIRECTORY])
    moderator = auth_env.client()
    assert moderator.login(email).status_code == 200
    assert moderator.get(PORTAL_REQUESTS).status_code == 200
    target = user_id(auth_env, email)

    replaced = boss.request("PUT", f"{MODERATORS}/{target}/scopes", json={"scopes": ["directory"]})
    assert replaced.status_code == 200, replaced.text
    fresh = auth_env.client()  # their old session was revoked with the scope change
    assert fresh.login(email).status_code == 200

    assert fresh.get(PORTAL_REQUESTS).status_code == 403  # the collection: services authority only
    assert fresh.get(f"{PORTAL_REQUESTS}/{request_id}").status_code == 404  # an id: concealed
    assert staff_act(fresh, request_id, "accept").status_code == 404
    assert status_of(w.resident, request_id) == "submitted"


def test_a_paused_moderator_cannot_use_the_portal(auth_env: AuthEnv) -> None:
    boss = super_admin(auth_env)
    w, request_id = scene(auth_env)
    email = "pausable@example.org"
    make_account(auth_env.session, email, moderator_scopes=[SERVICES])
    moderator = auth_env.client()
    assert moderator.login(email).status_code == 200

    assert boss.request("POST", f"{MODERATORS}/{user_id(auth_env, email)}/pause").status_code == 200

    for response in (
        moderator.get(PORTAL_REQUESTS),
        staff_act(moderator, request_id, "accept"),
    ):
        assert response.status_code in (401, 403), response.text
    assert status_of(w.resident, request_id) == "submitted"


def test_a_demoted_super_admin_loses_the_portal_at_once(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)
    auth_env.session.execute(
        text(
            "DELETE FROM user_roles WHERE role = 'admin' AND user_id = "
            "(SELECT id FROM users WHERE email = 'provider@example.org')"
        )
    )
    auth_env.session.commit()

    assert w.author.get(PORTAL_REQUESTS).status_code == 403
    assert staff_act(w.author, request_id, "accept").status_code == 403
    assert status_of(w.resident, request_id) == "submitted"


# =================================================================================================
# 9, 11. The requester's side, and who is recorded
# =================================================================================================


def test_the_history_records_the_actual_staff_actor_in_the_provider_capacity(
    auth_env: AuthEnv,
) -> None:
    w, request_id = scene(auth_env)
    moderator = moderator_signed_in(auth_env, "mod-actor", SERVICES)
    requester_id = user_id(auth_env, "resident@example.org")
    admin_id = user_id(auth_env, "provider@example.org")
    moderator_id = user_id(auth_env, "mod-actor@example.org")

    assert staff_act(w.author, request_id, "accept").status_code == 200
    assert staff_act(moderator, request_id, "start").status_code == 200
    assert staff_act(w.author, request_id, "complete").status_code == 200

    assert history_actors(auth_env, request_id) == [
        (requester_id, "requester"),
        (admin_id, "provider"),
        (moderator_id, "provider"),  # the ACTUAL actor: never the author, never a stand-in
        (admin_id, "provider"),
    ]
    # the requester sees the role, never the account behind it
    story = detail(w.resident, request_id)["history"]
    assert [h["actorRole"] for h in story] == ["requester", "provider", "provider", "provider"]
    assert str(moderator_id) not in str(story) and "mod-actor" not in str(story)


def test_handling_a_request_writes_one_history_row_and_no_staff_audit_row(
    auth_env: AuthEnv,
) -> None:
    """The request history IS the audit of request handling (it carries the real actor); the staff
    audit's closed vocabulary is for authority and Provider changes."""
    w, request_id = scene(auth_env)
    audit_before = audit_count(auth_env.session)
    rows_before = len(history_rows(auth_env.session, request_id))

    assert staff_act(w.author, request_id, "accept").status_code == 200

    assert len(history_rows(auth_env.session, request_id)) == rows_before + 1
    assert audit_count(auth_env.session) == audit_before


def test_the_requester_still_cancels_correctly_alongside_the_portal(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)
    assert staff_act(w.author, request_id, "accept").status_code == 200

    cancelled = act(w.resident, request_id, "cancel")

    assert cancelled.status_code == 200 and cancelled.json()["data"]["viewerRole"] == "requester"
    assert history_rows(auth_env.session, request_id)[-1] == ("accepted", "cancelled", "requester")
    assert staff_act(w.author, request_id, "start").status_code == 409  # terminal now


def test_each_request_is_handled_independently_of_the_others(auth_env: AuthEnv) -> None:
    w = world(auth_env)
    other_listing = approved_provider(auth_env, w.author, name="Second Provider Co")
    other = requester_signed_in(auth_env, "other@example.org")
    mine, theirs, third = (
        sent_id(w.resident, w.listing_id),
        sent_id(other, w.listing_id),
        sent_id(w.resident, other_listing),
    )

    assert staff_act(w.author, mine, "accept").status_code == 200

    assert status_of(other, theirs) == "submitted" and status_of(w.resident, third) == "submitted"


# =================================================================================================
# Forged input, atomicity
# =================================================================================================


@pytest.mark.parametrize(
    "field", ["status", "requesterId", "providerId", "ownerId", "actorUserId", "actorRole", "scope"]
)
def test_a_forged_field_in_a_portal_action_is_refused(auth_env: AuthEnv, field: str) -> None:
    w, request_id = scene(auth_env)

    response = staff_act(w.author, request_id, "accept", json={field: "x"})

    assert response.status_code == 422
    assert (field, "not_allowed") in [
        (d["field"], d["code"]) for d in response.json()["error"]["details"]
    ]
    assert status_of(w.resident, request_id) == "submitted"


def test_csrf_and_origin_protect_every_portal_write(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)

    for action in ("accept", "start", "complete", "cancel"):
        for tamper in (
            {"csrf": None},
            {"csrf": "wrong"},
            {"origin": None},
            {"origin": "https://evil.example"},
        ):
            response = staff_act(w.author, request_id, action, **tamper)
            assert response.status_code == 403, (action, tamper, response.text)
    assert status_of(w.resident, request_id) == "submitted"


def test_a_failure_while_recording_the_history_rolls_the_whole_action_back(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    w, request_id = scene(auth_env)

    def boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("history store unavailable")

    monkeypatch.setattr(ServiceRequestRepository, "record_history", boom)
    response = staff_act(w.author, request_id, "accept")
    monkeypatch.undo()

    assert response.status_code == 500
    assert status_of(w.resident, request_id) == "submitted"  # the status change rolled back too
    assert history_rows(auth_env.session, request_id) == [(None, "submitted", "requester")]
    assert staff_act(w.author, request_id, "accept").status_code == 200  # and it can be retried


def test_the_portal_api_is_never_cached(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)
    anonymous = auth_env.client()

    for response in (
        w.author.get(PORTAL_REQUESTS),
        w.author.get(f"{PORTAL_REQUESTS}/{request_id}"),
        staff_act(w.author, request_id, "accept"),
        anonymous.get(PORTAL_REQUESTS),
    ):
        assert response.headers["cache-control"] == "no-store"


def test_staff_detail_helper_matches_the_api_shape(auth_env: AuthEnv) -> None:
    w, request_id = scene(auth_env)

    data = staff_detail(w.author, request_id)

    assert data["viewerRole"] == "provider" and data["requesterName"] == "Rana Resident"
    assert isinstance(w.author, AuthApi)
