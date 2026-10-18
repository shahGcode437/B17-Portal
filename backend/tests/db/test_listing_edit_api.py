"""PATCH /listings/{id} (Phase 12D): revision guard, ownership, PATCH semantics, no-op, resubmission,
the moderation-bypass matrix and search privacy after edits (API_CONTRACT §10.3-§10.4,
LOCATION_MAP §7.4).

Real PostgreSQL, the real app. Each test inspects the stored rows (status, revision, submitted_at,
history, search document), not only the response.
"""

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import FoodMenuItem, FoodProfile, ListingCategory
from app.models.enums import ActorRole, HistoryAction, ListingStatus, PlanCode
from app.services.search_index import SearchIndexer
from tests.db.auth_helpers import START, AuthApi, AuthEnv
from tests.db.write_helpers import (
    area_only,
    business_body,
    codes,
    created_id,
    error_code,
    exact,
    food_body,
    history,
    mine,
    patch,
    property_body,
    provider_body,
    set_status,
    signed_in,
    stored,
    stored_columns,
    tutor_body,
)

ADDRESS_TEXT = ("shop 4, main market", "opposite the mosque")


def snapshot(env: AuthEnv, listing_id: str) -> dict[str, Any]:
    columns = stored_columns(env.session, listing_id)
    columns["history"] = [
        (h.action, h.from_status, h.to_status, h.revision) for h in history(env.session, listing_id)
    ]
    return columns


def approved(env: AuthEnv, api: AuthApi, body: dict[str, Any]) -> str:
    listing_id = created_id(api, body)
    set_status(env.session, listing_id, ListingStatus.APPROVED)
    return listing_id


def resubmitted_rows(env: AuthEnv, listing_id: str) -> list[Any]:
    return [h for h in history(env.session, listing_id) if h.action is HistoryAction.RESUBMITTED]


# -- ownership and the revision guard ---------------------------------------------------------------


def test_the_owner_edits_a_pending_listing_which_stays_pending_and_is_resubmitted(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    auth_env.clock.advance(hours=3)

    response = patch(api, listing_id, 1, name="Brighter Spark Electricians")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["revision"], data["name"]) == (
        "pending",
        2,
        "Brighter Spark Electricians",
    )
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["submitted_at"] == START + timedelta(hours=3)  # reset: back of the queue
    assert "brighter spark" in columns["search_document"]
    assert "bright spark electricians" not in columns["search_document"]
    entries = history(auth_env.session, listing_id)
    assert [(e.action, e.from_status, e.to_status, e.revision) for e in entries] == [
        (HistoryAction.SUBMITTED, None, ListingStatus.PENDING, 1),
        (HistoryAction.RESUBMITTED, ListingStatus.PENDING, ListingStatus.PENDING, 2),
    ]
    assert entries[1].actor_role is ActorRole.OWNER


def test_a_stale_revision_is_a_conflict_and_changes_nothing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    assert patch(api, listing_id, 1, name="First Edit Name").status_code == 200
    before = snapshot(auth_env, listing_id)

    stale = patch(api, listing_id, 1, name="Lost Update Name")

    assert (stale.status_code, error_code(stale)) == (409, "listing_conflict")
    assert codes(stale) == [("revision", "stale_revision")]
    assert "current revision is 2" in stale.json()["error"]["details"][0]["message"]
    assert snapshot(auth_env, listing_id) == before
    assert patch(api, listing_id, 2, name="Second Edit Name").status_code == 200


@pytest.mark.parametrize("ahead", [2, 99])
def test_a_revision_from_the_future_is_also_a_conflict(auth_env: AuthEnv, ahead: int) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())

    response = patch(api, listing_id, 1 + ahead, name="Future Edit Name")

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")


