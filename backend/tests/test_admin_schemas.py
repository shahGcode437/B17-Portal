"""The admin request schemas (Phase 12E): strict, shape-only, nothing server-owned. No database."""

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.admin import (
    AdminListingsQuery,
    ApproveRequest,
    CategoryCreate,
    CategoryPatch,
    CategoryReorder,
    RejectRequest,
)


def failures(error: ValidationError) -> list[tuple[str, str]]:
    return [(".".join(str(part) for part in e["loc"]), e["type"]) for e in error.errors()]


def rejected(model: Any, body: dict[str, Any]) -> list[tuple[str, str]]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(body)
    return failures(caught.value)


# -- moderation bodies --------------------------------------------------------------------------


def test_approve_takes_only_the_reviewed_revision() -> None:
    assert ApproveRequest.model_validate({"revision": 3}).revision == 3
    for body in ({}, {"revision": 0}, {"revision": "3"}, {"revision": True}, {"revision": None}):
        assert rejected(ApproveRequest, body), body


@pytest.mark.parametrize(
    "extra", ["status", "ownerId", "reason", "moderatedBy", "approvedAt", "featured", "kind"]
)
def test_approve_refuses_every_other_field(extra: str) -> None:
    assert (extra, "not_allowed") in rejected(ApproveRequest, {"revision": 1, extra: "x"})


def test_reject_needs_a_revision_and_a_reason() -> None:
    assert RejectRequest.model_validate({"revision": 2, "reason": "Add the opening hours."})
    assert ("revision", "missing") in rejected(RejectRequest, {"reason": "Add the hours."})
    assert ("reason", "missing") in rejected(RejectRequest, {"revision": 1})


@pytest.mark.parametrize("reason", ["", "   ", None, 12345, ["x"]])
def test_a_missing_or_blank_reason_is_refused(reason: Any) -> None:
    assert rejected(RejectRequest, {"revision": 1, "reason": reason})


def test_a_reason_is_trimmed_may_have_line_breaks_but_no_control_characters() -> None:
    parsed = RejectRequest.model_validate({"revision": 1, "reason": "  Add hours.\nAdd a photo.  "})

    assert parsed.reason == "Add hours.\nAdd a photo."
    assert rejected(RejectRequest, {"revision": 1, "reason": "bad\x00character here"})


def test_a_reason_has_an_upper_bound() -> None:
    assert rejected(RejectRequest, {"revision": 1, "reason": "x" * 2000})


@pytest.mark.parametrize("extra", ["status", "ownerId", "moderatedBy", "listingId", "action"])
def test_reject_refuses_every_other_field(extra: str) -> None:
    body = {"revision": 1, "reason": "Add the opening hours.", extra: "x"}

    assert (extra, "not_allowed") in rejected(RejectRequest, body)


# -- queue query --------------------------------------------------------------------------------


def test_the_queue_query_defaults_and_bounds() -> None:
    query = AdminListingsQuery.model_validate({})

    assert (query.status, query.kind, query.limit, query.offset) == (None, None, 12, 0)
    assert AdminListingsQuery.model_validate({"status": "", "kind": ""}).status is None
    for bad in (
        {"status": "draft"},
        {"kind": "service"},
        {"limit": 0},
        {"limit": 51},
        {"offset": -1},
    ):
        assert rejected(AdminListingsQuery, bad), bad


# -- category bodies ------------------------------------------------------------------------------


def test_create_needs_a_module_and_a_name_and_accepts_the_optional_ones() -> None:
    minimal = CategoryCreate.model_validate({"module": "food", "name": "Sweet Shops"})
    full = CategoryCreate.model_validate(
        {
            "module": "food",
            "name": "Sweet Shops",
            "slug": "sweet-shops",
            "parentId": str(uuid.uuid4()),
            "displayOrder": 4,
        }
    )

    assert (minimal.slug, minimal.parent_id, minimal.display_order) == (None, None, None)
    assert full.display_order == 4


@pytest.mark.parametrize("module", ["marketplace", "pharmacy", "FOOD", "", None, 3])
def test_an_admin_cannot_invent_a_module(module: Any) -> None:
    assert rejected(CategoryCreate, {"module": module, "name": "Used Mobiles"})


@pytest.mark.parametrize(
    "extra",
    [
        "id",
        "isActive",
        "createdAt",
        "updatedAt",
        "status",
        "ownerId",
        "icon",
        "children",
        "deletedAt",
    ],
)
def test_create_refuses_server_owned_fields(extra: str) -> None:
    body = {"module": "food", "name": "Sweet Shops", extra: "x"}

    assert (extra, "not_allowed") in rejected(CategoryCreate, body)


@pytest.mark.parametrize("name", ["A", "", "   ", "x" * 61, "bad\x00name", "line\nbreak"])
def test_a_category_name_is_two_to_sixty_printable_characters(name: str) -> None:
    assert rejected(CategoryCreate, {"module": "food", "name": name})


@pytest.mark.parametrize("order", [-1, 100_001, 1.5, "3", True])
def test_a_display_order_is_a_bounded_integer(order: Any) -> None:
    assert rejected(
        CategoryCreate, {"module": "food", "name": "Sweet Shops", "displayOrder": order}
    )


def test_patch_accepts_exactly_the_mutable_fields_and_tracks_what_was_sent() -> None:
    parsed = CategoryPatch.model_validate({"name": "New", "parentId": None, "isActive": False})

    assert parsed.model_fields_set == {"name", "parent_id", "is_active"}
    assert CategoryPatch.model_validate({}).model_fields_set == set()


@pytest.mark.parametrize(
    "field",
    ["module", "slug", "id", "createdAt", "updatedAt", "status", "children", "listingCount"],
)
def test_patch_refuses_immutable_and_server_owned_fields(field: str) -> None:
    assert (field, "not_allowed") in rejected(CategoryPatch, {field: "x"})


def test_reorder_needs_all_three_fields_and_a_null_parent_must_be_explicit() -> None:
    ids = [str(uuid.uuid4()) for _ in range(2)]

    assert CategoryReorder.model_validate({"module": "food", "parentId": None, "orderedIds": ids})
    assert ("parentId", "missing") in rejected(
        CategoryReorder, {"module": "food", "orderedIds": ids}
    )
    assert ("orderedIds", "missing") in rejected(
        CategoryReorder, {"module": "food", "parentId": None}
    )
    assert ("module", "missing") in rejected(CategoryReorder, {"parentId": None, "orderedIds": ids})
    assert rejected(CategoryReorder, {"module": "food", "parentId": None, "orderedIds": []})
    assert rejected(
        CategoryReorder, {"module": "food", "parentId": None, "orderedIds": ["not-a-uuid"]}
    )
    assert rejected(CategoryReorder, {"module": "nope", "parentId": None, "orderedIds": ids})
