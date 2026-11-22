"""GET /users/me/listings and /users/me/listings/{id} (Phase 12D): the owner's own view, with the
private location the public never gets (LOCATION_MAP §7.3). Every query is owner-scoped; a foreign
listing is a 404 exactly like a missing one."""

from typing import Any

import pytest
from sqlalchemy import event, text
from sqlalchemy.engine import Engine

from app.models.enums import ListingStatus, PlanCode
from tests.db.auth_helpers import AuthEnv
from tests.db.write_helpers import (
    MINE,
    approximate,
    area_only,
    business_body,
    create,
    create_provider,
    created_id,
    error_code,
    exact,
    food_body,
    mine,
    property_body,
    provider_body,
    set_status,
    signed_in,
    staff_provider_body,
    tutor_body,
)

ZERO = {"pending": 0, "approved": 0, "rejected": 0, "archived": 0, "activeQuota": 0}


def test_staff_authored_providers_appear_in_no_owner_count_and_never_move_active_quota(
    auth_env: AuthEnv,
) -> None:
    """A Provider has no owner (RBAC-D), so the staff member who authored three of them sees none
    of them in ``counts`` — neither in a per-status bucket nor in ``activeQuota`` — and only their
    own OWNED listings are counted."""
    api = signed_in(auth_env, admin=True, professional=PlanCode.FREE)
    created_id(api, provider_body(name="Service 1"))
    created_id(api, provider_body(name="Service 2"))
    approved_provider = created_id(api, provider_body(name="Service 3"))
    set_status(auth_env.session, approved_provider, ListingStatus.APPROVED)
    created_id(api, business_body(name="Shop One"))
    created_id(api, tutor_body(name="Tutor One"))

    response = api.get(MINE).json()

    assert response["meta"]["counts"] == {
        "pending": 2,  # the business and the tutor — the three Providers are nobody's
        "approved": 0,
        "rejected": 0,
        "archived": 0,
        "activeQuota": 2,
    }
    assert response["meta"]["total"] == 2
    assert {item["name"] for item in response["data"]} == {"Shop One", "Tutor One"}


def test_active_quota_matches_the_write_paths_count_active(auth_env: AuthEnv) -> None:
    """The exact number the write service's ``_check_quota`` would see; a non-provider create at
    activeQuota == plan limit is refused with ``plan_limit_reached`` — proven here against a Free
    plan admin who has already filled the quota with businesses."""
    api = signed_in(auth_env, admin=True, professional=PlanCode.FREE)
    # Fill the 3-slot quota with owned listings.
    for n in range(3):
        created_id(api, business_body(name=f"Shop {n}"))
    # Five Providers that must not affect the quota display (they are nobody's).
    for n in range(5):
        created_id(api, provider_body(name=f"Service {n}"))

    counts = api.get(MINE).json()["meta"]["counts"]

    assert counts["activeQuota"] == 3
    # And the write path agrees: a non-provider create is refused with plan_limit_reached.
    response = create(api, business_body(name="Shop Four"))
    assert (response.status_code, error_code(response)) == (403, "plan_limit_reached")
    # ... while staff can still author Providers (they have no owner, so no quota applies).
    assert create_provider(api, staff_provider_body(name="Service 6")).status_code == 201
    assert api.get(MINE).json()["meta"]["counts"]["activeQuota"] == 3


def listing_names(response: Any) -> list[str]:
    return [item.get("name") or item.get("title") for item in response.json()["data"]]


def test_a_new_account_sees_an_empty_list_with_zero_counts(auth_env: AuthEnv) -> None:
    for verified, professional in ((True, None), (False, None), (True, PlanCode.FREE)):
        api = signed_in(
            auth_env,
            f"u-{str(verified).lower()}-{str(professional).lower()}@example.org",
            verified=verified,
            professional=professional,
            display_name="New Account",
        )

        response = api.get(MINE)

        assert response.status_code == 200
        assert response.json() == {
            "data": [],
            "meta": {"total": 0, "limit": 12, "offset": 0, "counts": ZERO},
        }
        assert response.headers["Cache-Control"] == "no-store"


def test_anonymous_cannot_list_or_read(auth_env: AuthEnv) -> None:
    anonymous = auth_env.client()

    assert anonymous.get(MINE).status_code == 401
    assert anonymous.get(f"{MINE}/00000000-0000-4000-8000-000000000000").status_code == 401


def test_the_list_holds_only_my_listings_newest_first(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM, admin=True)
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er", admin=True)
    ids = [created_id(api, tutor_body(name=f"Tutor {n}")) for n in "ABC"]
    created_id(other, tutor_body(name="Not Mine"))
    for age, listing_id in enumerate(ids):  # A oldest ... C newest
        auth_env.session.execute(
            text(
                "UPDATE listings SET created_at = now() + make_interval(mins => :m) WHERE id = :i"
            ),
            {"m": age, "i": listing_id},
        )
    auth_env.session.commit()

    response = api.get(MINE)

    assert listing_names(response) == ["Tutor C", "Tutor B", "Tutor A"]
    assert response.json()["meta"]["total"] == 3


