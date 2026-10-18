"""POST/PATCH /admin/categories and /admin/categories/reorder (Phase 12E; API_CONTRACT.md §10.7).

Categories live in code-defined modules (an admin never creates a module), the slug and module are
immutable, names are unique per ``(module, parent)`` case-insensitively, the hierarchy is at most two
levels deep, deactivation never breaks a listing, and renaming rewrites exactly the search documents
of the listings in that category — in the same transaction. Real PostgreSQL, real app.
"""

import uuid
from typing import Any

import pytest
from sqlalchemy import event, text
from sqlalchemy.engine import Engine

from app.db.seed import seed_reference_data
from app.models.enums import ListingStatus
from app.services.search_index import SearchIndexer
from tests.db.admin_helpers import (
    ADMIN_CATEGORIES,
    PUBLIC_CATEGORIES,
    admin_categories,
    admin_signed_in,
    approve,
    category_id,
    create_category,
    created_category,
    owner_signed_in,
    patch_category,
    pending,
    reorder,
    search_document,
)
from tests.db.auth_helpers import AuthEnv
from tests.db.write_helpers import (
    archive,
    codes,
    created_id,
    error_code,
    food_body,
    mine,
    patch,
    provider_body,
    set_status,
)

FOOD_SLUGS = [
    "restaurants", "fast-food", "biryani-rice", "bbq", "pizza-burgers", "cafes", "juice-shakes",
    "bakeries", "sweets-desserts", "desi-food", "tea-snacks",
]  # fmt: skip


def food_with(categories: list[str], **extra: Any) -> dict[str, Any]:
    body = food_body(**extra)
    body["food"]["categories"] = categories
    return body


def public_names(env: AuthEnv, module: str) -> list[str]:
    rows = env.client().get(PUBLIC_CATEGORIES, params={"module": module}).json()["data"]
    return [row["name"] for row in rows]


def orders(api: Any, module: str, parent_id: str | None = None) -> dict[str, int]:
    return {
        row["slug"]: row["displayOrder"]
        for row in admin_categories(api, module)
        if row.get("parentId") == parent_id
    }


class CountListingUpdates:
    """Counts ``UPDATE listings`` statements issued while active."""

    def __init__(self, env: AuthEnv) -> None:
        self.engine: Engine = env.session.get_bind().engine
        self.statements: list[str] = []

    def _record(self, _c: Any, _cur: Any, statement: str, *_: Any) -> None:
        if statement.lstrip().upper().startswith("UPDATE LISTINGS"):
            self.statements.append(statement)

    def __enter__(self) -> "CountListingUpdates":
        event.listen(self.engine, "before_cursor_execute", self._record)
        return self

    def __exit__(self, *_: object) -> None:
        event.remove(self.engine, "before_cursor_execute", self._record)


# -- create ------------------------------------------------------------------------------------------


def test_an_admin_creates_a_category_with_a_derived_slug_appended_to_its_group(
    auth_env: AuthEnv,
) -> None:
    admin = admin_signed_in(auth_env)
    last_order = max(orders(admin, "food").values())

    response = create_category(admin, "food", "  Sweet   Shops ")

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert (data["module"], data["slug"], data["name"]) == ("food", "sweet-shops", "Sweet Shops")
    assert (data["isActive"], data["displayOrder"]) == (True, last_order + 1)
    assert "parentId" not in data
    assert response.headers["Cache-Control"] == "no-store"
    assert "Sweet Shops" in public_names(auth_env, "food")  # active: public pickers see it at once
    assert "Sweet Shops" in [row["name"] for row in admin_categories(admin, "food")]


