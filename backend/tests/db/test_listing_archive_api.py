"""POST /listings/{id}/archive (Phase 12D): terminal, owner-only, guarded by the revision.

The row is never deleted; the listing leaves public discovery and frees the plan's quota slot;
there is no unarchive.
"""

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, select

from app.models import Listing, ListingCategory
from app.models.enums import ActorRole, HistoryAction, ListingStatus
from tests.db.auth_helpers import START, AuthEnv
from tests.db.test_listing_edit_api import legacy_listing, snapshot
from tests.db.write_helpers import (
    LISTINGS,
    archive,
    business_body,
    codes,
    create,
    created_id,
    error_code,
    food_body,
    history,
    mine,
    patch,
    provider_body,
    set_status,
    signed_in,
    stored,
)

STATUSES = [ListingStatus.PENDING, ListingStatus.APPROVED, ListingStatus.REJECTED]


@pytest.mark.parametrize("status", STATUSES)
def test_the_owner_archives_a_listing_in_any_live_status(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())
    set_status(auth_env.session, listing_id, status)
    submitted_at = snapshot(auth_env, listing_id)["submitted_at"]
    auth_env.clock.advance(days=1)

    response = archive(api, listing_id, 1)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["revision"]) == ("archived", 2)
    assert response.headers["Cache-Control"] == "no-store"
    after = snapshot(auth_env, listing_id)
    assert after["submitted_at"] == submitted_at
    last = history(auth_env.session, listing_id)[-1]
    assert (last.action, last.from_status, last.to_status, last.revision) == (
        HistoryAction.ARCHIVED,
        status,
        ListingStatus.ARCHIVED,
        2,
    )
    assert last.actor_role is ActorRole.OWNER


def test_archiving_never_deletes_the_row_or_its_children(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())

    archive(api, listing_id, 1)

    auth_env.session.expire_all()
    assert auth_env.session.scalar(select(func.count()).select_from(Listing)) == 1
    assert auth_env.session.scalar(select(func.count()).select_from(ListingCategory)) == 2
    detail = mine(api, listing_id)  # the owner can still read it
    assert detail["status"] == "archived" and detail["food"]["categories"] == ["bakeries", "cafes"]
    assert stored(auth_env.session, listing_id).business is not None


def test_an_archived_listing_leaves_public_discovery(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    anonymous = auth_env.client()
    listing_id = created_id(api, business_body(name="Soon Archived Stationers"))
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    assert anonymous.get(f"/listings/{listing_id}").status_code == 200
    assert anonymous.get("/search", params={"q": "Soon Archived"}).json()["data"]

    archive(api, listing_id, 1)

    assert anonymous.get(f"/listings/{listing_id}").status_code == 404
    assert anonymous.get("/search", params={"q": "Soon Archived"}).json()["data"] == []
    assert anonymous.get("/search/suggestions", params={"q": "Soon Archived"}).json()["data"] == []


def test_a_stale_revision_conflicts_and_changes_nothing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    patch(api, listing_id, 1, name="Edited Meanwhile")
    before = snapshot(auth_env, listing_id)

    response = archive(api, listing_id, 1)

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")
    assert codes(response) == [("revision", "stale_revision")]
    assert snapshot(auth_env, listing_id) == before
    assert archive(api, listing_id, 2).status_code == 200


def test_an_archived_listing_cannot_be_archived_again_or_edited(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    archive(api, listing_id, 1)
    before = snapshot(auth_env, listing_id)

    again = archive(api, listing_id, 2)
    stale_again = archive(api, listing_id, 1)
    edit = patch(api, listing_id, 2, name="Zombie Listing Name")

    for response in (again, stale_again, edit):
        assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")
    assert snapshot(auth_env, listing_id) == before


def test_there_is_no_unarchive_and_status_is_not_writable(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    archive(api, listing_id, 1)

    for path in ("unarchive", "restore", "reopen", "approve", "reject", "resubmit", "submit"):
        response = api.request("POST", f"{LISTINGS}/{listing_id}/{path}", json={"revision": 2})
        assert response.status_code in (404, 405), path
    assert patch(api, listing_id, 2, status="pending").status_code == 422
    assert mine(api, listing_id)["status"] == "archived"


def test_a_non_owner_cannot_archive_and_learns_nothing(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner@example.org", display_name="Own Er")
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er")
    listing_id = created_id(owner, provider_body())
    before = snapshot(auth_env, listing_id)

    foreign = archive(other, listing_id, 1)
    missing = archive(other, "00000000-0000-4000-8000-000000000000", 1)
    malformed = archive(other, "nope", 1)

    assert {foreign.status_code, missing.status_code, malformed.status_code} == {404}
    assert foreign.json() == {
        **missing.json(),
        "error": {**missing.json()["error"], "requestId": foreign.json()["error"]["requestId"]},
    }
    assert snapshot(auth_env, listing_id) == before


def test_archiving_frees_the_quota_slot(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    ids = [created_id(api, provider_body()) for _ in range(3)]
    assert create(api, provider_body()).status_code == 403

    assert archive(api, ids[0], 1).status_code == 200

    assert create(api, provider_body()).status_code == 201


def test_a_legacy_listing_can_always_be_retired(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = legacy_listing(auth_env, api, kind="property")  # no point: invalid for edits

    response = archive(api, listing_id, 1)

    assert response.status_code == 200 and response.json()["data"]["status"] == "archived"


def test_the_archive_guards(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner@example.org", display_name="Own Er")
    listing_id = created_id(owner, provider_body())
    anonymous = auth_env.client()
    resident = signed_in(auth_env, "res@example.org", professional=None, display_name="Res Ident")
    unverified = signed_in(auth_env, "unv@example.org", verified=False, display_name="Unv Erified")

    assert archive(anonymous, listing_id, 1).status_code == 401
    assert error_code(archive(resident, listing_id, 1)) == "professional_profile_required"
    assert error_code(archive(unverified, listing_id, 1)) == "email_not_verified"
    assert mine(owner, listing_id)["status"] == "pending"


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({}, [("revision", "missing")]),
        ({"revision": 0}, [("revision", "greater_than_equal")]),
        ({"revision": "1"}, [("revision", "int_type")]),
        ({"revision": 1, "status": "archived"}, [("status", "not_allowed")]),
        ({"revision": 1, "reason": "no longer trading"}, [("reason", "not_allowed")]),
    ],
)
def test_the_archive_body_is_exactly_the_revision(
    auth_env: AuthEnv, body: dict[str, Any], expected: list[tuple[str, str]]
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())

    response = api.request("POST", f"{LISTINGS}/{listing_id}/archive", json=body)

    assert response.status_code == 422
    assert codes(response) == expected
    assert mine(api, listing_id)["status"] == "pending"


def test_archive_needs_origin_and_csrf(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    url = f"{LISTINGS}/{listing_id}/archive"

    for kwargs in (
        {"origin": None},
        {"csrf": None},
        {"csrf": "wrong"},
        {"origin": "https://evil.example.org"},
    ):
        response = api.request("POST", url, json={"revision": 1}, **kwargs)
        assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert mine(api, listing_id)["status"] == "pending"
    assert archive(api, listing_id, 1).status_code == 200


def test_archive_timestamps_use_the_app_clock_for_nothing_but_the_history_row(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    auth_env.clock.advance(days=3)

    archive(api, listing_id, 1)

    assert stored(auth_env.session, listing_id).submitted_at == START  # unchanged by archiving
    assert START + timedelta(days=3) > START