def test_pagination_filters_and_counts(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM, admin=True)
    ids = {
        "p1": created_id(api, tutor_body(name="Tutor One")),
        "p2": created_id(api, tutor_body(name="Tutor Two")),
        "b1": created_id(api, business_body(name="Business One")),
        "h1": created_id(api, property_body(title="House One")),
        "f1": created_id(api, food_body(name="Food One")),
    }
    set_status(auth_env.session, ids["p1"], ListingStatus.APPROVED)
    set_status(auth_env.session, ids["p2"], ListingStatus.REJECTED)
    set_status(auth_env.session, ids["h1"], ListingStatus.ARCHIVED)

    everything = api.get(MINE).json()
    approved = api.get(MINE, params={"status": "approved"}).json()
    businesses = api.get(MINE, params={"kind": "business"}).json()
    page = api.get(MINE, params={"limit": 2, "offset": 2}).json()
    combined = api.get(MINE, params={"kind": "tutor", "status": "rejected"}).json()

    assert everything["meta"]["counts"] == {
        "pending": 2,
        "approved": 1,
        "rejected": 1,
        "archived": 1,
        # Quota-countable active = pending + approved: the approved tutor (t1), the pending
        # business (b1) and the pending food (f1) — the rejected tutor and the archived property
        # do not count.
        "activeQuota": 3,
    }
    assert everything["meta"]["total"] == 5
    assert [item["name"] for item in approved["data"]] == ["Tutor One"]
    assert approved["meta"]["total"] == 1
    assert approved["meta"]["counts"] == everything["meta"]["counts"]  # counts ignore filters
    assert {item["name"] for item in businesses["data"]} == {"Business One", "Food One"}
    assert (len(page["data"]), page["meta"]["total"], page["meta"]["offset"]) == (2, 5, 2)
    assert [item["name"] for item in combined["data"]] == ["Tutor Two"]


@pytest.mark.parametrize(
    "params",
    [{"status": "draft"}, {"kind": "service"}, {"limit": 0}, {"limit": 51}, {"offset": -1}],
)
def test_bad_query_values_are_validation_errors(auth_env: AuthEnv, params: dict[str, Any]) -> None:
    api = signed_in(auth_env, admin=True)

    assert api.get(MINE, params=params).status_code == 422