def test_an_explicit_slug_order_and_parent_are_honoured(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    parent = created_category(admin, "services", "Home Repairs")

    child = created_category(
        admin, "services", "Locksmiths", slug="lock-smiths", parentId=parent["id"], displayOrder=7
    )

    assert (child["slug"], child["displayOrder"], child["parentId"]) == (
        "lock-smiths",
        7,
        parent["id"],
    )


def test_the_same_slug_may_exist_in_two_modules_but_not_twice_in_one(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    created_category(admin, "food", "Hot Dogs", slug="hot-dogs")

    other_module = create_category(admin, "directory", "Hot Dogs", slug="hot-dogs")
    duplicate = create_category(admin, "food", "Different Name", slug="hot-dogs")

    assert other_module.status_code == 201
    assert (duplicate.status_code, error_code(duplicate)) == (409, "conflict")
    assert codes(duplicate) == [("slug", "duplicate")]


def test_a_slug_that_collides_with_a_seeded_category_is_a_conflict(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)

    response = create_category(admin, "food", "My Own Bakeries", slug="bakeries")

    assert (response.status_code, codes(response)) == (409, [("slug", "duplicate")])


def test_a_derived_slug_that_collides_is_a_conflict_too(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)

    response = create_category(admin, "food", "Fast  Food!")  # derives "fast-food", which is seeded

    assert (response.status_code, codes(response)) == (409, [("slug", "duplicate")])


def test_names_are_unique_per_module_and_parent_case_insensitively(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    parent_a = created_category(admin, "services", "Group A")
    parent_b = created_category(admin, "services", "Group B")
    created_category(admin, "services", "Wiring", parentId=parent_a["id"])

    same = create_category(admin, "services", "WIRING", slug="wiring-two", parentId=parent_a["id"])
    other_parent = create_category(
        admin, "services", "wiring", slug="wiring-b", parentId=parent_b["id"]
    )
    top_level = create_category(admin, "services", "Wiring", slug="wiring-top")
    seeded_clash = create_category(admin, "services", "  plumbing ", slug="plumbing-two")

    assert (same.status_code, codes(same)) == (409, [("name", "duplicate")])
    assert other_parent.status_code == 201 and top_level.status_code == 201  # different groups
    assert (seeded_clash.status_code, codes(seeded_clash)) == (409, [("name", "duplicate")])


@pytest.mark.parametrize("module", ["marketplace", "pharmacy", "Food", "", "everything"])
def test_an_admin_cannot_create_a_module(auth_env: AuthEnv, module: str) -> None:
    admin = admin_signed_in(auth_env)
    modules_before = {row["module"] for row in admin_categories(admin)}

    response = create_category(admin, module, "Used Mobiles")

    assert response.status_code == 422
    assert {row["module"] for row in admin_categories(admin)} == modules_before


@pytest.mark.parametrize(
    ("extra", "expected"),
    [
        ({"id": str(uuid.uuid4())}, ("id", "not_allowed")),
        ({"isActive": False}, ("isActive", "not_allowed")),  # created active, always
        ({"createdAt": "2020-01-01T00:00:00Z"}, ("createdAt", "not_allowed")),
        ({"icon": "cake"}, ("icon", "not_allowed")),
        ({"slug": "Bad Slug"}, ("slug", "invalid_format")),
        ({"slug": "a"}, ("slug", "invalid_format")),
        ({"displayOrder": -1}, ("displayOrder", "greater_than_equal")),
    ],
)
def test_create_is_strict(
    auth_env: AuthEnv, extra: dict[str, Any], expected: tuple[str, str]
) -> None:
    admin = admin_signed_in(auth_env)
    body = {"module": "food", "name": "Strict Probe", **extra}

    response = admin.request("POST", ADMIN_CATEGORIES, json=body)

    assert response.status_code == 422
    assert expected in codes(response)


@pytest.mark.parametrize("name", ["A", "", "   ", "x" * 61])
def test_a_name_is_two_to_sixty_characters(auth_env: AuthEnv, name: str) -> None:
    assert create_category(admin_signed_in(auth_env), "food", name).status_code == 422


def test_a_name_without_usable_letters_needs_an_explicit_slug(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)

    assert codes(create_category(admin, "food", "!!!")) == [("slug", "required")]
    assert create_category(admin, "food", "!!!", slug="symbols").status_code == 201


def test_a_parent_must_exist_share_the_module_and_be_top_level(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "services", "Root One")
    child = created_category(admin, "services", "Child One", parentId=root["id"])
    foreign = created_category(admin, "food", "Foreign Root")

    unknown = create_category(admin, "services", "A", parentId=str(uuid.uuid4()))
    other_module = create_category(admin, "services", "Needs Same Module", parentId=foreign["id"])
    too_deep = create_category(admin, "services", "Grandchild", parentId=child["id"])

    assert codes(unknown) == [("parentId", "unknown_parent")] or unknown.status_code == 422
    assert (other_module.status_code, codes(other_module)) == (
        422,
        [("parentId", "invalid_parent")],
    )
    assert (too_deep.status_code, codes(too_deep)) == (422, [("parentId", "invalid_parent")])


def test_nothing_is_written_by_a_refused_create(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    before = admin_categories(admin)

    create_category(admin, "food", "Bakeries", slug="x-dup-name")  # duplicate name
    create_category(admin, "marketplace", "Nope")  # unknown module
    create_category(admin, "food", "OK Name", slug="Bad Slug")  # invalid slug

    assert admin_categories(admin) == before


# -- patch -------------------------------------------------------------------------------------------


def test_renaming_keeps_the_slug_and_the_id(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Old Name")

    response = patch_category(admin, created["id"], name="  New    Name ")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["id"], data["slug"], data["name"]) == (created["id"], "old-name", "New Name")
    assert "New Name" in public_names(auth_env, "food") and "Old Name" not in public_names(
        auth_env, "food"
    )


@pytest.mark.parametrize(
    "field",
    ["module", "slug", "id", "createdAt", "updatedAt", "children", "listingCount", "deletedAt"],
)
def test_immutable_and_server_owned_fields_cannot_be_patched(auth_env: AuthEnv, field: str) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Stay Put")

    response = patch_category(
        admin, created["id"], **{field: "directory" if field == "module" else "x"}
    )

    assert response.status_code == 422 and (field, "not_allowed") in codes(response)
    assert [r for r in admin_categories(admin, "food") if r["id"] == created["id"]][0][
        "slug"
    ] == "stay-put"


def test_null_clears_only_the_parent(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "services", "Patch Root")
    child = created_category(admin, "services", "Patch Child", parentId=root["id"])

    for field in ("name", "isActive", "displayOrder"):
        response = patch_category(admin, child["id"], **{field: None})
        assert (response.status_code, codes(response)) == (422, [(field, "not_nullable")])
    moved = patch_category(admin, child["id"], parentId=None)

    assert moved.status_code == 200 and "parentId" not in moved.json()["data"]


def test_a_category_can_be_deactivated_and_reactivated(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Toggle Me")

    off = patch_category(admin, created["id"], isActive=False).json()["data"]
    assert off["isActive"] is False
    assert "Toggle Me" not in public_names(auth_env, "food")  # hidden from public pickers / filters
    assert "Toggle Me" in [
        r["name"] for r in admin_categories(admin, "food")
    ]  # admins still see it

    on = patch_category(admin, created["id"], isActive=True).json()["data"]
    assert on["isActive"] is True and "Toggle Me" in public_names(auth_env, "food")


def test_a_category_can_be_moved_under_a_top_level_parent_and_back(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "services", "Move Root")
    leaf = created_category(admin, "services", "Move Leaf")

    moved = patch_category(admin, leaf["id"], parentId=root["id"])
    back = patch_category(admin, leaf["id"], parentId=None)

    assert moved.json()["data"]["parentId"] == root["id"]
    assert "parentId" not in back.json()["data"]


def test_the_hierarchy_rules_hold_on_patch(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "services", "Rule Root")
    child = created_category(admin, "services", "Rule Child", parentId=root["id"])
    other_root = created_category(admin, "services", "Rule Other")
    foreign = created_category(admin, "food", "Rule Foreign")

    to_self = patch_category(admin, root["id"], parentId=root["id"])
    to_unknown = patch_category(admin, other_root["id"], parentId=str(uuid.uuid4()))
    to_other_module = patch_category(admin, other_root["id"], parentId=foreign["id"])
    grandchild = patch_category(admin, other_root["id"], parentId=child["id"])  # parent is a child
    parent_with_children = patch_category(admin, root["id"], parentId=other_root["id"])
    cycle = patch_category(
        admin, root["id"], parentId=child["id"]
    )  # would nest root under its own child

    for response, code in (
        (to_self, "invalid_parent"), (to_unknown, "unknown_parent"), (to_other_module, "invalid_parent"),
        (grandchild, "invalid_parent"), (parent_with_children, "invalid_parent"), (cycle, "invalid_parent"),
    ):  # fmt: skip
        assert response.status_code == 422 and codes(response) == [("parentId", code)]
    assert (
        "parentId"
        not in [r for r in admin_categories(admin, "services") if r["id"] == root["id"]][0]
    )


def test_a_rename_that_collides_is_a_conflict_and_changes_nothing(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Unique One")

    clash = patch_category(admin, created["id"], name="BAKERIES")

    assert (clash.status_code, codes(clash)) == (409, [("name", "duplicate")])
    assert "Unique One" in public_names(auth_env, "food")


def test_a_move_into_a_group_that_already_has_the_name_is_a_conflict(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "services", "Clash Root")
    created_category(admin, "services", "Twin", parentId=root["id"])
    other = created_category(admin, "services", "Twin", slug="twin-top")

    response = patch_category(admin, other["id"], parentId=root["id"])

    assert (response.status_code, codes(response)) == (409, [("name", "duplicate")])


def test_a_patch_that_changes_nothing_is_a_no_op(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Steady Name")

    with CountListingUpdates(auth_env) as updates:
        same_name = patch_category(admin, created["id"], name=" Steady   Name ")
        empty = patch_category(admin, created["id"])
        same_flags = patch_category(
            admin, created["id"], isActive=True, displayOrder=created["displayOrder"]
        )

    assert same_name.status_code == empty.status_code == same_flags.status_code == 200
    assert (
        same_name.json()["data"]
        == empty.json()["data"]
        == same_flags.json()["data"]
        == created | {"updatedAt": same_name.json()["data"]["updatedAt"]}
    )
    assert updates.statements == []


@pytest.mark.parametrize("category", ["00000000-0000-4000-8000-000000000000", "nope", "5"])
def test_an_unknown_or_malformed_category_is_404(auth_env: AuthEnv, category: str) -> None:
    response = patch_category(admin_signed_in(auth_env), category, name="Whatever Name")

    assert (response.status_code, error_code(response)) == (404, "not_found")


def test_the_display_order_can_be_set_directly(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Pinned")

    response = patch_category(admin, created["id"], displayOrder=0)

    assert response.json()["data"]["displayOrder"] == 0
    assert public_names(auth_env, "food")[0] == "Pinned"


# -- in-use safety: deactivation and rename never break a listing ----------------------------------------


def test_a_deactivated_category_stays_on_its_listings_but_cannot_be_chosen_again(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    listing_id = created_id(owner, food_with(["bakeries", "cafes"], name="Retaining Bakery"))
    approve(admin, listing_id, 1)

    assert (
        patch_category(
            admin, category_id(auth_env.session, "food", "cafes"), isActive=False
        ).status_code
        == 200
    )

    data = mine(owner, listing_id)  # the link is intact, the primary is untouched
    assert data["food"]["categories"] == ["bakeries", "cafes"]
    assert [(c["slug"], c["isPrimary"]) for c in data["categories"]] == [
        ("bakeries", True),
        ("cafes", False),
    ]
    public = auth_env.client().get(f"/listings/{listing_id}").json()["data"]
    assert public["food"]["categories"] == ["bakeries", "cafes"]
    assert (
        auth_env.client()
        .get("/search", params={"vertical": "food", "foodCategory": "cafes"})
        .json()["data"]
    )
    # editing OTHER things works and keeps the inactive category
    kept = patch(owner, listing_id, 1, tags=["still", "fine"])
    assert kept.status_code == 200 and kept.json()["data"]["food"]["categories"] == [
        "bakeries",
        "cafes",
    ]
    # ... but nobody can newly choose it
    fresh = owner.request("POST", "/listings", json=food_with(["cafes"], name="Wants Inactive"))
    assert fresh.status_code == 422 and codes(fresh) == [("food.categories", "unknown_category")]
    switched = patch(owner, listing_id, 2, food={"categories": ["bakeries", "cafes", "bbq"]})
    assert (
        switched.status_code == 200
    )  # cafes was already on the listing: retained, not newly chosen
    swapped = patch(owner, listing_id, 3, food={"categories": ["bakeries", "restaurants"]})
    assert swapped.status_code == 200
    back = patch(owner, listing_id, 4, food={"categories": ["bakeries", "cafes"]})
    assert back.status_code == 422  # it was dropped, so it is now a NEW choice -> refused


def test_reactivating_makes_a_category_choosable_again(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    cafes = category_id(auth_env.session, "food", "cafes")
    patch_category(admin, cafes, isActive=False)
    assert owner.request("POST", "/listings", json=food_with(["cafes"])).status_code == 422

    patch_category(admin, cafes, isActive=True)

    assert owner.request("POST", "/listings", json=food_with(["cafes"])).status_code == 201


def test_food_stays_a_business_vertical_and_keeps_its_one_to_three_categories_rule(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    extra = created_category(admin, "food", "Street Snacks")  # a brand-new Food category

    ok = owner.request("POST", "/listings", json=food_with(["street-snacks", "bakeries", "cafes"]))
    too_many = owner.request(
        "POST", "/listings", json=food_with(["street-snacks", "bakeries", "cafes", "bbq"])
    )

    assert ok.status_code == 201
    data = ok.json()["data"]
    assert (data["kind"], data["vertical"]) == ("business", "food")  # never a new listing kind
    assert [(c["slug"], c["isPrimary"]) for c in data["categories"]][0] == ("street-snacks", True)
    assert too_many.status_code == 422 and codes(too_many) == [("food.categories", "too_many")]
    assert extra["module"] == "food"


def test_a_general_business_can_use_a_new_directory_category_but_not_a_food_one(
    auth_env: AuthEnv,
) -> None:
    from tests.db.write_helpers import business_body

    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    created_category(admin, "directory", "Bookshops")
    created_category(admin, "food", "Chai Corners")

    good = owner.request("POST", "/listings", json=business_body(category="bookshops"))
    wrong_module = owner.request("POST", "/listings", json=business_body(category="chai-corners"))

    assert good.status_code == 201 and good.json()["data"]["categoryLabel"] == "Bookshops"
    assert wrong_module.status_code == 422 and codes(wrong_module) == [
        ("category", "unknown_category")
    ]


# -- reorder -----------------------------------------------------------------------------------------


def test_a_reorder_renumbers_the_whole_group_one_to_n_in_the_order_given(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    ids = {r["slug"]: r["id"] for r in admin_categories(admin, "food") if "parentId" not in r}
    new_order = list(reversed(FOOD_SLUGS))

    response = reorder(admin, "food", None, [ids[slug] for slug in new_order])

    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [r["slug"] for r in rows] == new_order
    assert [r["displayOrder"] for r in rows] == list(range(1, 12))
    assert public_names(auth_env, "food") == [r["name"] for r in rows]  # the public order follows
    assert orders(admin, "food") == {slug: n for n, slug in enumerate(new_order, start=1)}
    assert (
        reorder(admin, "food", None, [ids[slug] for slug in new_order]).status_code == 200
    )  # idempotent


def test_a_group_of_children_is_reordered_on_its_own(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "services", "Reorder Root")
    kids = [created_category(admin, "services", f"Kid {n}", parentId=root["id"]) for n in "ABC"]
    top_level_before = orders(admin, "services")

    response = reorder(admin, "services", root["id"], [kids[2]["id"], kids[0]["id"], kids[1]["id"]])

    assert [r["name"] for r in response.json()["data"]] == ["Kid C", "Kid A", "Kid B"]
    assert orders(admin, "services") == top_level_before  # the top level was not renumbered


def test_inactive_categories_belong_to_the_group_and_must_be_listed(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    ids = {r["slug"]: r["id"] for r in admin_categories(admin, "food")}
    patch_category(admin, ids["bbq"], isActive=False)
    active_only = [ids[s] for s in FOOD_SLUGS if s != "bbq"]

    incomplete = reorder(admin, "food", None, active_only)
    complete = reorder(admin, "food", None, [ids[s] for s in FOOD_SLUGS])

    assert (incomplete.status_code, codes(incomplete)) == (422, [("orderedIds", "incomplete")])
    assert complete.status_code == 200


def snapshot_orders(api: Any) -> dict[str, tuple[int, str | None]]:
    return {r["id"]: (r["displayOrder"], r.get("parentId")) for r in admin_categories(api)}


def test_an_invalid_reorder_is_refused_whole_and_changes_nothing(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    foods = [r["id"] for r in admin_categories(admin, "food") if "parentId" not in r]
    services = [r["id"] for r in admin_categories(admin, "services") if "parentId" not in r]
    before = snapshot_orders(admin)
    rotated = [*foods[1:], foods[0]]

    duplicate = reorder(admin, "food", None, [*rotated, rotated[0]])
    missing = reorder(admin, "food", None, rotated[:-1])
    stranger = reorder(admin, "food", None, [*rotated[:-1], services[0]])
    unknown = reorder(admin, "food", None, [*rotated[:-1], str(uuid.uuid4())])
    wrong_parent = reorder(admin, "food", services[0], rotated)
    missing_parent = reorder(admin, "food", str(uuid.uuid4()), rotated)

    for response in (duplicate, missing, stranger, unknown, wrong_parent, missing_parent):
        assert response.status_code == 422, response.text
    assert ("orderedIds.11", "duplicate") in codes(duplicate)
    assert ("orderedIds", "incomplete") in codes(missing)
    assert ("orderedIds.10", "unknown_category") in codes(stranger)
    assert snapshot_orders(admin) == before  # atomic: no category moved


def test_a_reorder_body_needs_every_field(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    one = admin_categories(admin, "food")[0]["id"]
    url = f"{ADMIN_CATEGORIES}/reorder"

    assert (
        admin.request("POST", url, json={"module": "food", "orderedIds": [one]}).status_code == 422
    )
    assert admin.request("POST", url, json={"module": "food", "parentId": None}).status_code == 422
    assert (
        admin.request("POST", url, json={"parentId": None, "orderedIds": [one]}).status_code == 422
    )
    assert (
        admin.request(
            "POST", url, json={"module": "food", "parentId": None, "orderedIds": []}
        ).status_code
        == 422
    )
    assert (
        admin.request(
            "POST", url, json={"module": "food", "parentId": None, "orderedIds": [one], "x": 1}
        ).status_code
        == 422
    )


# -- search reindex (the critical part) --------------------------------------------------------------------


def listing_in(
    env: AuthEnv, owner: Any, admin: Any, categories: list[str], name: str, approved: bool = True
) -> str:
    listing_id = created_id(owner, food_with(categories, name=name))
    if approved:
        assert approve(admin, listing_id, 1).status_code == 200
    return listing_id


def test_a_rename_rewrites_the_search_document_of_every_listing_in_the_category(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    zebra = created_category(admin, "food", "Zebra Treats")
    approved_one = listing_in(
        auth_env, owner, admin, ["zebra-treats", "cafes"], "First Zebra Place"
    )
    pending_one = listing_in(
        auth_env, owner, admin, ["cafes", "zebra-treats"], "Second Zebra Place", approved=False
    )
    archived_one = listing_in(
        auth_env, owner, admin, ["zebra-treats"], "Third Zebra Place", approved=False
    )
    archive(owner, archived_one, 1)
    unrelated = listing_in(auth_env, owner, admin, ["bakeries"], "Unrelated Bakery")
    for listing_id in (approved_one, pending_one, archived_one):
        assert "zebra treats" in search_document(auth_env.session, listing_id)
    unrelated_before = search_document(auth_env.session, unrelated)

    with CountListingUpdates(auth_env) as updates:
        response = patch_category(admin, zebra["id"], name="Giraffe Treats")

    assert response.status_code == 200, response.text
    for listing_id in (approved_one, pending_one, archived_one):
        document = search_document(auth_env.session, listing_id)
        assert "giraffe treats" in document and "zebra treats" not in document
    assert search_document(auth_env.session, unrelated) == unrelated_before
    assert len(updates.statements) == 1  # one set-based flush for all three, not one per listing
    assert SearchIndexer(auth_env.session).find_stale() == []
    anonymous = auth_env.client()
    assert [
        h["item"]["name"]
        for h in anonymous.get("/search", params={"q": "Giraffe Treats"}).json()["data"]
    ] == ["First Zebra Place"]  # approved only
    assert anonymous.get("/search", params={"q": "Zebra Treats"}).json()["data"] == []


def test_a_rename_reindexes_many_listings_in_one_batch_not_one_update_per_listing(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    setup_admin = admin_signed_in(auth_env, "setup-admin@example.org")
    created_category(setup_admin, "food", "Batch Probe")
    for number in range(8):
        created_id(owner, food_with(["batch-probe"], name=f"Batch Listing {number}"))
    admin = admin_signed_in(auth_env, "batch-admin@example.org")

    with CountListingUpdates(auth_env) as updates:
        response = patch_category(
            admin, category_id(auth_env.session, "food", "batch-probe"), name="Batch Renamed"
        )

    assert response.status_code == 200
    assert len(updates.statements) == 1  # eight rows, one executemany flush
    assert SearchIndexer(auth_env.session).find_stale() == []
    auth_env.session.expire_all()
    documents = auth_env.session.execute(text("SELECT search_document FROM listings")).all()
    assert len(documents) == 8 and all("batch renamed" in doc for (doc,) in documents)


def test_only_a_rename_touches_search_documents(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    created_category(admin, "food", "Quiet Category")
    listing_id = listing_in(auth_env, owner, admin, ["quiet-category"], "Quiet Listing")
    quiet = category_id(auth_env.session, "food", "quiet-category")
    parent = created_category(admin, "food", "Quiet Parent")
    before = search_document(auth_env.session, listing_id)

    with CountListingUpdates(auth_env) as updates:
        patch_category(admin, quiet, isActive=False)
        patch_category(admin, quiet, isActive=True)
        patch_category(admin, quiet, displayOrder=3)
        patch_category(admin, quiet, parentId=parent["id"])
        patch_category(admin, quiet, parentId=None)
        patch_category(admin, quiet, name="  Quiet   Category ")  # whitespace only
        patch_category(admin, parent["id"], name="Renamed Parent")  # nobody is in it

    assert updates.statements == []
    assert search_document(auth_env.session, listing_id) == before


def test_renaming_a_parent_does_not_change_the_documents_of_its_children_s_listings(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    root = created_category(admin, "food", "Family Root")
    created_category(admin, "food", "Family Child", parentId=root["id"])
    listing_id = listing_in(auth_env, owner, admin, ["family-child"], "Child Listing")
    before = search_document(auth_env.session, listing_id)

    patch_category(admin, root["id"], name="Renamed Family Root")

    assert search_document(auth_env.session, listing_id) == before
    assert "family child" in before


def test_a_category_name_with_no_listing_is_renamed_without_touching_any_listing(
    auth_env: AuthEnv,
) -> None:
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "food", "Lonely One")

    with CountListingUpdates(auth_env) as updates:
        response = patch_category(admin, created["id"], name="Lonely Two")

    assert response.status_code == 200 and updates.statements == []


def test_the_seed_never_overwrites_an_admins_taxonomy_edits(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    bakeries = category_id(auth_env.session, "food", "bakeries")
    patch_category(admin, bakeries, name="Renamed Bakeries", isActive=False)

    inserted = seed_reference_data(auth_env.session)
    auth_env.session.commit()

    row = [r for r in admin_categories(admin, "food") if r["id"] == bakeries][0]
    assert (row["name"], row["isActive"]) == ("Renamed Bakeries", False)
    assert inserted == 0


# -- public regression -------------------------------------------------------------------------------------


def test_the_public_category_api_shows_only_active_categories_in_display_order(
    auth_env: AuthEnv,
) -> None:
    admin = admin_signed_in(auth_env)
    hidden = created_category(admin, "directory", "Hidden Shops")
    created_category(admin, "directory", "Visible Shops")
    patch_category(admin, hidden["id"], isActive=False)

    rows = auth_env.client().get(PUBLIC_CATEGORIES, params={"module": "directory"}).json()["data"]

    names = [r["name"] for r in rows]
    assert "Visible Shops" in names and "Hidden Shops" not in names
    assert [r["displayOrder"] for r in rows] == sorted(r["displayOrder"] for r in rows)
    assert all("isActive" not in r for r in rows)  # the public shape is unchanged


def test_listing_writes_still_work_after_every_kind_of_taxonomy_change(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    created = created_category(admin, "services", "Fresh Trade")
    patch_category(admin, created["id"], name="Fresh Trades")
    reorder(admin, "services", None, [r["id"] for r in admin_categories(admin, "services")][::-1])

    response = owner.request("POST", "/listings", json=provider_body(category="fresh-trade"))

    assert (
        response.status_code == 201 and response.json()["data"]["categoryLabel"] == "Fresh Trades"
    )
    set_status(auth_env.session, response.json()["data"]["id"], ListingStatus.APPROVED)
    assert SearchIndexer(auth_env.session).find_stale() == []


def test_the_pending_text_of_a_listing_is_not_searchable_until_it_is_approved_whatever_the_taxonomy_does(
    auth_env: AuthEnv,
) -> None:
    owner = owner_signed_in(auth_env)
    admin = admin_signed_in(auth_env)
    created_category(admin, "food", "Pending Probe Cat")
    listing_id = pending(owner, food_with(["pending-probe-cat"], name="Pending Probe Listing"))
    patch_category(
        admin,
        category_id(auth_env.session, "food", "pending-probe-cat"),
        name="Pending Renamed Cat",
    )

    anonymous = auth_env.client()
    assert anonymous.get("/search", params={"q": "Pending Renamed Cat"}).json()["data"] == []
    assert approve(admin, listing_id, 1).status_code == 200
    assert anonymous.get("/search", params={"q": "Pending Renamed Cat"}).json()["data"]
