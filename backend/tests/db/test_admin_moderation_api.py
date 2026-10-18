"""POST /admin/listings/{id}/approve and /reject (Phase 12E): approve, reject and the approved ->
rejected takedown (docs/backend/API_CONTRACT.md §10.3-§10.4).

Moderation acts ON the reviewed revision and never changes it; a stale revision is
``409 listing_conflict``, a wrong status ``409 invalid_state_transition``, and nothing is written —
no status, no history row — by a refused decision. Real PostgreSQL, real app, real login.
"""

from typing import Any

import pytest

from app.models.enums import ListingStatus
from app.services.search_index import SearchIndexer
from tests.db.admin_helpers import (
    ADMIN_LISTINGS,
    admin_signed_in,
    age_history,
    approve,
    detail,
    history_of,
    owner_signed_in,
    pending,
    queue,
    reject,
)
from tests.db.auth_helpers import AuthEnv
from tests.db.test_listing_edit_api import snapshot
from tests.db.write_helpers import (
    archive,
    business_body,
    codes,
    error_code,
    exact,
    food_body,
    mine,
    patch,
    provider_body,
    set_status,
    stored_columns,
)

REASON = "Please add your opening hours and a clearer description."


def public_status(env: AuthEnv, listing_id: str) -> int:
    return env.client().get(f"/listings/{listing_id}").status_code


def found_in_search(env: AuthEnv, text: str) -> bool:
    return bool(env.client().get("/search", params={"q": text}).json()["data"])


def unchanged_after(env: AuthEnv, listing_id: str, before: dict[str, Any]) -> bool:
    return snapshot(env, listing_id) == before


# -- approve -----------------------------------------------------------------------------------------


def test_approving_a_pending_listing_makes_it_public(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, food_body(name="Approvable Bakery"))
    admin = admin_signed_in(auth_env)
    assert public_status(auth_env, listing_id) == 404 and not found_in_search(
        auth_env, "Approvable"
    )
    submitted_at = stored_columns(auth_env.session, listing_id)["submitted_at"]
    age_history(auth_env.session, listing_id)

    response = approve(admin, listing_id, 1)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["revision"]) == ("approved", 1)  # the revision is NOT bumped
    assert response.headers["Cache-Control"] == "no-store"
    assert public_status(auth_env, listing_id) == 200
    assert found_in_search(auth_env, "Approvable")
    assert stored_columns(auth_env.session, listing_id)["submitted_at"] == submitted_at
    assert history_of(data) == [
        ("submitted", None, "pending", 1),
        ("approved", "pending", "approved", 1),
    ]
    entry = data["history"][-1]
    assert entry["actor"] == {"displayName": "Site Admin", "role": "admin"}
    assert "reason" not in entry
    assert mine(owner, listing_id)["status"] == "approved"


def test_approval_writes_the_admin_as_the_actor_in_the_stored_history(auth_env: AuthEnv) -> None:
    from tests.db.write_helpers import history

    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    admin = admin_signed_in(auth_env)
    admin_id = admin.me().json()["data"]["id"]

    approve(admin, listing_id, 1)

    last = history(auth_env.session, listing_id)[-1]
    assert (str(last.actor_user_id), last.actor_role.value, last.reason) == (
        admin_id,
        "admin",
        None,
    )
    assert (last.from_status, last.to_status.value, last.action.value) == (
        ListingStatus.PENDING, "approved", "approved",
    )  # fmt: skip


@pytest.mark.parametrize(
    "status", [ListingStatus.APPROVED, ListingStatus.REJECTED, ListingStatus.ARCHIVED]
)
def test_only_a_pending_listing_can_be_approved(auth_env: AuthEnv, status: ListingStatus) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    set_status(auth_env.session, listing_id, status)
    admin = admin_signed_in(auth_env)
    before = snapshot(auth_env, listing_id)

    response = approve(admin, listing_id, 1)

    assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")
    assert unchanged_after(auth_env, listing_id, before)


