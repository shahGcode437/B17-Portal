"""GET /admin/listings and /admin/listings/{id} (Phase 12E): the moderation queue and the review
detail. Admin only; the detail is the ONLY place besides the owner's own view where the private
location leaves the backend, and the queue never carries it.

Real PostgreSQL, the real app, real login.
"""

from typing import Any

import pytest
from sqlalchemy import event, text
from sqlalchemy.engine import Engine

from app.models.enums import ListingStatus
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
from tests.db.write_helpers import (
    approximate,
    area_only,
    business_body,
    error_code,
    exact,
    food_body,
    property_body,
    provider_body,
    set_status,
    signed_in,
    tutor_body,
)

SUMMARY_KEYS = {
    "id", "kind", "title", "area", "locationVisibility", "categoryLabel", "status", "revision",
    "submittedAt", "updatedAt",
}  # fmt: skip
OPTIONAL_SUMMARY_KEYS = {"vertical", "block", "featured", "submitter"}
PRIVATE_TEXT = ("Shop 4, Main Market", "Opposite the mosque", "33.123456", "72.123456")


def keys(item: dict[str, Any]) -> set[str]:
    return set(item)


# -- who may look ------------------------------------------------------------------------------------


@pytest.mark.parametrize("target", ["queue", "detail"])
def test_only_an_admin_may_read_the_moderation_surface(auth_env: AuthEnv, target: str) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    path = ADMIN_LISTINGS if target == "queue" else f"{ADMIN_LISTINGS}/{listing_id}"
    actors = {
        "anonymous": (auth_env.client(), 401, "unauthenticated"),
        "unverified": (
            signed_in(auth_env, "unv@example.org", verified=False, professional=None),
            403,
            "email_not_verified",
        ),
        "verified resident": (
            signed_in(auth_env, "res@example.org", professional=None),
            403,
            "forbidden",
        ),
        "professional (the owner)": (owner, 403, "forbidden"),
        "another professional": (signed_in(auth_env, "pro2@example.org"), 403, "forbidden"),
    }

    for label, (api, status, code) in actors.items():
        response = api.get(path)
        assert (response.status_code, error_code(response)) == (status, code), label
        assert response.headers["Cache-Control"] == "no-store", label
    assert admin_signed_in(auth_env).get(path).status_code == 200


def test_a_professional_who_is_also_an_admin_is_judged_by_the_role_only(auth_env: AuthEnv) -> None:
    both = signed_in(auth_env, "both@example.org", admin=True)  # admin role AND a profile
    only_profile = signed_in(auth_env, "pro@example.org")

    assert both.get(ADMIN_LISTINGS).status_code == 200
    assert only_profile.get(ADMIN_LISTINGS).status_code == 403


