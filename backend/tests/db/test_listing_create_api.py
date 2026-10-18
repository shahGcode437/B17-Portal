"""POST /listings (Phase 12D): every kind, the Food and General rules, location requiredness,
ownership, quota, rate limit, atomicity and public invisibility until approval.

Real PostgreSQL, the real app, real login. The stored rows are inspected directly, not only the
API's description of them.
"""

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import (
    BusinessProfile,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    ListingStatusHistory,
    PropertyProfile,
    TutorProfile,
)
from app.models.enums import (
    ActorRole,
    BusinessVertical,
    HistoryAction,
    ListingKind,
    ListingStatus,
    LocationVisibility,
    PlanCode,
)
from tests.db.auth_helpers import START, AuthEnv
from tests.db.write_helpers import (
    LISTINGS,
    approximate,
    area_only,
    business_body,
    codes,
    create,
    created_id,
    error_code,
    exact,
    food_body,
    history,
    property_body,
    provider_body,
    set_status,
    signed_in,
    stored,
    stored_columns,
    tutor_body,
)

KIND_BODIES = {
    "provider": provider_body,
    "business": business_body,
    "food": food_body,
    "tutor": tutor_body,
    "property": property_body,
}


def count(session: Session, model: Any) -> int:
    session.expire_all()
    return int(session.scalar(select(func.count()).select_from(model)) or 0)


def nothing_was_written(session: Session) -> bool:
    return all(
        count(session, model) == 0
        for model in (
            Listing,
            ListingCategory,
            ListingStatusHistory,
            BusinessProfile,
            FoodProfile,
            FoodMenuItem,
            PropertyProfile,
            TutorProfile,
        )
    )


# -- every kind ----------------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(KIND_BODIES))
def test_a_valid_listing_is_created_pending_at_revision_one(auth_env: AuthEnv, name: str) -> None:
    api = signed_in(auth_env)
    body = KIND_BODIES[name]()

    response = create(api, body)

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["kind"] == body["kind"]
    assert (data["status"], data["revision"]) == ("pending", 1)
    assert response.headers["Location"] == f"/api/v1/users/me/listings/{data['id']}"
    assert response.headers["Cache-Control"] == "no-store"
    for server_owned in ("ownerId", "userId", "searchDocument"):
        assert server_owned not in data

    row = stored(auth_env.session, data["id"])
    assert row.status is ListingStatus.PENDING and row.revision == 1
    assert row.submitted_at == START  # the app clock, reset on every resubmission
    me = api.me().json()["data"]
    assert str(row.owner_id) == me["id"]
    entries = history(auth_env.session, data["id"])
    assert len(entries) == 1
    only = entries[0]
    assert (only.from_status, only.to_status, only.action) == (
        None,
        ListingStatus.PENDING,
        HistoryAction.SUBMITTED,
    )
    assert (only.revision, only.actor_role, str(only.actor_user_id)) == (
        1,
        ActorRole.OWNER,
        me["id"],
    )