def test_a_double_approval_by_two_admins_is_refused_the_second_time(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    first = admin_signed_in(auth_env, "admin1@example.org")
    second = admin_signed_in(auth_env, "admin2@example.org")

    assert approve(first, listing_id, 1).status_code == 200
    again = approve(second, listing_id, 1)

    assert (again.status_code, error_code(again)) == (409, "invalid_state_transition")
    assert len([h for h in detail(first, listing_id)["history"] if h["action"] == "approved"]) == 1


def test_a_stale_revision_cannot_approve_newer_content(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    admin = admin_signed_in(auth_env)
    reviewed = detail(admin, listing_id)["revision"]
    assert patch(owner, listing_id, 1, name="Rewritten After Review").status_code == 200
    before = snapshot(auth_env, listing_id)

    stale = approve(admin, listing_id, reviewed)

    assert (stale.status_code, error_code(stale)) == (409, "listing_conflict")
    assert codes(stale) == [("revision", "stale_revision")]
    assert "current revision is 2" in stale.json()["error"]["details"][0]["message"]
    assert unchanged_after(auth_env, listing_id, before)
    assert public_status(auth_env, listing_id) == 404
    # ... reload the current revision and decide on what is actually there
    assert approve(admin, listing_id, detail(admin, listing_id)["revision"]).status_code == 200
    assert public_status(auth_env, listing_id) == 200


def test_a_privacy_narrowing_bumps_the_revision_so_an_old_approval_is_refused(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, business_body(location=exact()))
    admin = admin_signed_in(auth_env)
    reviewed = detail(admin, listing_id)["revision"]
    assert patch(owner, listing_id, 1, location=exact(visibility="approximate")).status_code == 200

    response = approve(admin, listing_id, reviewed)

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")
    assert mine(owner, listing_id)["status"] == "pending"


def test_a_future_revision_is_a_conflict_too(auth_env: AuthEnv) -> None:
    listing_id = pending(owner_signed_in(auth_env), provider_body())

    response = approve(admin_signed_in(auth_env), listing_id, 9)

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")


def test_an_invalid_status_is_reported_before_a_stale_revision(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    set_status(auth_env.session, listing_id, ListingStatus.ARCHIVED)

    response = approve(admin_signed_in(auth_env), listing_id, 77)

    assert error_code(response) == "invalid_state_transition"


@pytest.mark.parametrize("listing_id", ["00000000-0000-4000-8000-000000000000", "nope", "42"])
def test_moderating_something_that_does_not_exist_is_404(
    auth_env: AuthEnv, listing_id: str
) -> None:
    admin = admin_signed_in(auth_env)

    for response in (approve(admin, listing_id, 1), reject(admin, listing_id, 1)):
        assert (response.status_code, error_code(response)) == (404, "not_found")


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({}, [("revision", "missing")]),
        ({"revision": "1"}, [("revision", "int_type")]),
        ({"revision": 0}, [("revision", "greater_than_equal")]),
        ({"revision": 1, "status": "approved"}, [("status", "not_allowed")]),
        ({"revision": 1, "reason": "x"}, [("reason", "not_allowed")]),
        ({"revision": 1, "moderatedBy": "me"}, [("moderatedBy", "not_allowed")]),
    ],
)
def test_the_approve_body_is_exactly_the_reviewed_revision(
    auth_env: AuthEnv, body: dict[str, Any], expected: list[tuple[str, str]]
) -> None:
    listing_id = pending(owner_signed_in(auth_env), provider_body())
    admin = admin_signed_in(auth_env)

    response = admin.request("POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json=body)

    assert response.status_code == 422 and codes(response) == expected
    assert detail(admin, listing_id)["status"] == "pending"


def test_approval_does_not_touch_the_content_or_the_search_document(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, food_body())
    admin = admin_signed_in(auth_env)
    before = stored_columns(auth_env.session, listing_id)

    approve(admin, listing_id, 1)

    after = stored_columns(auth_env.session, listing_id)
    for column in (
        "title",
        "description",
        "area",
        "tags",
        "search_document",
        "latitude",
        "longitude",
        "address",
        "location_visibility",
        "revision",
        "submitted_at",
    ):
        assert after[column] == before[column], column  # fmt: skip
    assert SearchIndexer(auth_env.session).find_stale() == []


def test_an_admin_may_moderate_their_own_listing(auth_env: AuthEnv) -> None:
    """No separation-of-duties rule is frozen (an Admin has no implicit ownership either way)."""
    from tests.db.write_helpers import signed_in

    both = signed_in(auth_env, "both@example.org", admin=True)
    listing_id = pending(both, provider_body())

    assert approve(both, listing_id, 1).status_code == 200


# -- reject ------------------------------------------------------------------------------------------


def test_rejecting_a_pending_listing_keeps_it_private_and_tells_the_owner_why(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Rejectable Electricians"))
    admin = admin_signed_in(auth_env)
    age_history(auth_env.session, listing_id)

    response = reject(admin, listing_id, 1, REASON)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["revision"], data["rejectionReason"]) == ("rejected", 1, REASON)
    assert history_of(data) == [
        ("submitted", None, "pending", 1),
        ("rejected", "pending", "rejected", 1),
    ]
    assert data["history"][-1]["reason"] == REASON
    assert public_status(auth_env, listing_id) == 404 and not found_in_search(
        auth_env, "Rejectable"
    )
    seen_by_owner = mine(owner, listing_id)
    assert (seen_by_owner["status"], seen_by_owner["rejectionReason"]) == ("rejected", REASON)
    assert owner.get("/users/me/listings").json()["data"][0]["rejectionReason"] == REASON


def test_the_reason_is_normalised_before_it_is_stored_and_shown(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    admin = admin_signed_in(auth_env)

    reject(admin, listing_id, 1, "  Add   the\thours.\r\n\r\n\r\n\r\nAnd a   photo.  ")

    assert mine(owner, listing_id)["rejectionReason"] == "Add the hours.\n\nAnd a photo."


@pytest.mark.parametrize(
    ("reason", "code"),
    [
        ("", "string_too_short"),
        ("short", "too_short"),
        ("123456789", "too_short"),
        ("ok" + " " * 40 + "now", "too_short"),  # long only until it is normalised
        ("x" * 501, "too_long"),
    ],
)
def test_a_missing_short_or_oversized_reason_is_refused_and_nothing_is_written(
    auth_env: AuthEnv, reason: str, code: str
) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    admin = admin_signed_in(auth_env)
    before = snapshot(auth_env, listing_id)

    response = reject(admin, listing_id, 1, reason)

    assert response.status_code == 422
    assert codes(response) == [("reason", code)]
    assert unchanged_after(auth_env, listing_id, before)


def test_a_reason_is_required_and_must_be_printable(auth_env: AuthEnv) -> None:
    listing_id = pending(owner_signed_in(auth_env), provider_body())
    admin = admin_signed_in(auth_env)
    url = f"{ADMIN_LISTINGS}/{listing_id}/reject"

    assert codes(admin.request("POST", url, json={"revision": 1})) == [("reason", "missing")]
    assert admin.request("POST", url, json={"revision": 1, "reason": None}).status_code == 422
    assert (
        admin.request(
            "POST", url, json={"revision": 1, "reason": "has a \x00 byte in it"}
        ).status_code
        == 422
    )
    assert detail(admin, listing_id)["status"] == "pending"


def test_exactly_ten_characters_is_a_valid_reason(auth_env: AuthEnv) -> None:
    listing_id = pending(owner_signed_in(auth_env), provider_body())

    response = reject(admin_signed_in(auth_env), listing_id, 1, "x" * 10)

    assert response.status_code == 200


@pytest.mark.parametrize("status", [ListingStatus.REJECTED, ListingStatus.ARCHIVED])
def test_a_rejected_or_archived_listing_cannot_be_rejected(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    set_status(auth_env.session, listing_id, status)
    before = snapshot(auth_env, listing_id)

    response = reject(admin_signed_in(auth_env), listing_id, 1)

    assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")
    assert unchanged_after(auth_env, listing_id, before)


def test_a_stale_revision_cannot_reject_newer_content(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    admin = admin_signed_in(auth_env)
    patch(owner, listing_id, 1, name="Rewritten After Review")
    before = snapshot(auth_env, listing_id)

    response = reject(admin, listing_id, 1)

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")
    assert unchanged_after(auth_env, listing_id, before)


@pytest.mark.parametrize("extra", ["status", "ownerId", "moderatedBy", "action"])
def test_the_reject_body_refuses_everything_but_revision_and_reason(
    auth_env: AuthEnv, extra: str
) -> None:
    listing_id = pending(owner_signed_in(auth_env), provider_body())
    admin = admin_signed_in(auth_env)

    response = admin.request(
        "POST", f"{ADMIN_LISTINGS}/{listing_id}/reject",
        json={"revision": 1, "reason": REASON, extra: "x"},
    )  # fmt: skip

    assert response.status_code == 422 and (extra, "not_allowed") in codes(response)


def test_the_full_cycle_reject_fix_resubmit_approve(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, food_body(name="Cycle Bakery"))
    admin = admin_signed_in(auth_env)
    age_history(auth_env.session, listing_id, 30)
    assert reject(admin, listing_id, 1, REASON).status_code == 200
    # an unedited resubmission is refused, a rejected listing cannot be approved directly
    assert patch(owner, listing_id, 1).status_code == 422
    assert error_code(approve(admin, listing_id, 1)) == "invalid_state_transition"
    age_history(auth_env.session, listing_id, 20)

    fixed = patch(owner, listing_id, 1, food={"hoursNote": "Daily, 8 AM-11 PM"})

    assert fixed.json()["data"]["status"] == "pending" and fixed.json()["data"]["revision"] == 2
    assert "rejectionReason" not in mine(owner, listing_id)  # it ceases to apply
    old = approve(admin, listing_id, 1)
    assert (old.status_code, error_code(old)) == (
        409,
        "listing_conflict",
    )  # the reviewed copy is gone
    age_history(auth_env.session, listing_id, 10)
    assert approve(admin, listing_id, 2).status_code == 200
    assert public_status(auth_env, listing_id) == 200 and found_in_search(auth_env, "Cycle Bakery")
    assert history_of(detail(admin, listing_id)) == [
        ("submitted", None, "pending", 1),
        ("rejected", "pending", "rejected", 1),
        ("resubmitted", "rejected", "pending", 2),
        ("approved", "pending", "approved", 2),
    ]


# -- takedown (approved -> rejected) ---------------------------------------------------------------------


def approved_listing(env: AuthEnv, owner: Any, admin: Any, body: dict[str, Any]) -> str:
    listing_id = pending(owner, body)
    assert approve(admin, listing_id, 1).status_code == 200
    age_history(env.session, listing_id, 30)
    return listing_id


def test_an_approved_listing_can_be_taken_down_and_disappears_at_once(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = approved_listing(auth_env, owner, admin, food_body(name="Takedown Bakery"))
    anonymous = auth_env.client()
    assert found_in_search(auth_env, "Takedown") and public_status(auth_env, listing_id) == 200
    assert anonymous.get("/search/suggestions", params={"q": "Takedown"}).json()["data"]

    response = reject(admin, listing_id, 1, "Reported as closed; please confirm you still trade.")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["revision"]) == ("rejected", 1)
    assert history_of(data)[-1] == ("rejected", "approved", "rejected", 1)
    assert public_status(auth_env, listing_id) == 404
    assert not found_in_search(auth_env, "Takedown")
    assert anonymous.get("/search/suggestions", params={"q": "Takedown"}).json()["data"] == []
    assert (
        anonymous.get("/search", params={"q": "bakeries", "vertical": "food"}).json()["data"] == []
    )
    seen = mine(owner, listing_id)
    assert seen["status"] == "rejected" and "closed" in seen["rejectionReason"]


def test_a_takedown_needs_a_reason_and_the_current_revision(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = approved_listing(auth_env, owner, admin, provider_body())
    before = snapshot(auth_env, listing_id)

    no_reason = reject(admin, listing_id, 1, "too short")
    stale = reject(admin, listing_id, 7)

    assert no_reason.status_code == 422
    assert (stale.status_code, error_code(stale)) == (409, "listing_conflict")
    assert unchanged_after(auth_env, listing_id, before)
    assert public_status(auth_env, listing_id) == 200  # still public: nothing happened


def test_a_taken_down_listing_stays_down_until_the_owner_edits_and_it_is_approved_again(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = approved_listing(
        auth_env, owner, admin, provider_body(name="Comeback Electricians")
    )
    reject(admin, listing_id, 1, "Reported as closed; please confirm you still trade.")
    age_history(auth_env.session, listing_id, 20)

    assert error_code(approve(admin, listing_id, 1)) == "invalid_state_transition"
    assert (
        error_code(reject(admin, listing_id, 1)) == "invalid_state_transition"
    )  # no second takedown
    assert patch(owner, listing_id, 1, tags=["open", "again"]).json()["data"]["status"] == "pending"
    age_history(auth_env.session, listing_id, 10)
    assert approve(admin, listing_id, 2).status_code == 200
    assert found_in_search(auth_env, "Comeback")


def test_an_archived_listing_cannot_be_taken_down_or_approved(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = approved_listing(auth_env, owner, admin, provider_body())
    assert archive(owner, listing_id, 1).status_code == 200

    for response in (reject(admin, listing_id, 2), approve(admin, listing_id, 2)):
        assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")


def test_an_edit_after_the_review_makes_a_takedown_with_the_old_revision_a_conflict(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = approved_listing(auth_env, owner, admin, provider_body())
    reviewed = detail(admin, listing_id)["revision"]
    patch(owner, listing_id, 1, name="Changed After The Admin Looked")  # approved -> pending, rev 2

    stale = reject(
        admin, listing_id, reviewed, "Reported as closed; please confirm you still trade."
    )

    assert (stale.status_code, error_code(stale)) == (409, "listing_conflict")
    assert detail(admin, listing_id)["status"] == "pending"


# -- public / owner / search regression -------------------------------------------------------------------


def test_public_visibility_follows_the_moderation_status_exactly(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    seen: list[tuple[str, int]] = []

    listing_id = pending(owner, provider_body(name="Visibility Probe"))
    seen.append(("pending", public_status(auth_env, listing_id)))
    approve(admin, listing_id, 1)
    seen.append(("approved", public_status(auth_env, listing_id)))
    reject(admin, listing_id, 1, REASON)
    seen.append(("rejected", public_status(auth_env, listing_id)))
    patch(owner, listing_id, 1, tags=["visible"])
    seen.append(("pending again", public_status(auth_env, listing_id)))
    approve(admin, listing_id, 2)
    seen.append(("approved again", public_status(auth_env, listing_id)))
    archive(owner, listing_id, 2)
    seen.append(("archived", public_status(auth_env, listing_id)))

    assert seen == [
        ("pending", 404), ("approved", 200), ("rejected", 404), ("pending again", 404),
        ("approved again", 200), ("archived", 404),
    ]  # fmt: skip


def test_a_refused_decision_changes_nothing_anyone_can_see(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Untouched Probe"))
    patch(owner, listing_id, 1, tags=["moved", "on"])
    before = snapshot(auth_env, listing_id)

    assert approve(admin, listing_id, 1).status_code == 409
    assert reject(admin, listing_id, 1, REASON).status_code == 409

    assert unchanged_after(auth_env, listing_id, before)
    assert public_status(auth_env, listing_id) == 404
    assert queue(admin, status="pending").json()["meta"]["counts"]["pending"] == 1


def test_the_owner_still_sees_every_status_with_its_revision_and_reason(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    a = pending(owner, provider_body(name="Owner View A"))
    b = pending(owner, provider_body(name="Owner View B"))
    c = pending(owner, provider_body(name="Owner View C"))
    d = pending(owner, provider_body(name="Owner View D"))
    approve(admin, a, 1)
    reject(admin, b, 1, REASON)
    archive(owner, d, 1)

    listing = owner.get("/users/me/listings").json()

    assert listing["meta"]["counts"] == {"pending": 1, "approved": 1, "rejected": 1, "archived": 1}
    by_id = {item["id"]: item for item in listing["data"]}
    assert (by_id[a]["status"], by_id[b]["status"], by_id[c]["status"]) == (
        "approved",
        "rejected",
        "pending",
    )
    assert by_id[b]["rejectionReason"] == REASON and by_id[d]["status"] == "archived"
    assert all(item["revision"] >= 1 for item in by_id.values())


def test_taking_a_listing_down_removes_its_text_from_every_public_surface(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = approved_listing(
        auth_env,
        owner,
        admin,
        business_body(name="Surface Probe Stationers", location=exact(address="Gulab Lane 12")),
    )
    anonymous = auth_env.client()
    assert anonymous.get("/search", params={"q": "Gulab Lane"}).json()["data"]

    reject(admin, listing_id, 1, "Reported as closed; please confirm you still trade.")

    for text in ("Surface Probe", "Gulab Lane", "grocery"):
        assert anonymous.get("/search", params={"q": text}).json()["data"] == [], text
    assert anonymous.get(f"/listings/{listing_id}").status_code == 404
    assert SearchIndexer(auth_env.session).find_stale() == []