def test_admin_authority_is_read_live_from_the_roles_table(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    assert admin.get(ADMIN_LISTINGS).status_code == 200
    auth_env.session.execute(text("DELETE FROM user_roles"))
    auth_env.session.commit()

    assert admin.get(ADMIN_LISTINGS).status_code == 403


@pytest.mark.parametrize(
    "attempt",
    [
        {"params": {"admin": "true"}},
        {"params": {"role": "admin"}},
        {"headers": {"X-Role": "admin"}},
        {"headers": {"X-Admin": "1"}},
    ],
)
def test_admin_cannot_be_claimed_through_the_request(
    auth_env: AuthEnv, attempt: dict[str, Any]
) -> None:
    pro = signed_in(auth_env, "pro@example.org")

    response = pro.get(ADMIN_LISTINGS, **attempt)

    assert response.status_code == 403


def test_a_suspended_admin_has_no_session(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    auth_env.session.execute(text("UPDATE users SET status = 'suspended'"))
    auth_env.session.commit()

    assert admin.get(ADMIN_LISTINGS).status_code == 401


# -- the queue ---------------------------------------------------------------------------------------


def test_an_empty_system_has_an_empty_queue_with_zero_counts(auth_env: AuthEnv) -> None:
    response = queue(admin_signed_in(auth_env))

    assert response.json() == {
        "data": [],
        "meta": {
            "total": 0, "limit": 12, "offset": 0,
            "counts": {"pending": 0, "approved": 0, "rejected": 0, "archived": 0},
        },
    }  # fmt: skip


def test_a_queue_row_is_a_light_summary_without_private_data(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, food_body())
    admin = admin_signed_in(auth_env)

    response = queue(admin, status="pending")

    (row,) = response.json()["data"]
    assert row["id"] == listing_id
    assert SUMMARY_KEYS <= keys(row) <= SUMMARY_KEYS | OPTIONAL_SUMMARY_KEYS
    assert (row["kind"], row["vertical"], row["title"]) == (
        "business",
        "food",
        "Sweet Crumbs Bakery",
    )
    assert (row["status"], row["revision"], row["categoryLabel"]) == ("pending", 1, "Bakeries")
    assert (row["area"], row["block"], row["locationVisibility"]) == ("B-17", "B", "exact")
    assert row["submitter"] == {"displayName": "Sana Baker"}
    for private in (
        *PRIVATE_TEXT,
        "latitude",
        "longitude",
        "address",
        "landmark",
        "description",
        "menuHighlights",
        "email",
        "ownerId",
        "passwordHash",
        "categories",
    ):
        assert private not in response.text, private  # fmt: skip
    assert response.headers["Cache-Control"] == "no-store"


def test_the_queue_shows_every_status_and_counts_ignore_the_filters(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    ids = [pending(owner, provider_body(name=f"Provider {n}")) for n in "ABCD"]
    set_status(auth_env.session, ids[1], ListingStatus.APPROVED)
    set_status(auth_env.session, ids[2], ListingStatus.REJECTED)
    set_status(auth_env.session, ids[3], ListingStatus.ARCHIVED)
    admin = admin_signed_in(auth_env)

    everything = queue(admin).json()
    only_archived = queue(admin, status="archived").json()

    assert everything["meta"]["total"] == 4
    assert everything["meta"]["counts"] == {
        "pending": 1,
        "approved": 1,
        "rejected": 1,
        "archived": 1,
    }
    assert {r["status"] for r in everything["data"]} == {
        "pending",
        "approved",
        "rejected",
        "archived",
    }
    assert [r["id"] for r in only_archived["data"]] == [ids[3]]
    assert only_archived["meta"]["total"] == 1
    assert only_archived["meta"]["counts"] == everything["meta"]["counts"]


def test_the_queue_filters_by_kind_and_combines_with_status(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    provider = pending(owner, provider_body())
    business = pending(owner, business_body())
    food = pending(owner, food_body())
    tutor = pending(owner, tutor_body())
    prop = pending(owner, property_body())
    set_status(auth_env.session, business, ListingStatus.APPROVED)
    admin = admin_signed_in(auth_env)

    kinds = {k: {r["id"] for r in queue(admin, kind=k).json()["data"]}
             for k in ("provider", "business", "tutor", "property")}  # fmt: skip
    combined = queue(admin, kind="business", status="pending").json()["data"]

    assert kinds == {
        "provider": {provider}, "business": {business, food}, "tutor": {tutor}, "property": {prop},
    }  # fmt: skip
    assert [r["id"] for r in combined] == [food]


def test_a_pending_queue_is_first_in_first_out_and_other_views_are_newest_first(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    ids = [pending(owner, provider_body(name=f"Provider {n}")) for n in "ABC"]
    for age, listing_id in enumerate(ids):  # A submitted first ... C last
        auth_env.session.execute(
            text("UPDATE listings SET submitted_at = submitted_at + make_interval(mins => :m)"
                 " WHERE id = :i"),
            {"m": age, "i": listing_id},
        )  # fmt: skip
    auth_env.session.commit()
    admin = admin_signed_in(auth_env)

    fifo = [r["id"] for r in queue(admin, status="pending").json()["data"]]
    newest = [r["id"] for r in queue(admin).json()["data"]]

    assert fifo == ids
    assert newest == list(reversed(ids))


def test_pagination_is_stable_and_complete(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    ids = {pending(owner, provider_body(name=f"Provider {n}")) for n in range(7)}
    admin = admin_signed_in(auth_env)

    pages = [queue(admin, status="pending", limit=3, offset=offset).json() for offset in (0, 3, 6)]
    again = queue(admin, status="pending", limit=3, offset=3).json()

    assert [len(p["data"]) for p in pages] == [3, 3, 1]
    assert all(p["meta"]["total"] == 7 for p in pages)
    assert {r["id"] for p in pages for r in p["data"]} == ids  # nothing missing, nothing twice
    assert again["data"] == pages[1]["data"]  # the same page twice is the same page


@pytest.mark.parametrize(
    "params",
    [
        {"status": "draft"},
        {"kind": "service"},
        {"limit": 0},
        {"limit": 51},
        {"offset": -1},
        {"limit": "x"},
    ],
)
def test_bad_query_values_are_validation_errors(auth_env: AuthEnv, params: dict[str, Any]) -> None:
    assert queue(admin_signed_in(auth_env), **params).status_code == 422


def test_a_blank_filter_means_no_filter(auth_env: AuthEnv) -> None:
    pending(owner_signed_in(auth_env), provider_body())

    assert queue(admin_signed_in(auth_env), status="", kind="").json()["meta"]["total"] == 1


def test_the_queue_does_not_issue_a_query_per_listing(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    bodies = [provider_body(), business_body(), food_body(), tutor_body(), property_body()]
    for index in range(10):  # (listing create is rate limited to 10 an hour)
        pending(owner, bodies[index % 5])
    admin = admin_signed_in(auth_env)
    engine: Engine = auth_env.session.get_bind().engine
    counted: list[str] = []

    def count(_c: Any, _cur: Any, statement: str, *_: Any) -> None:
        counted.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        small = queue(admin, limit=2)
        statements_small = len(counted)
        counted.clear()
        large = queue(admin, limit=10)
        statements_large = len(counted)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert small.status_code == large.status_code == 200
    assert len(large.json()["data"]) == 10
    assert statements_large <= statements_small + 1  # bounded: independent of the page size


# -- the detail --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("make", "extra"),
    [
        (provider_body, {"kind": "provider", "category": "electrical"}),
        (business_body, {"kind": "business", "vertical": "general", "category": "grocery"}),
        (tutor_body, {"kind": "tutor", "category": "physics", "grade": "Matric / A-Levels"}),
        (property_body, {"kind": "property", "propertyType": "house", "listingType": "sale",
                         "price": "PKR 2.2 Cr", "bedrooms": 3, "furnished": "Unfurnished"}),
    ],
)  # fmt: skip
def test_the_detail_is_the_full_review_shape_of_every_kind(
    auth_env: AuthEnv, make: Any, extra: dict[str, Any]
) -> None:
    listing_id = pending(owner_signed_in(auth_env), make())

    data = detail(admin_signed_in(auth_env), listing_id)

    assert data["id"] == listing_id and (data["status"], data["revision"]) == ("pending", 1)
    for key, value in extra.items():
        assert data[key] == value, key
    for key in (
        "description",
        "tags",
        "categories",
        "categoryLabel",
        "area",
        "location",
        "publicLocation",
        "submittedAt",
        "createdAt",
        "updatedAt",
        "history",
        "submitter",
    ):
        assert key in data, key  # fmt: skip


def test_the_detail_of_a_food_business_carries_the_whole_food_profile(auth_env: AuthEnv) -> None:
    listing_id = pending(owner_signed_in(auth_env), food_body())

    data = detail(admin_signed_in(auth_env), listing_id)

    assert data["vertical"] == "food" and "category" not in data
    assert data["food"]["categories"] == ["bakeries", "cafes"]
    assert data["food"]["serviceOptions"] == ["takeaway", "delivery"]
    assert [m["name"] for m in data["food"]["menuHighlights"]] == ["Fudge Cake", "Sourdough"]
    assert data["food"]["hoursNote"] == "Daily, 8 AM-10 PM"


@pytest.mark.parametrize(
    ("location", "public"),
    [
        (exact(), {"visibility": "exact", "precision": "exact"}),
        (approximate(), {"visibility": "approximate", "precision": "approximate"}),
        (area_only(address="Shop 4, Main Market", landmark="Opposite the mosque"),
         {"visibility": "area_only", "precision": None}),
    ],
)  # fmt: skip
def test_the_moderator_sees_the_private_location_and_what_the_public_will_see(
    auth_env: AuthEnv, location: dict[str, Any], public: dict[str, Any]
) -> None:
    listing_id = pending(owner_signed_in(auth_env), business_body(location=location))

    data = detail(admin_signed_in(auth_env), listing_id)

    assert data["location"]["visibility"] == public["visibility"]
    assert data["location"]["address"] == "Shop 4, Main Market"  # private text, admin eyes only
    assert data["location"]["landmark"] == "Opposite the mosque"
    if public["visibility"] == "area_only":
        assert "latitude" not in data["location"]
    else:
        assert (data["location"]["latitude"], data["location"]["longitude"]) == (
            33.123456,
            72.123456,
        )
    preview = data["publicLocation"]
    assert preview["visibility"] == public["visibility"]
    assert preview.get("coordinates", {}).get("precision") == public["precision"]
    if public["visibility"] != "exact":
        assert "address" not in preview and "landmark" not in preview


def test_private_location_never_reaches_the_public_api_because_an_admin_looked(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, business_body(location=approximate(address="Hidden Lane 7")))
    admin = admin_signed_in(auth_env)
    assert "Hidden Lane 7" in admin.get(f"{ADMIN_LISTINGS}/{listing_id}").text
    assert approve(admin, listing_id, 1).status_code == 200

    public = auth_env.client()
    for response in (
        public.get(f"/listings/{listing_id}"),
        public.get("/search", params={"q": "Capital"}),
    ):
        assert "Hidden Lane" not in response.text
        assert "33.123456" not in response.text and "72.123456" not in response.text


def test_the_detail_carries_the_submitter_the_history_and_the_current_reason(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body())
    admin = admin_signed_in(auth_env)
    fresh = detail(admin, listing_id)
    assert fresh["submitter"] == {"displayName": "Sana Baker"}
    assert history_of(fresh) == [("submitted", None, "pending", 1)]
    assert fresh["history"][0]["actor"] == {"displayName": "Sana Baker", "role": "owner"}
    assert "rejectionReason" not in fresh

    age_history(auth_env.session, listing_id)
    assert reject(admin, listing_id, 1, "Add the services you offer please.").status_code == 200

    rejected = detail(admin, listing_id)
    assert rejected["status"] == "rejected"
    assert rejected["rejectionReason"] == "Add the services you offer please."
    assert history_of(rejected) == [
        ("submitted", None, "pending", 1),
        ("rejected", "pending", "rejected", 1),
    ]
    assert rejected["history"][1]["actor"] == {"displayName": "Site Admin", "role": "admin"}
    assert rejected["history"][1]["reason"] == "Add the services you offer please."


def test_the_detail_exists_in_every_status_including_archived(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    for status in ListingStatus:
        listing_id = pending(owner, provider_body())
        set_status(auth_env.session, listing_id, status)
        assert detail(admin, listing_id)["status"] == status.value


def test_an_unclaimed_listing_has_no_submitter(auth_env: AuthEnv) -> None:
    listing_id = pending(owner_signed_in(auth_env), provider_body())
    auth_env.session.execute(text("UPDATE listings SET owner_id = NULL"))
    auth_env.session.commit()

    data = detail(admin_signed_in(auth_env), listing_id)

    assert "submitter" not in data


def test_unknown_and_malformed_ids_are_404_for_an_admin(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)

    for listing_id in ("00000000-0000-4000-8000-000000000000", "not-a-uuid", "123"):
        response = admin.get(f"{ADMIN_LISTINGS}/{listing_id}")
        assert (response.status_code, error_code(response)) == (404, "not_found"), listing_id


def test_nothing_secret_is_in_the_moderation_responses(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, food_body())
    admin = admin_signed_in(auth_env)

    bodies = [queue(admin).text, admin.get(f"{ADMIN_LISTINGS}/{listing_id}").text]

    for body in bodies:
        for secret in (
            "owner@example.org",
            "admin@example.org",
            "argon2",
            "passwordHash",
            "csrf",
            "token",
            "session",
            "provider_subject",
            "sub",
            "emailVerified",
            "authMethods",
        ):
            if secret == "sub":  # (a substring of "submitter" / "submittedAt": check the real key)
                assert '"sub"' not in body
            else:
                assert secret not in body, secret  # fmt: skip


def test_reading_the_surface_changes_nothing(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, food_body())
    admin = admin_signed_in(auth_env)
    before = auth_env.session.execute(
        text("SELECT status, revision, submitted_at, updated_at, search_document FROM listings")
    ).all()

    queue(admin)
    detail(admin, listing_id)
    queue(admin, status="pending", kind="business")

    auth_env.session.expire_all()
    after = auth_env.session.execute(
        text("SELECT status, revision, submitted_at, updated_at, search_document FROM listings")
    ).all()
    assert after == before