def test_a_stale_revision_conflicts_even_when_the_edit_would_be_a_no_op(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    patch(api, listing_id, 1, name="A New Name")

    response = patch(api, listing_id, 1)

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")


def test_a_non_owner_gets_404_and_nothing_changes(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner@example.org", display_name="Own Er")
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er")
    listing_id = created_id(owner, provider_body())
    before = snapshot(auth_env, listing_id)

    response = patch(other, listing_id, 1, name="Hijacked Name")

    assert (response.status_code, error_code(response)) == (404, "not_found")
    assert snapshot(auth_env, listing_id) == before


def test_missing_malformed_and_foreign_ids_are_indistinguishable(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner@example.org", display_name="Own Er")
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er")
    listing_id = created_id(owner, provider_body())

    foreign = patch(other, listing_id, 1, name="Hijacked Name")
    missing = patch(other, "00000000-0000-4000-8000-000000000000", 1, name="Hijacked Name")
    malformed = patch(other, "not-a-uuid", 1, name="Hijacked Name")

    assert {foreign.status_code, missing.status_code, malformed.status_code} == {404}
    assert foreign.json()["error"]["code"] == missing.json()["error"]["code"] == "not_found"
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]
    assert foreign.json()["error"].get("details") == missing.json()["error"].get("details")


def test_an_archived_listing_cannot_be_edited(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    set_status(auth_env.session, listing_id, ListingStatus.ARCHIVED)

    response = patch(api, listing_id, 1, name="Back From The Dead")

    assert (response.status_code, error_code(response)) == (409, "invalid_state_transition")


# -- no-op ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("status", [ListingStatus.PENDING, ListingStatus.APPROVED])
def test_an_empty_patch_changes_nothing(auth_env: AuthEnv, status: ListingStatus) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())
    set_status(auth_env.session, listing_id, status)
    before = snapshot(auth_env, listing_id)
    auth_env.clock.advance(hours=5)

    response = patch(api, listing_id, 1)

    assert response.status_code == 200
    assert response.json()["data"]["revision"] == 1
    assert snapshot(auth_env, listing_id) == before  # status, revision, submitted_at, history, doc


def test_whitespace_and_case_differences_that_normalise_away_are_a_no_op(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    before = snapshot(auth_env, listing_id)

    response = patch(
        api,
        listing_id,
        1,
        name="  Sweet Crumbs Bakery  ",
        area=" b-17 ",
        tags=["CAKES", " bread "],
        location=exact(block=" B ", address="  Shop 4, Main Market "),
        food={"hoursNote": " Daily, 8 AM-10 PM ", "serviceOptions": ["delivery", "takeaway"]},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "approved"
    assert snapshot(auth_env, listing_id) == before


def test_a_no_op_does_not_resubmit_a_rejected_listing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED)
    before = snapshot(auth_env, listing_id)

    for body in ({}, {"name": "Bright Spark Electricians"}, {"tags": ["wiring", "repairs"]}):
        response = patch(api, listing_id, 1, **body)
        assert response.status_code == 422, body
        assert codes(response) == [("request", "no_changes")]
    assert snapshot(auth_env, listing_id) == before


# -- PATCH semantics ---------------------------------------------------------------------------------


def test_a_null_on_a_non_clearable_field_is_not_nullable(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    before = snapshot(auth_env, listing_id)

    for field in ("name", "description", "area", "tags", "location", "category"):
        response = patch(api, listing_id, 1, **{field: None})
        assert response.status_code == 422, field
        assert codes(response) == [(field, "not_nullable")], field
    assert snapshot(auth_env, listing_id) == before


def test_null_clears_only_the_declared_clearable_fields(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, property_body(image="/assets/house.png"))

    response = patch(api, listing_id, 1, image=None, bedrooms=None, furnished=None)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert "image" not in data and "bedrooms" not in data and "furnished" not in data
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["image_url"] is None
    prop = stored(auth_env.session, listing_id).property_profile
    assert prop is not None and prop.bedrooms is None and prop.furnished is None


def test_food_hours_and_menu_image_clear_with_null_but_the_arrays_do_not(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    body = food_body()
    body["food"]["menuImage"] = "/assets/menu.png"
    listing_id = created_id(api, body)

    cleared = patch(api, listing_id, 1, food={"hoursNote": None, "menuImage": None})
    bad = patch(api, listing_id, 2, food={"categories": None, "menuHighlights": None})

    food = cleared.json()["data"]["food"]
    assert "hoursNote" not in food and "menuImage" not in food
    assert food["categories"] == ["bakeries", "cafes"]  # untouched
    assert codes(bad) == [
        ("food.categories", "not_nullable"),
        ("food.menuHighlights", "not_nullable"),
    ]


def test_arrays_replace_whole_and_omitted_arrays_are_unchanged(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())

    response = patch(
        api,
        listing_id,
        1,
        tags=["new", "NEW", "tags"],
        food={"menuHighlights": [{"name": "Eclair"}]},
    )

    data = response.json()["data"]
    assert data["tags"] == ["new", "tags"]
    assert [item["name"] for item in data["food"]["menuHighlights"]] == ["Eclair"]
    assert data["food"]["serviceOptions"] == ["takeaway", "delivery"]  # omitted: unchanged
    assert data["food"]["categories"] == ["bakeries", "cafes"]
    menu = auth_env.session.scalars(select(FoodMenuItem)).all()
    assert [(m.position, m.name) for m in menu] == [(1, "Eclair")]


def test_the_menu_can_be_emptied_but_categories_cannot(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())

    emptied = patch(api, listing_id, 1, food={"menuHighlights": []})
    no_categories = patch(api, listing_id, 2, food={"categories": []})

    assert emptied.status_code == 200 and "menuHighlights" not in emptied.json()["data"]["food"]
    assert codes(no_categories) == [("food.categories", "required")]


def test_server_owned_fields_and_kind_are_rejected_on_patch(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())
    before = snapshot(auth_env, listing_id)

    for field in (
        "kind",
        "id",
        "ownerId",
        "status",
        "featured",
        "submittedAt",
        "rejectionReason",
        "publicLatitude",
        "moderatedBy",
        "approvedAt",
    ):
        response = patch(api, listing_id, 1, **{field: "business" if field == "kind" else "x"})
        assert response.status_code == 422, field
        assert (field, "not_allowed") in codes(response), field
    assert snapshot(auth_env, listing_id) == before


def test_a_field_the_listing_s_kind_does_not_have_is_not_allowed(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    provider = created_id(api, provider_body())
    prop = created_id(api, property_body())

    assert codes(patch(api, provider, 1, title="Not A Property")) == [("title", "not_allowed")]
    assert codes(patch(api, provider, 1, price="PKR 1")) == [("price", "not_allowed")]
    assert codes(patch(api, provider, 1, food={"hoursNote": "x"})) == [("food", "not_allowed")]
    assert codes(patch(api, prop, 1, name="Not A Provider")) == [("name", "not_allowed")]
    assert codes(patch(api, prop, 1, category="house")) == [("category", "not_allowed")]


def test_the_patch_result_must_be_a_complete_valid_listing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    prop = created_id(api, property_body())
    business = created_id(api, business_body())
    before = snapshot(auth_env, prop)

    assert codes(patch(api, prop, 1, location=area_only())) == [
        ("location.visibility", "not_allowed")
    ]
    assert codes(patch(api, prop, 1, location=exact(address=None))) == [
        ("location.address", "required")
    ]
    assert codes(patch(api, business, 1, vertical="food")) == [
        ("food.categories", "required"),
        ("food.serviceOptions", "required"),
    ]
    assert codes(patch(api, business, 1, category="no-such-category")) == [
        ("category", "unknown_category")
    ]
    assert codes(patch(api, business, 1, area="F-8")) == [("area", "unknown_locality")]
    assert codes(patch(api, business, 1, image="blob:https://x/1")) == [
        ("image", "invalid_media_reference")
    ]
    assert snapshot(auth_env, prop) == before


def test_a_location_block_without_a_visibility_on_a_business_is_rejected(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())

    response = patch(api, listing_id, 1, location={"block": "C"})

    assert codes(response) == [("location.visibility", "required")]


def test_the_location_block_replaces_the_stored_one_wholesale(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body(location=exact(landmark="Near the park")))

    response = patch(
        api,
        listing_id,
        1,
        location={"visibility": "exact", "address": "Shop 9", "latitude": 33.2, "longitude": 72.2},
    )

    location = response.json()["data"]["location"]
    assert location == {
        "visibility": "exact",
        "address": "Shop 9",
        "latitude": 33.2,
        "longitude": 72.2,
    }  # block and landmark were omitted, so they are cleared


# -- rejected: resubmission ---------------------------------------------------------------------------


def test_a_rejected_listing_is_resubmitted_by_an_effective_edit(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())
    set_status(
        auth_env.session, listing_id, ListingStatus.REJECTED, "Add your opening hours please."
    )
    assert mine(api, listing_id)["rejectionReason"] == "Add your opening hours please."
    auth_env.clock.advance(days=1)

    response = patch(api, listing_id, 1, food={"hoursNote": "Daily, 8 AM-11 PM"})

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["status"], data["revision"]) == ("pending", 2)
    assert "rejectionReason" not in data  # it ceases to apply
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["submitted_at"] == START + timedelta(days=1)
    assert [
        (h.action, h.from_status, h.to_status, h.revision)
        for h in history(auth_env.session, listing_id)
    ] == [
        (HistoryAction.SUBMITTED, None, ListingStatus.PENDING, 1),
        (HistoryAction.REJECTED, ListingStatus.PENDING, ListingStatus.REJECTED, 1),
        (HistoryAction.RESUBMITTED, ListingStatus.REJECTED, ListingStatus.PENDING, 2),
    ]


def test_a_narrowing_does_not_resubmit_a_rejected_listing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED)
    rows_before = len(history(auth_env.session, listing_id))

    response = patch(api, listing_id, 1, location=exact(visibility="approximate"))

    data = response.json()["data"]
    assert (data["status"], data["revision"]) == ("rejected", 2)
    assert data["rejectionReason"]
    assert len(history(auth_env.session, listing_id)) == rows_before


def test_a_rejected_resubmission_re_enters_the_quota(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    first, second, third = (created_id(api, provider_body(name=f"Provider {n}")) for n in "ABC")
    set_status(auth_env.session, first, ListingStatus.REJECTED)
    fourth = created_id(api, provider_body(name="Provider D"))  # the slot the rejection freed
    before = snapshot(auth_env, first)

    blocked = patch(api, first, 1, name="Provider A, fixed")

    assert (blocked.status_code, error_code(blocked)) == (403, "plan_limit_reached")
    assert snapshot(auth_env, first) == before  # still rejected, revision untouched
    set_status(auth_env.session, fourth, ListingStatus.ARCHIVED)
    assert patch(api, first, 1, name="Provider A, fixed").status_code == 200
    assert second and third


def test_pending_and_approved_edits_at_the_quota_limit_are_not_blocked(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    ids = [created_id(api, provider_body(name=f"Provider {n}")) for n in "ABC"]
    set_status(auth_env.session, ids[0], ListingStatus.APPROVED)

    assert patch(api, ids[0], 1, name="Provider A edited").status_code == 200
    assert patch(api, ids[1], 1, name="Provider B edited").status_code == 200


# -- approved: material edit ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        {"name": "A Different Name"},
        {"description": "A completely rewritten description of this business."},
        {"tags": ["different", "tags"]},
        {"image": "/assets/new.png"},
        {"category": "pharmacy"},
        {"location": exact(address="Shop 5, Main Market")},
        {"location": exact(latitude=33.2)},
        {"location": exact(block="C")},
        {"location": exact(landmark=None)},
    ],
)
def test_any_effective_edit_of_an_approved_listing_returns_it_to_pending(
    auth_env: AuthEnv, fields: dict[str, Any]
) -> None:
    api = signed_in(auth_env)
    listing_id = approved(auth_env, api, business_body())
    auth_env.clock.advance(hours=2)

    response = patch(api, listing_id, 1, **fields)

    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "pending"
    columns = stored_columns(auth_env.session, listing_id)
    assert (columns["status"], columns["revision"]) == ("pending", 2)
    assert columns["submitted_at"] == START + timedelta(hours=2)
    rows = resubmitted_rows(auth_env, listing_id)
    assert [(r.from_status, r.to_status, r.revision) for r in rows] == [
        (ListingStatus.APPROVED, ListingStatus.PENDING, 2)
    ]
    # ... and the pending edit is not public until approved again
    assert auth_env.client().get(f"/listings/{listing_id}").status_code == 404


def test_an_approved_food_listing_returns_to_pending_for_any_food_field(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    for fields in (
        {"food": {"hoursNote": "Mon-Fri"}},
        {"food": {"menuHighlights": [{"name": "Eclair"}]}},
        {"food": {"serviceOptions": ["takeaway"]}},
        {"food": {"categories": ["cafes", "bakeries"]}},
        {"food": {"menuImage": "/assets/m.png"}},
    ):
        listing_id = approved(auth_env, api, food_body())
        # keep the quota out of the way
        for older in auth_env.session.execute(
            text("SELECT id FROM listings WHERE id <> :i"), {"i": listing_id}
        ):
            set_status(auth_env.session, str(older[0]), ListingStatus.ARCHIVED)
        assert patch(api, listing_id, 1, **fields).json()["data"]["status"] == "pending", fields


def test_an_approved_property_returns_to_pending_for_any_subtype_field(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    for fields in (
        {"price": "PKR 2.3 Cr"},
        {"bedrooms": 4},
        {"furnished": "Furnished"},
        {"listingType": "rent"},
        {"propertyType": "flat"},
    ):
        listing_id = approved(auth_env, api, property_body())
        assert patch(api, listing_id, 1, **fields).json()["data"]["status"] == "pending", fields


def test_a_tutor_grade_change_is_material(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = approved(auth_env, api, tutor_body())

    response = patch(api, listing_id, 1, grade="O-Levels")

    assert response.json()["data"]["status"] == "pending"
    tutor = stored(auth_env.session, listing_id).tutor_profile
    assert tutor is not None and tutor.grade == "O-Levels"


# -- the moderation-bypass matrix (LOCATION_MAP §7.4 / §16) -----------------------------------------------


def listing_with(
    session: Session, api: AuthApi, mode: str, status: ListingStatus, **body: Any
) -> str:
    location = (
        area_only(address="Shop 4, Main Market", landmark="Opposite the mosque")
        if mode == "area_only"
        else exact(visibility=mode)
    )
    listing_id = created_id(api, business_body(location=location, **body))
    set_status(session, listing_id, status)
    return listing_id


def resend(mode: str, **overrides: Any) -> dict[str, Any]:
    """The full location block an edit form re-sends, with the new visibility."""
    if mode == "area_only":
        location = area_only(address="Shop 4, Main Market", landmark="Opposite the mosque")
        location.update(overrides)
        return location
    return exact(visibility=mode, **overrides)


@pytest.mark.parametrize(
    ("start", "end"),
    [("exact", "approximate"), ("exact", "area_only"), ("approximate", "area_only")],
)
def test_a_pure_narrowing_keeps_an_approved_listing_approved(
    auth_env: AuthEnv, start: str, end: str
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, start, ListingStatus.APPROVED)
    before = snapshot(auth_env, listing_id)
    auth_env.clock.advance(days=1)

    response = patch(api, listing_id, 1, location=resend(end))

    assert response.status_code == 200, response.text
    after = snapshot(auth_env, listing_id)
    assert (after["status"], after["revision"]) == ("approved", 2)
    assert after["submitted_at"] == before["submitted_at"]  # not resubmitted
    assert after["history"] == before["history"]  # no history row for a narrowing
    assert after["location_visibility"] == end
    assert (after["address"], after["landmark"]) == ("Shop 4, Main Market", "Opposite the mosque")
    for private in ADDRESS_TEXT:
        assert private not in after["search_document"]  # gone from search immediately
    if end == "area_only":
        assert after["latitude"] is None and after["longitude"] is None  # the pin is erased
        assert after["public_latitude"] is None
    else:
        assert (after["latitude"], after["longitude"]) == (before["latitude"], before["longitude"])
        assert float(after["public_latitude"]) == 33.12  # the generated rounded point
    assert auth_env.client().get(f"/listings/{listing_id}").status_code == 200  # still public


@pytest.mark.parametrize("status", [ListingStatus.PENDING, ListingStatus.REJECTED])
@pytest.mark.parametrize(
    ("start", "end"),
    [("exact", "approximate"), ("exact", "area_only"), ("approximate", "area_only")],
)
def test_a_narrowing_never_changes_the_status_of_a_pending_or_rejected_listing(
    auth_env: AuthEnv, start: str, end: str, status: ListingStatus
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, start, status)
    before = snapshot(auth_env, listing_id)

    response = patch(api, listing_id, 1, location=resend(end))

    assert response.status_code == 200
    after = snapshot(auth_env, listing_id)
    assert (after["status"], after["revision"]) == (status.value, 2)
    assert after["history"] == before["history"]
    assert after["submitted_at"] == before["submitted_at"]


@pytest.mark.parametrize(
    ("start", "end"),
    [("approximate", "exact"), ("area_only", "approximate"), ("area_only", "exact")],
)
def test_a_widening_alone_returns_an_approved_listing_to_pending(
    auth_env: AuthEnv, start: str, end: str
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, start, ListingStatus.APPROVED)
    location = exact(visibility=end)

    response = patch(api, listing_id, 1, location=location)

    assert response.status_code == 200, response.text
    after = snapshot(auth_env, listing_id)
    assert (after["status"], after["revision"]) == ("pending", 2)
    assert [(a, f, t) for a, f, t, _ in after["history"][-1:]] == [
        (HistoryAction.RESUBMITTED, ListingStatus.APPROVED, ListingStatus.PENDING)
    ]
    assert auth_env.client().get(f"/listings/{listing_id}").status_code == 404


LOCATION_CHANGES: list[dict[str, Any]] = [
    {"address": "Shop 5, Main Market"},
    {"landmark": "Opposite the school"},
    {"block": "C"},
    {"address": None},  # even clearing one
    {"landmark": None},
    {"block": None},
]
#: A moved pin only makes sense where a point is kept (``approximate``); ``area_only`` erases it.
MOVED_PINS: list[dict[str, Any]] = [{"latitude": 33.123457}, {"longitude": 72.123457}]
NARROWING_PLUS_LOCATION_CHANGE = [
    ("approximate", change) for change in [*MOVED_PINS, *LOCATION_CHANGES]
] + [("area_only", change) for change in LOCATION_CHANGES]


@pytest.mark.parametrize(("end", "change"), NARROWING_PLUS_LOCATION_CHANGE)
def test_a_narrowing_combined_with_a_location_change_goes_back_to_moderation(
    auth_env: AuthEnv, end: str, change: dict[str, Any]
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, "exact", ListingStatus.APPROVED)
    if end == "area_only":
        location = resend("area_only", **change)
    else:
        location = exact(visibility="approximate", **change)
    location = {k: v for k, v in location.items() if v is not None}

    response = patch(api, listing_id, 1, location=location)

    assert response.status_code == 200, response.text
    after = snapshot(auth_env, listing_id)
    assert (after["status"], after["revision"]) == ("pending", 2)
    assert [(a, f, t) for a, f, t, _ in after["history"][-1:]] == [
        (HistoryAction.RESUBMITTED, ListingStatus.APPROVED, ListingStatus.PENDING)
    ]


@pytest.mark.parametrize(
    "extra",
    [
        {"name": "A Different Name"},
        {"description": "A completely rewritten description of this business."},
        {"tags": ["different"]},
        {"image": "/assets/new.png"},
        {"category": "pharmacy"},
    ],
)
def test_a_narrowing_combined_with_a_content_change_goes_back_to_moderation(
    auth_env: AuthEnv, extra: dict[str, Any]
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, "exact", ListingStatus.APPROVED)

    response = patch(api, listing_id, 1, location=resend("approximate"), **extra)

    assert response.json()["data"]["status"] == "pending"
    assert len(resubmitted_rows(auth_env, listing_id)) == 1


def test_a_narrowing_combined_with_a_changed_area_goes_back_to_moderation(
    auth_env: AuthEnv, db_session: Any
) -> None:
    from tests.db.auth_helpers import build_env

    env = build_env(db_session, localities=["B-17", "G-13"])
    api = signed_in(env, "wide@example.org")
    listing_id = listing_with(env.session, api, "exact", ListingStatus.APPROVED)

    response = patch(api, listing_id, 1, location=resend("approximate"), area="G-13")

    assert response.json()["data"]["status"] == "pending"
    env.close()


def test_a_narrowing_combined_with_a_food_or_menu_change_goes_back_to_moderation(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = approved(auth_env, api, food_body())

    response = patch(
        api,
        listing_id,
        1,
        location=exact(visibility="approximate"),
        food={"menuHighlights": [{"name": "Eclair"}]},
    )

    assert response.json()["data"]["status"] == "pending"


def test_a_narrowing_combined_with_a_property_change_goes_back_to_moderation(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = approved(auth_env, api, property_body())

    response = patch(
        api, listing_id, 1, location=exact(visibility="approximate"), price="PKR 2.3 Cr"
    )

    assert response.json()["data"]["status"] == "pending"


def test_a_property_narrowing_to_approximate_stays_approved(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = approved(auth_env, api, property_body())

    response = patch(api, listing_id, 1, location=exact(visibility="approximate"))

    assert response.json()["data"]["status"] == "approved"


def test_same_visibility_location_edits_are_ordinary_edits(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    pin_moved = listing_with(auth_env.session, api, "exact", ListingStatus.APPROVED)
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er")
    address_changed = listing_with(auth_env.session, other, "exact", ListingStatus.APPROVED)

    assert (
        patch(api, pin_moved, 1, location=exact(latitude=33.5)).json()["data"]["status"]
        == "pending"
    )
    assert (
        patch(other, address_changed, 1, location=exact(address="Elsewhere")).json()["data"][
            "status"
        ]
        == "pending"
    )


@pytest.mark.parametrize("status", list(ListingStatus)[:3])
def test_a_stale_revision_conflicts_for_a_narrowing_too(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, "exact", status)
    before = snapshot(auth_env, listing_id)

    response = patch(api, listing_id, 5, location=resend("approximate"))

    assert (response.status_code, error_code(response)) == (409, "listing_conflict")
    assert snapshot(auth_env, listing_id) == before


def test_a_narrowing_by_a_non_owner_is_a_404_and_changes_nothing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er")
    listing_id = listing_with(auth_env.session, api, "exact", ListingStatus.APPROVED)
    before = snapshot(auth_env, listing_id)

    response = patch(other, listing_id, 1, location=resend("approximate"))

    assert response.status_code == 404
    assert snapshot(auth_env, listing_id) == before


# -- search privacy after edits -----------------------------------------------------------------------------


def test_narrowing_removes_the_address_from_search_immediately_and_widening_does_not_publish(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    anonymous = auth_env.client()
    listing_id = listing_with(
        auth_env.session, api, "exact", ListingStatus.APPROVED, name="Findable Stationers"
    )
    assert anonymous.get("/search", params={"q": "opposite the mosque"}).json()["data"], "indexed"

    patch(api, listing_id, 1, location=resend("approximate"))
    assert anonymous.get("/search", params={"q": "opposite the mosque"}).json()["data"] == []
    assert anonymous.get("/search", params={"q": "shop 4"}).json()["data"] == []
    assert anonymous.get("/search", params={"q": "Findable"}).json()["data"], "still public"
    public = anonymous.get(f"/listings/{listing_id}").json()["data"]["location"]
    assert "address" not in public and "landmark" not in public

    widened = patch(api, listing_id, 2, location=resend("exact"))
    assert widened.json()["data"]["status"] == "pending"
    assert anonymous.get("/search", params={"q": "Findable"}).json()["data"] == []  # pulled again
    assert anonymous.get(f"/listings/{listing_id}").status_code == 404
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)  # (the admin slice's job)
    assert anonymous.get("/search", params={"q": "opposite the mosque"}).json()["data"]


def test_every_edit_leaves_the_search_document_consistent(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())
    revision = 1
    for fields in (
        {"name": "Renamed Bakery"},
        {"food": {"menuHighlights": [{"name": "Eclair"}], "categories": ["desi-food"]}},
        {"location": exact(visibility="approximate")},
        {"vertical": "general", "category": "grocery"},
        {"tags": ["only", "these"]},
    ):
        response = patch(api, listing_id, revision, **fields)
        assert response.status_code == 200, (fields, response.text)
        revision += 1
        assert SearchIndexer(auth_env.session).find_stale() == [], fields


# -- Food <-> General, categories, legacy -----------------------------------------------------------------


def count_rows(env: AuthEnv, model: Any) -> int:
    env.session.expire_all()
    return int(env.session.scalar(select(func.count()).select_from(model)) or 0)


def test_switching_a_food_business_to_general_removes_every_trace_of_food(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())

    response = patch(api, listing_id, 1, vertical="general", category="grocery")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["vertical"] == "general" and data["category"] == "grocery" and "food" not in data
    assert count_rows(auth_env, FoodProfile) == 0 and count_rows(auth_env, FoodMenuItem) == 0
    row = stored(auth_env.session, listing_id)
    assert [(c.position, c.category.slug, c.category.module.value) for c in row.categories] == [
        (1, "grocery", "directory")
    ]
    assert "bakeries" not in stored_columns(auth_env.session, listing_id)["search_document"]
    assert "fudge cake" not in stored_columns(auth_env.session, listing_id)["search_document"]


def test_switching_a_general_business_to_food_needs_and_stores_the_food_data(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())
    food = {
        "categories": ["cafes", "bakeries"],
        "serviceOptions": ["dine-in"],
        "menuHighlights": [{"name": "Latte", "price": "PKR 450"}],
    }

    response = patch(api, listing_id, 1, vertical="food", food=food)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["vertical"] == "food" and "category" not in data
    assert data["food"]["categories"] == ["cafes", "bakeries"]
    row = stored(auth_env.session, listing_id)
    assert [(c.position, c.category.slug, c.category.module.value) for c in row.categories] == [
        (1, "cafes", "food"),
        (2, "bakeries", "food"),
    ]
    assert count_rows(auth_env, FoodMenuItem) == 1


def test_food_data_cannot_be_sent_to_a_general_business_or_a_category_to_a_food_one(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    general = created_id(api, business_body())
    food = created_id(api, food_body())

    assert codes(patch(api, general, 1, food={"hoursNote": "x"})) == [("food", "not_allowed")]
    assert codes(patch(api, food, 1, category="grocery")) == [("category", "not_allowed")]


def test_changing_the_category_replaces_the_single_stored_link(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body())

    response = patch(api, listing_id, 1, category="plumbing")

    assert response.json()["data"]["category"] == "plumbing"
    assert response.json()["data"]["categoryLabel"] == "Plumbing"
    links = auth_env.session.scalars(select(ListingCategory)).all()
    assert len(links) == 1 and links[0].position == 1


def test_a_category_that_was_deactivated_later_does_not_block_unrelated_edits(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, provider_body(category="plumbing"))
    auth_env.session.execute(
        text("UPDATE categories SET is_active = false WHERE slug = 'plumbing'")
    )
    auth_env.session.execute(text("UPDATE categories SET is_active = false WHERE slug = 'solar'"))
    auth_env.session.commit()

    kept = patch(api, listing_id, 1, name="Renamed Plumbers", category="plumbing")
    switched = patch(api, listing_id, 2, category="solar")

    assert kept.status_code == 200 and kept.json()["data"]["category"] == "plumbing"
    assert codes(switched) == [("category", "unknown_category")]  # newly choosing an inactive one


# -- legacy rows (LOCATION_MAP §3.1) -----------------------------------------------------------------------


def legacy_listing(env: AuthEnv, api: AuthApi, *, kind: str) -> str:
    """A pre-0005-style row: free-text area, area-only, no point, no block."""
    from sqlalchemy import insert

    from app.models import Listing, PropertyProfile
    from app.models.enums import ListingKind
    from app.models.users import User

    user = env.session.scalar(select(User).where(User.email == "sana@example.org"))
    assert user is not None
    category_slug = "house" if kind == "property" else "electrical"
    listing = Listing(
        kind=ListingKind(kind),
        owner_id=user.id,
        status=ListingStatus.APPROVED,
        title="Legacy Listing",
        description="An older listing created before locations existed here.",
        area="B-17, Block C (Demo Area)",
        tags=["legacy"],
    )
    env.session.add(listing)
    env.session.flush()
    if kind == "property":
        env.session.execute(
            insert(PropertyProfile).values(
                listing_id=listing.id, kind="property", listing_type="sale", price_text="PKR 1 Cr"
            )
        )
    category_id = env.session.scalar(
        text("SELECT id FROM categories WHERE slug = :s"), {"s": category_slug}
    )
    env.session.add(ListingCategory(listing_id=listing.id, category_id=category_id, position=1))
    env.session.commit()
    SearchIndexer(env.session).refresh(listing)
    env.session.commit()
    return str(listing.id)


def test_a_legacy_property_cannot_be_edited_without_gaining_a_valid_location(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = legacy_listing(auth_env, api, kind="property")

    typo_fix = patch(api, listing_id, 1, title="Legacy Listing, fixed")
    with_location = patch(
        api, listing_id, 1, title="Legacy Listing, fixed", area="B-17", location=exact()
    )

    assert typo_fix.status_code == 422
    assert ("location.visibility", "not_allowed") in codes(typo_fix)
    assert with_location.status_code == 200, with_location.text
    assert with_location.json()["data"]["status"] == "pending"
    assert with_location.json()["data"]["area"] == "B-17"


def test_a_legacy_property_can_be_read_archived_and_no_op_patched_without_a_location(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = legacy_listing(auth_env, api, kind="property")

    assert mine(api, listing_id)["location"] == {"visibility": "area_only"}
    assert patch(api, listing_id, 1).status_code == 200  # nothing to validate: nothing written


def test_legacy_non_property_rows_edit_freely_and_keep_their_legacy_area_unless_it_is_supplied(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = legacy_listing(auth_env, api, kind="provider")

    renamed = patch(api, listing_id, 1, name="Legacy Listing, renamed")
    area_legacy = patch(api, listing_id, 2, area="B-17, Block C (Demo Area)")
    area_canonical = patch(api, listing_id, 2, area="b-17")

    assert renamed.status_code == 200
    assert renamed.json()["data"]["area"] == "B-17, Block C (Demo Area)"  # untouched
    assert codes(area_legacy) == [("area", "unknown_locality")]  # supplied -> must be canonical
    assert area_canonical.json()["data"]["area"] == "B-17"


def test_the_stored_point_is_never_loaded_by_the_public_path_after_an_edit(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = listing_with(auth_env.session, api, "approximate", ListingStatus.APPROVED)
    patch(api, listing_id, 1, location=resend("area_only"))

    public = auth_env.client().get(f"/listings/{listing_id}")

    assert public.status_code == 200
    assert public.json()["data"]["location"] == {"visibility": "area_only", "block": "B"}
    assert "33.12" not in public.text and "Shop 4" not in public.text