def test_a_provider_listing_has_no_subtype_row_and_one_services_category(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(api, provider_body(tags=[" Wiring", "WIRING", "repairs", ""]))

    row = stored(auth_env.session, listing_id)
    assert row.kind is ListingKind.PROVIDER
    assert row.business is None and row.property_profile is None and row.tutor_profile is None
    assert [(c.position, c.category.slug, c.category.module.value) for c in row.categories] == [
        (1, "electrical", "services")
    ]
    assert row.tags == ["wiring", "repairs"]  # trimmed, lower-cased, de-duplicated, ordered
    assert row.location_visibility is LocationVisibility.AREA_ONLY  # the provider default
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["latitude"] is None and columns["longitude"] is None


def test_a_general_business_has_a_business_profile_and_no_food(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(api, business_body())

    row = stored(auth_env.session, listing_id)
    assert row.business is not None and row.business.vertical is BusinessVertical.GENERAL
    assert row.business.food is None
    assert [(c.position, c.category.slug, c.category.module.value) for c in row.categories] == [
        (1, "grocery", "directory")
    ]
    assert count(auth_env.session, FoodProfile) == 0


def test_a_food_business_is_a_business_vertical_not_a_kind(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    response = create(api, food_body())

    data = response.json()["data"]
    assert data["kind"] == "business" and data["vertical"] == "food"
    assert "category" not in data  # derived from the primary Food category, never typed
    assert data["categoryLabel"] == "Bakeries"
    assert data["food"]["categories"] == ["bakeries", "cafes"]
    assert data["food"]["serviceOptions"] == ["takeaway", "delivery"]
    assert [item["name"] for item in data["food"]["menuHighlights"]] == ["Fudge Cake", "Sourdough"]
    row = stored(auth_env.session, data["id"])
    assert row.kind is ListingKind.BUSINESS
    assert row.business is not None and row.business.vertical is BusinessVertical.FOOD
    assert row.business.food is not None
    assert row.business.food.service_options == ["takeaway", "delivery"]
    assert [(i.position, i.name, i.price_text) for i in row.business.food.menu_items] == [
        (1, "Fudge Cake", "PKR 1,800"),
        (2, "Sourdough", None),
    ]
    assert [(c.position, c.category.slug, c.category.module.value) for c in row.categories] == [
        (1, "bakeries", "food"),
        (2, "cafes", "food"),
    ]


def test_service_options_are_stored_as_a_canonical_set(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    body = food_body()
    body["food"]["serviceOptions"] = ["delivery", "dine-in", "delivery"]

    listing_id = created_id(api, body)

    business = stored(auth_env.session, listing_id).business
    assert business is not None and business.food is not None
    food = business.food
    assert food.service_options == ["dine-in", "delivery"]


def test_a_tutor_listing_keeps_its_grade_and_subject(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(api, tutor_body())

    row = stored(auth_env.session, listing_id)
    assert row.tutor_profile is not None and row.tutor_profile.grade == "Matric / A-Levels"
    assert [(c.category.slug, c.category.module.value) for c in row.categories] == [
        ("physics", "education")
    ]
    assert row.location_visibility is LocationVisibility.AREA_ONLY


def test_a_property_listing_keeps_its_subtype_fields_and_a_real_point(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(api, property_body())

    row = stored(auth_env.session, listing_id)
    prop = row.property_profile
    assert prop is not None
    assert (prop.listing_type.value, prop.price_text, prop.bedrooms) == ("sale", "PKR 2.2 Cr", 3)
    assert prop.furnished is not None and prop.furnished.value == "Unfurnished"
    assert [(c.category.slug, c.category.module.value) for c in row.categories] == [
        ("house", "property")
    ]
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["location_visibility"] == "exact"
    assert str(columns["latitude"]) == "33.123456" and str(columns["longitude"]) == "72.123456"


def test_area_is_canonicalised_and_text_is_trimmed_on_the_way_in(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(
        api,
        provider_body(name="  Bright Spark  ", area=" b-17 ", image=" /assets/spark.png "),
    )

    columns = stored_columns(auth_env.session, listing_id)
    assert (columns["title"], columns["area"], columns["image_url"]) == (
        "Bright Spark",
        "B-17",
        "/assets/spark.png",
    )


def test_an_unknown_locality_is_rejected_with_its_own_code(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    for area in ("F-8", "B-17, Block C", "Islamabad"):
        response = create(api, provider_body(area=area))
        assert response.status_code == 422, area
        assert codes(response) == [("area", "unknown_locality")], area
    assert nothing_was_written(auth_env.session)


def test_configured_localities_are_honoured(auth_env: AuthEnv, db_session: Session) -> None:
    from tests.db.auth_helpers import build_env

    env = build_env(db_session, localities=["B-17", "G-13"])
    api = signed_in(env, "wide@example.org")

    ok = create(api, provider_body(area="g-13"))
    bad = create(api, provider_body(area="F-8"))

    assert ok.status_code == 201 and ok.json()["data"]["area"] == "G-13"
    assert bad.status_code == 422
    env.close()


# -- categories -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("make", "field", "slug"),
    [
        (provider_body, "category", "no-such-category"),
        (provider_body, "category", "bakeries"),  # a Food slug is not a services slug
        (provider_body, "category", "grocery"),  # a directory slug is not a services slug
        (business_body, "category", "electrical"),
        (tutor_body, "category", "house"),
        (property_body, "propertyType", "physics"),
        (property_body, "propertyType", "bungalow"),
    ],
)
def test_a_category_must_exist_in_the_listing_s_own_module(
    auth_env: AuthEnv, make: Any, field: str, slug: str
) -> None:
    api = signed_in(auth_env)

    response = create(api, make(**{field: slug}))

    assert response.status_code == 422
    assert codes(response) == [(field, "unknown_category")]
    assert nothing_was_written(auth_env.session)


def test_an_inactive_category_cannot_be_chosen(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    auth_env.session.execute(
        text("UPDATE categories SET is_active = false WHERE slug = 'plumbing'")
    )
    auth_env.session.commit()

    response = create(api, provider_body(category="plumbing"))

    assert (response.status_code, codes(response)) == (422, [("category", "unknown_category")])


def test_food_category_rules(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    def food_with(categories: list[str]) -> Any:
        body = food_body()
        body["food"]["categories"] = categories
        return create(api, body)

    assert food_with([]).status_code == 422
    assert codes(food_with([])) == [("food.categories", "required")]
    assert codes(food_with(["bakeries", "cafes", "desi-food", "bbq"])) == [
        ("food.categories", "too_many")
    ]
    assert codes(food_with(["bakeries", "bakeries"])) == [("food.categories", "duplicate")]
    assert codes(food_with(["bakeries", "nonsense"])) == [("food.categories", "unknown_category")]
    assert codes(food_with(["grocery"])) == [("food.categories", "unknown_category")]  # directory
    assert food_with(["desi-food", "bakeries", "cafes"]).status_code == 201
    assert nothing_was_written(auth_env.session) is False  # only the valid one exists


def test_the_first_food_category_is_the_primary_one(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    body = food_body()
    body["food"]["categories"] = ["desi-food", "bakeries"]

    data = create(api, body).json()["data"]

    assert [(c["slug"], c["isPrimary"]) for c in data["categories"]] == [
        ("desi-food", True),
        ("bakeries", False),
    ]
    assert data["categoryLabel"] == "Desi Food"


# -- Food and General rules -----------------------------------------------------------------------


def test_food_requirements(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    no_services = food_body()
    no_services["food"]["serviceOptions"] = []
    no_food = food_body()
    del no_food["food"]
    typed_category = food_body(category="grocery")
    nine_items = food_body()
    nine_items["food"]["menuHighlights"] = [{"name": f"Item {i}"} for i in range(9)]
    bad_image = food_body()
    bad_image["food"]["menuImage"] = "blob:https://example.org/abc"

    assert codes(create(api, no_services)) == [("food.serviceOptions", "required")]
    assert codes(create(api, no_food)) == [("food", "required")]
    assert codes(create(api, typed_category)) == [("category", "not_allowed")]
    assert codes(create(api, nine_items)) == [("food.menuHighlights", "too_many")]
    assert codes(create(api, bad_image)) == [("food.menuImage", "invalid_media_reference")]
    assert nothing_was_written(auth_env.session)


def test_up_to_eight_menu_items_are_accepted(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    body = food_body()
    body["food"]["menuHighlights"] = [{"name": f"Item {i}"} for i in range(8)]

    data = create(api, body).json()["data"]

    assert len(data["food"]["menuHighlights"]) == 8


def test_a_general_business_can_not_receive_food_only_fields(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    food_block = {"categories": ["bakeries"], "serviceOptions": ["takeaway"]}

    response = create(api, business_body(food=food_block))
    missing_category = business_body()
    del missing_category["category"]

    assert (response.status_code, codes(response)) == (422, [("food", "not_allowed")])
    assert codes(create(api, missing_category)) == [("category", "required")]
    assert nothing_was_written(auth_env.session)


def test_other_kinds_cannot_carry_business_or_property_fields(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    for body in (
        provider_body(food={"categories": ["bakeries"], "serviceOptions": ["takeaway"]}),
        provider_body(vertical="food"),
        tutor_body(price="PKR 1"),
        provider_body(listingType="sale"),
    ):
        assert create(api, body).status_code == 422, body
    assert nothing_was_written(auth_env.session)


def test_a_menu_item_price_is_a_display_string_never_parsed(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    body = food_body()
    body["food"]["menuHighlights"] = [{"name": "Cake", "price": "Rs. 1,800 (approx.)"}]

    data = create(api, body).json()["data"]

    assert data["food"]["menuHighlights"][0]["price"] == "Rs. 1,800 (approx.)"


# -- property -------------------------------------------------------------------------------------


def test_property_requirements(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    area_only_property = create(api, property_body(location=area_only()))
    no_point = create(api, property_body(location=approximate(latitude=None, longitude=None)))
    no_address = create(api, property_body(location=exact(address=None)))
    no_location = property_body()
    del no_location["location"]

    assert codes(area_only_property) == [("location.visibility", "not_allowed")]
    assert codes(no_point) == [
        ("location.latitude", "required"),
        ("location.longitude", "required"),
    ]
    assert codes(no_address) == [("location.address", "required")]
    assert codes(create(api, no_location)) == [("location", "required")]
    assert nothing_was_written(auth_env.session)


def test_an_approximate_property_needs_no_address(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    response = create(api, property_body(location=approximate(address=None, landmark=None)))

    assert response.status_code == 201


# -- location per kind ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "location", "expected"),
    [
        # Business - General / Food: a conscious choice; a point unless area_only; address if exact.
        ("business", None, [("location", "required")]),
        ("business", exact(), []),
        ("business", approximate(address=None), []),
        ("business", area_only(), []),
        (
            "business",
            area_only(latitude=33.1, longitude=72.1),
            [("location.latitude", "not_allowed")],
        ),
        (
            "business",
            exact(latitude=None, longitude=None),
            [("location.latitude", "required"), ("location.longitude", "required")],
        ),
        ("food", None, [("location", "required")]),
        ("food", exact(), []),
        ("food", area_only(), []),
        # Provider / Tutor: area_only by default, never a forced public home point.
        ("provider", None, []),
        ("provider", exact(), []),
        ("provider", approximate(), []),
        ("provider", area_only(), []),
        ("provider", exact(address=None), [("location.address", "required")]),
        ("tutor", None, []),
        ("tutor", approximate(), []),
        (
            "tutor",
            approximate(latitude=None, longitude=None),
            [("location.latitude", "required"), ("location.longitude", "required")],
        ),
    ],
)
def test_location_requiredness_by_kind(
    auth_env: AuthEnv, name: str, location: dict[str, Any] | None, expected: list[tuple[str, str]]
) -> None:
    api = signed_in(auth_env)
    body = KIND_BODIES[name]()
    body.pop("location", None)
    if location is not None:
        body["location"] = location

    response = create(api, body)

    if expected:
        assert response.status_code == 422, response.text
        assert codes(response) == expected
    else:
        assert response.status_code == 201, response.text


def test_provider_and_tutor_default_to_area_only_with_no_stored_point(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    for body in (provider_body(), tutor_body()):
        data = create(api, body).json()["data"]
        assert data["location"] == {"visibility": "area_only"}
        assert data["publicLocation"] == {"visibility": "area_only"}


@pytest.mark.parametrize(
    ("mode", "public"),
    [
        ("exact", {"latitude": 33.123456, "longitude": 72.123456, "precision": "exact"}),
        ("approximate", {"latitude": 33.12, "longitude": 72.12, "precision": "approximate"}),
    ],
)
def test_the_public_point_is_generated_by_the_database_not_sent_by_the_client(
    auth_env: AuthEnv, mode: str, public: dict[str, Any]
) -> None:
    api = signed_in(auth_env)

    data = create(api, business_body(location=exact(visibility=mode))).json()["data"]

    assert data["location"]["latitude"] == 33.123456  # the owner always sees the real point
    assert data["publicLocation"]["coordinates"] == public
    columns = stored_columns(auth_env.session, data["id"])
    assert str(columns["latitude"]) == "33.123456"
    assert (float(columns["public_latitude"]), float(columns["public_longitude"])) == (
        public["latitude"],
        public["longitude"],
    )


def test_approximate_keeps_the_exact_point_internally_but_publishes_the_rounded_one(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)

    data = create(api, business_body(location=approximate())).json()["data"]

    assert (data["location"]["address"], data["location"]["landmark"]) == (
        "Shop 4, Main Market",
        "Opposite the mosque",
    )
    assert "address" not in data["publicLocation"] and "landmark" not in data["publicLocation"]
    assert "latitude" not in data["publicLocation"]


def test_area_only_stores_no_point(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(api, business_body(location=area_only(address="Private shop address")))

    columns = stored_columns(auth_env.session, listing_id)
    assert columns["latitude"] is None and columns["longitude"] is None
    assert columns["public_latitude"] is None and columns["public_longitude"] is None
    assert columns["address"] == "Private shop address"  # kept for admin verification only
    assert "private shop address" not in columns["search_document"]


def test_coordinates_are_rounded_to_six_places_and_range_checked(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    rounded = created_id(api, business_body(location=exact(latitude=33.12345649, longitude=72.1)))
    assert str(stored_columns(auth_env.session, rounded)["latitude"]) == "33.123456"

    for latitude, longitude in ((91, 72), (33, 181), (-91, 0), (0, -181)):
        response = create(
            api, business_body(location=exact(latitude=latitude, longitude=longitude))
        )
        assert response.status_code == 422, (latitude, longitude)
        assert codes(response)[0][1] == "out_of_range"


@pytest.mark.parametrize("value", ["33.1", True, "NaN"])
def test_coordinates_must_be_json_numbers(auth_env: AuthEnv, value: Any) -> None:
    api = signed_in(auth_env)

    response = create(api, business_body(location=exact(latitude=value)))

    assert response.status_code == 422
    assert codes(response)[0][0] == "location.latitude"


@pytest.mark.parametrize("block", ["<b>x</b>", "C;DROP", "-C"])
def test_a_malicious_block_label_is_rejected(auth_env: AuthEnv, block: str) -> None:
    api = signed_in(auth_env)

    response = create(api, business_body(location=exact(block=block)))

    assert (response.status_code, codes(response)) == (422, [("location.block", "invalid_format")])


def test_whole_block_and_pin_geometry_is_not_a_geofence(auth_env: AuthEnv) -> None:
    """No B-17 bounding box exists (LOCATION_MAP §5): any valid coordinate is accepted."""
    api = signed_in(auth_env)

    far_away = create(api, business_body(location=exact(latitude=-33.8688, longitude=151.2093)))

    assert far_away.status_code == 201


# -- media ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "image",
    [
        "blob:https://example.org/3f",
        "data:image/png;base64,AAAA",
        "http://x.org/a.jpg",
        "javascript:alert(1)",
    ],
)
def test_only_public_media_references_are_accepted(auth_env: AuthEnv, image: str) -> None:
    api = signed_in(auth_env)

    response = create(api, provider_body(image=image))

    assert (response.status_code, codes(response)) == (422, [("image", "invalid_media_reference")])


def test_a_public_https_url_or_site_path_is_accepted(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    https = create(api, provider_body(image="https://cdn.example.org/a.jpg"))
    path = create(api, provider_body(image="/assets/a.jpg"))

    assert https.status_code == 201 and path.status_code == 201
    assert path.json()["data"]["image"] == "/assets/a.jpg"


# -- ownership, guards, injection ------------------------------------------------------------------


def test_the_owner_is_the_signed_in_user_never_the_body(auth_env: AuthEnv) -> None:
    mallory = signed_in(auth_env, "mallory@example.org", display_name="Mallory")
    victim = signed_in(auth_env, "victim@example.org", display_name="Victim")
    victim_id = victim.me().json()["data"]["id"]

    response = create(mallory, provider_body(ownerId=victim_id))

    assert (response.status_code, codes(response)) == (422, [("ownerId", "not_allowed")])
    assert nothing_was_written(auth_env.session)
    own = create(mallory, provider_body()).json()["data"]["id"]
    assert str(stored(auth_env.session, own).owner_id) == mallory.me().json()["data"]["id"]


@pytest.mark.parametrize(
    "field",
    [
        "id",
        "ownerId",
        "userId",
        "status",
        "revision",
        "featured",
        "submittedAt",
        "createdAt",
        "updatedAt",
        "rejectionReason",
        "moderatedBy",
        "approvedAt",
        "rejectedAt",
        "history",
        "roles",
        "admin",
        "emailVerified",
        "publicLatitude",
        "publicLongitude",
    ],
)
@pytest.mark.parametrize("value", ["approved", None, 1])
def test_server_owned_fields_are_rejected_whatever_their_value(
    auth_env: AuthEnv, field: str, value: Any
) -> None:
    api = signed_in(auth_env)
    body = provider_body()
    body[field] = value

    response = create(api, body)

    assert response.status_code == 422
    assert (field, "not_allowed") in codes(response)
    assert nothing_was_written(auth_env.session)


def test_public_coordinates_cannot_be_written_inside_location(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    response = create(
        api,
        business_body(location=exact(publicLatitude=1.0, publicLongitude=2.0, coordinates={})),
    )

    assert response.status_code == 422
    assert {
        ("location.publicLatitude", "not_allowed"),
        ("location.publicLongitude", "not_allowed"),
        ("location.coordinates", "not_allowed"),
    } <= set(codes(response))


def test_every_new_listing_starts_pending_even_for_an_admin(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, admin=True)

    for body in (provider_body(), business_body(), property_body()):
        assert create(api, body).json()["data"]["status"] == "pending"


def test_a_verified_user_without_a_profile_is_told_to_create_one(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)

    response = create(api, provider_body())

    assert (response.status_code, error_code(response)) == (403, "professional_profile_required")
    assert nothing_was_written(auth_env.session)


def test_an_unverified_professional_cannot_create(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, verified=False)

    response = create(api, provider_body())

    assert (response.status_code, error_code(response)) == (403, "email_not_verified")
    assert nothing_was_written(auth_env.session)
    assert api.me().status_code == 200


def test_anonymous_cannot_create(auth_env: AuthEnv) -> None:
    response = create(auth_env.client(), provider_body())

    assert (response.status_code, error_code(response)) == (401, "unauthenticated")


def test_an_unknown_or_missing_kind_is_a_validation_error(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    for body in ({"kind": "pharmacy"}, {}, provider_body(kind="Business")):
        response = create(api, body)
        assert response.status_code == 422
        assert (
            codes(response)[0] == ("kind", "union_tag_invalid") or codes(response)[0][0] == "kind"
        )


def test_validation_errors_use_camel_case_paths_and_report_everything(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    body = food_body(name="A", description="short")
    body["food"]["categories"] = []
    body["food"]["serviceOptions"] = []
    body["location"]["latitude"] = "33"

    response = create(api, body)

    fields = {field for field, _ in codes(response)}
    assert {"name", "description", "location.latitude"} <= fields
    assert response.json()["error"]["code"] == "validation_error"
    assert "requestId" in response.json()["error"]


def test_a_bad_json_body_is_a_400_not_a_500(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    response = api.request(
        "POST", LISTINGS, content=b"{not json", headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 400


# -- quota and rate limit ---------------------------------------------------------------------------


def test_the_free_plan_allows_three_active_listings(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    for _ in range(3):
        assert create(api, provider_body()).status_code == 201
    fourth = create(api, provider_body())

    assert (fourth.status_code, error_code(fourth)) == (403, "plan_limit_reached")
    assert count(auth_env.session, Listing) == 3


def test_archived_and_rejected_listings_free_their_quota_slot(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    ids = [created_id(api, provider_body()) for _ in range(3)]
    assert create(api, provider_body()).status_code == 403

    set_status(auth_env.session, ids[0], ListingStatus.REJECTED)
    assert create(api, provider_body()).status_code == 201

    assert create(api, provider_body()).status_code == 403  # pending + approved = 3 again
    set_status(auth_env.session, ids[1], ListingStatus.ARCHIVED)
    assert create(api, provider_body()).status_code == 201


def test_approved_listings_count_against_the_quota(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    ids = [created_id(api, provider_body()) for _ in range(3)]
    for listing_id in ids:
        set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    assert create(api, provider_body()).status_code == 403


def test_quota_is_per_owner(auth_env: AuthEnv) -> None:
    first = signed_in(auth_env, "a@example.org", display_name="A A")
    second = signed_in(auth_env, "b@example.org", display_name="B B")
    for _ in range(3):
        create(first, provider_body())

    assert create(first, provider_body()).status_code == 403
    assert create(second, provider_body()).status_code == 201


def test_premium_has_no_listing_limit(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)

    statuses = [create(api, provider_body()).status_code for _ in range(5)]

    assert statuses == [201] * 5


def test_listing_creation_is_rate_limited_per_user(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)
    other = signed_in(
        auth_env, "other@example.org", professional=PlanCode.PREMIUM, display_name="Ot Her"
    )

    statuses = [create(api, provider_body()).status_code for _ in range(10)]
    blocked = create(api, provider_body())

    assert statuses == [201] * 10
    assert (blocked.status_code, error_code(blocked)) == (429, "rate_limited")
    assert int(blocked.headers["Retry-After"]) >= 1
    assert create(other, provider_body()).status_code == 201  # another user is unaffected
    auth_env.clock.advance(hours=1, seconds=1)
    assert create(api, provider_body()).status_code == 201  # the window passed
    assert count(auth_env.session, Listing) == 12


def test_a_rejected_request_does_not_burn_the_rate_limit(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)

    for _ in range(12):
        assert create(api, provider_body(name="A")).status_code == 422
    assert create(api, provider_body()).status_code == 201


# -- atomicity, search, public invisibility ----------------------------------------------------------


def test_a_failure_part_way_leaves_nothing_behind(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.search_index import SearchIndexer

    def explode(self: SearchIndexer, listing: Listing) -> None:
        raise RuntimeError("the index is down")

    monkeypatch.setattr(SearchIndexer, "refresh", explode)
    api = signed_in(auth_env)

    response = create(api, food_body())

    assert response.status_code == 500
    assert nothing_was_written(auth_env.session)


def test_the_search_document_is_built_in_the_same_transaction(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    listing_id = created_id(api, food_body())

    document = stored_columns(auth_env.session, listing_id)["search_document"]
    for text_ in ("sweet crumbs bakery", "bakeries", "cafes", "fudge cake", "sourdough", "cakes"):
        assert text_ in document
    from app.services.search_index import SearchIndexer

    assert SearchIndexer(auth_env.session).find_stale() == []


@pytest.mark.parametrize(
    ("mode", "address_searchable"),
    [("exact", True), ("approximate", False), ("area_only", False)],
)
def test_private_location_text_enters_the_search_document_only_for_exact(
    auth_env: AuthEnv, mode: str, address_searchable: bool
) -> None:
    api = signed_in(auth_env)
    location = (
        area_only(address="Secret Lane Shop 9", landmark="Behind the secret mosque")
        if mode == "area_only"
        else exact(
            visibility=mode, address="Secret Lane Shop 9", landmark="Behind the secret mosque"
        )
    )

    listing_id = created_id(api, business_body(location=location))

    document = stored_columns(auth_env.session, listing_id)["search_document"]
    assert ("secret lane shop 9" in document) is address_searchable
    assert ("behind the secret mosque" in document) is address_searchable
    assert "block b" in document  # the block is always public
    assert "33.12" not in document and "72.12" not in document  # the point never is


def test_a_new_listing_is_visible_to_its_owner_only(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    anonymous = auth_env.client()
    listing_id = created_id(api, business_body(name="Hidden Until Approved Stationers"))

    assert anonymous.get(f"/listings/{listing_id}").status_code == 404
    hits = anonymous.get("/search", params={"q": "Hidden Until Approved"}).json()["data"]
    assert hits == []
    suggestions = anonymous.get("/search/suggestions", params={"q": "Hidden Until"}).json()["data"]
    assert suggestions == []
    assert api.get(f"/users/me/listings/{listing_id}").status_code == 200
    assert api.get("/users/me/listings").json()["meta"]["total"] == 1


def test_timestamps_follow_the_app_clock(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    auth_env.clock.advance(days=2)

    listing_id = created_id(api, provider_body())

    assert stored(auth_env.session, listing_id).submitted_at == START + timedelta(days=2)