def test_a_blank_filter_is_no_filter(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    created_id(api, tutor_body())

    assert api.get(MINE, params={"status": "", "kind": ""}).json()["meta"]["total"] == 1


def test_the_owner_shape_carries_everything_an_edit_form_needs(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, admin=True)
    listing_id = created_id(api, food_body(image="/assets/shop.png"))

    data = mine(api, listing_id)

    assert data["id"] == listing_id and data["kind"] == "business" and data["vertical"] == "food"
    assert (data["status"], data["revision"]) == ("pending", 1)
    assert data["name"] == "Sweet Crumbs Bakery" and data["area"] == "B-17"
    assert data["image"] == "/assets/shop.png" and data["tags"] == ["cakes", "bread"]
    assert data["location"] == {
        "visibility": "exact",
        "block": "B",
        "address": "Shop 4, Main Market",
        "landmark": "Opposite the mosque",
        "latitude": 33.123456,
        "longitude": 72.123456,
    }
    assert data["food"]["hoursNote"] == "Daily, 8 AM-10 PM"
    assert [c["slug"] for c in data["categories"]] == ["bakeries", "cafes"]
    for key in ("submittedAt", "createdAt", "updatedAt", "publicLocation", "categoryLabel"):
        assert key in data
    for forbidden in (
        "ownerId",
        "passwordHash",
        "email",
        "searchDocument",
        "sessionId",
        "csrfToken",
    ):
        assert forbidden not in data


@pytest.mark.parametrize(
    ("make", "extra"),
    [
        (business_body, {"category": "grocery", "vertical": "general"}),
        (tutor_body, {"category": "physics", "grade": "Matric / A-Levels"}),
        (
            property_body,
            {
                "propertyType": "house",
                "listingType": "sale",
                "price": "PKR 2.2 Cr",
                "bedrooms": 3,
                "furnished": "Unfurnished",
            },
        ),
    ],
)
def test_each_kind_echoes_the_request_vocabulary(
    auth_env: AuthEnv, make: Any, extra: dict[str, Any]
) -> None:
    api = signed_in(auth_env, admin=True)

    data = mine(api, created_id(api, make()))

    for key, value in extra.items():
        assert data[key] == value, key


@pytest.mark.parametrize(
    ("mode", "public"),
    [
        (
            "exact",
            {
                "visibility": "exact",
                "block": "B",
                "address": "Shop 4, Main Market",
                "landmark": "Opposite the mosque",
                "coordinates": {
                    "latitude": 33.123456,
                    "longitude": 72.123456,
                    "precision": "exact",
                },
            },
        ),
        (
            "approximate",
            {
                "visibility": "approximate",
                "block": "B",
                "coordinates": {"latitude": 33.12, "longitude": 72.12, "precision": "approximate"},
            },
        ),
        ("area_only", {"visibility": "area_only", "block": "B"}),
    ],
)
def test_the_owner_sees_the_private_location_and_exactly_what_the_public_will(
    auth_env: AuthEnv, mode: str, public: dict[str, Any]
) -> None:
    api = signed_in(auth_env, admin=True)
    location = (
        area_only(address="Shop 4, Main Market", landmark="Opposite the mosque")
        if mode == "area_only"
        else exact(visibility=mode)
    )
    listing_id = created_id(api, business_body(location=location))

    data = mine(api, listing_id)

    assert data["location"]["address"] == "Shop 4, Main Market"  # private text, owner only
    assert data["publicLocation"] == public
    if mode == "area_only":
        assert "latitude" not in data["location"]
    else:
        assert (data["location"]["latitude"], data["location"]["longitude"]) == (
            33.123456,
            72.123456,
        )
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    assert auth_env.client().get(f"/listings/{listing_id}").json()["data"]["location"] == {
        k: v for k, v in public.items() if k != "address" or mode == "exact"
    } | (
        {"address": "Shop 4, Main Market", "landmark": "Opposite the mosque"}
        if mode == "exact"
        else {}
    )


def test_the_public_api_never_carries_the_private_point_of_a_listing_the_owner_can_see(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env, admin=True)
    anonymous = auth_env.client()
    listing_id = created_id(api, business_body(location=approximate(address="Hidden Lane 7")))
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    public_detail = anonymous.get(f"/listings/{listing_id}").text
    public_search = anonymous.get("/search", params={"q": "Capital Stationers"}).text

    for body in (public_detail, public_search):
        assert "33.123456" not in body and "72.123456" not in body and "Hidden Lane" not in body


def test_the_rejection_reason_is_shown_only_while_rejected_and_is_the_latest(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, tutor_body())

    assert "rejectionReason" not in mine(api, listing_id)
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED, "First reason: add a photo.")
    set_status(auth_env.session, listing_id, ListingStatus.PENDING)
    auth_env.session.execute(
        text("UPDATE listings SET revision = revision + 1")
    )  # the resubmission
    auth_env.session.commit()
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED, "Second reason: add hours.")

    shown = mine(api, listing_id)
    assert shown["status"] == "rejected" and shown["rejectionReason"] == "Second reason: add hours."
    in_list = api.get(MINE).json()["data"][0]
    assert in_list["rejectionReason"] == "Second reason: add hours."
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    assert "rejectionReason" not in mine(api, listing_id)


def test_another_user_s_listing_is_a_404_exactly_like_a_missing_one(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner@example.org", display_name="Own Er")
    other = signed_in(auth_env, "other@example.org", display_name="Oth Er")
    listing_id = created_id(owner, business_body(location=exact(address="Private Place 1")))

    foreign = other.get(f"{MINE}/{listing_id}")
    missing = other.get(f"{MINE}/00000000-0000-4000-8000-000000000000")
    malformed = other.get(f"{MINE}/not-a-uuid")

    assert {foreign.status_code, missing.status_code, malformed.status_code} == {404}
    assert error_code(foreign) == error_code(missing) == error_code(malformed) == "not_found"
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]
    assert "Private Place" not in foreign.text
    assert foreign.headers["Cache-Control"] == "no-store"  # errors under /users/me are no-store too
    assert other.get(MINE).json()["data"] == []


def test_a_suspended_user_s_session_is_dead_so_nothing_is_readable(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, tutor_body())
    auth_env.session.execute(text("UPDATE users SET status = 'suspended'"))
    auth_env.session.commit()

    assert api.get(f"{MINE}/{listing_id}").status_code == 401
    assert api.get(MINE).status_code == 401


def test_listing_many_does_not_issue_a_query_per_listing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM, admin=True)
    bodies = [business_body(), food_body(), tutor_body(), property_body()]
    for index in range(10):
        created_id(api, bodies[index % 4])
    engine: Engine = auth_env.session.get_bind().engine
    counted: list[str] = []

    def count(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        counted.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        small = api.get(MINE, params={"limit": 2})
        statements_small = len(counted)
        counted.clear()
        large = api.get(MINE, params={"limit": 10})
        statements_large = len(counted)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert small.status_code == large.status_code == 200
    assert len(large.json()["data"]) == 10
    assert statements_large <= statements_small + 2  # bounded: independent of the page size
