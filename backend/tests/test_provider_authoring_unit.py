"""RBAC-D, DB-free: the shape of the staff Provider API's request bodies and the pure helpers of
``ProviderAuthoringService`` (docs/backend/AUTH_RBAC.md §31, API_CONTRACT.md §16).

A Provider body describes CONTENT only. Everything that could name an owner, a kind, a lifecycle
state, an actor, a role or a scope is an undeclared key — refused with ``not_allowed``, whatever its
value — so a client can never smuggle authority or ownership through a body.
"""

import dataclasses

import pytest
from pydantic import ValidationError

from app.models.enums import ListingKind, LocationVisibility
from app.schemas.provider_admin import (
    ProviderArchiveRequest,
    ProviderCreateRequest,
    ProviderPatchRequest,
)
from app.schemas.write import ListingPatch
from app.services.listing_state import ListingState, LocationState
from app.services.provider_authoring import PROVIDER_SCOPE, _as_patch, changed_fields
from tests.write_payloads import staff_provider_body

#: Every key that must never be accepted from a client of the staff Provider API.
FORGED_KEYS = [
    "kind",
    "vertical",
    "ownerId",
    "owner",
    "owner_id",
    "status",
    "revision",  # create only: a new Provider always starts at revision 1
    "role",
    "roles",
    "scope",
    "scopes",
    "staffScopes",
    "actorUserId",
    "actor",
    "managedBy",
    "createdBy",
    "featured",
    "isFeatured",
    "moderation",
    "auditReason",
    "sessionId",
    "submittedAt",
    "grade",
    "price",
    "food",
    "propertyType",
    "listingType",
]
FORGED_VALUES: list[object] = [
    "x",
    None,
    "",
    0,
    True,
    [],
    {},
    "00000000-0000-0000-0000-000000000000",
]


def keys_of(error: ValidationError) -> set[tuple[str, str]]:
    return {(str(item["loc"][-1]), item["type"]) for item in error.errors()}


def test_a_valid_staff_create_body_parses_and_has_no_kind_field() -> None:
    parsed = ProviderCreateRequest.model_validate(staff_provider_body())

    assert parsed.name == "Bright Spark Electricians" and parsed.category == "electrical"
    assert "kind" not in ProviderCreateRequest.model_fields
    assert "ownerId" not in {
        field.alias or name for name, field in ProviderCreateRequest.model_fields.items()
    }


@pytest.mark.parametrize("key", FORGED_KEYS)
@pytest.mark.parametrize("value", FORGED_VALUES, ids=repr)
def test_a_forged_key_is_refused_on_create_whatever_its_value(key: str, value: object) -> None:
    with pytest.raises(ValidationError) as refused:
        ProviderCreateRequest.model_validate(staff_provider_body(**{key: value}))

    assert (key, "not_allowed") in keys_of(refused.value)


@pytest.mark.parametrize("key", [key for key in FORGED_KEYS if key != "revision"])
@pytest.mark.parametrize("value", FORGED_VALUES, ids=repr)
def test_a_forged_key_is_refused_on_edit_whatever_its_value(key: str, value: object) -> None:
    with pytest.raises(ValidationError) as refused:
        ProviderPatchRequest.model_validate({"revision": 1, key: value})

    assert (key, "not_allowed") in keys_of(refused.value)


@pytest.mark.parametrize("key", [key for key in FORGED_KEYS if key != "revision"])
def test_a_forged_key_is_refused_on_archive(key: str) -> None:
    with pytest.raises(ValidationError) as refused:
        ProviderArchiveRequest.model_validate({"revision": 1, key: "x"})

    assert (key, "not_allowed") in keys_of(refused.value)


def test_snake_case_names_are_not_accepted() -> None:
    with pytest.raises(ValidationError) as refused:
        ProviderCreateRequest.model_validate(staff_provider_body(owner_id="x"))

    assert ("owner_id", "not_allowed") in keys_of(refused.value)


def test_the_revision_is_required_and_strict_on_edit_and_archive() -> None:
    for model in (ProviderPatchRequest, ProviderArchiveRequest):
        for bad in (None, "1", 0, -1, 1.5, True, 2_147_483_648):
            with pytest.raises(ValidationError):
                model.model_validate({"revision": bad})
        with pytest.raises(ValidationError):
            model.model_validate({})
        assert model.model_validate({"revision": 3}).revision == 3


def test_an_empty_edit_carries_only_the_revision() -> None:
    patch = ProviderPatchRequest.model_validate({"revision": 2})

    assert patch.model_fields_set == {"revision"}


# -- the staff PATCH becomes the shared patch shape without losing "omitted" vs "null" -----------


def test_the_shared_patch_carries_exactly_the_fields_the_client_sent() -> None:
    sent = ProviderPatchRequest.model_validate({"revision": 4, "image": None, "name": "New Name"})

    shared = _as_patch(sent)

    assert isinstance(shared, ListingPatch)
    assert shared.model_fields_set == {"revision", "image", "name"}
    assert shared.revision == 4 and shared.image is None and shared.name == "New Name"
    assert shared.description is None and "description" not in shared.model_fields_set


def test_the_shared_patch_cannot_carry_a_field_a_provider_does_not_have() -> None:
    names = set(ProviderPatchRequest.model_fields)

    assert names <= set(ListingPatch.model_fields)  # every staff field is a real patch field
    for foreign in ("vertical", "food", "grade", "listing_type", "property_type", "price"):
        assert foreign not in names


# -- changed_fields: the API names of what differs, never the values ------------------------------


def state(**changes: object) -> ListingState:
    base = ListingState(
        kind=ListingKind.PROVIDER,
        title="Bright Spark",
        description="A clean, friendly place that has served the neighbourhood.",
        area="B-17",
        tags=("wiring",),
        image=None,
        location=LocationState(visibility=LocationVisibility.AREA_ONLY),
        category="electrical",
    )
    return dataclasses.replace(base, **changes)  # type: ignore[arg-type]


def test_nothing_changed_lists_nothing() -> None:
    assert changed_fields(state(), state()) == []


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"title": "Other"}, ["name"]),
        ({"category": "plumbing"}, ["category"]),
        ({"area": "B-17 Block C"}, ["area"]),
        ({"description": "A different description of the service."}, ["description"]),
        ({"tags": ("wiring", "repairs")}, ["tags"]),
        ({"image": "/images/x.jpg"}, ["image"]),
        (
            {"location": LocationState(visibility=LocationVisibility.AREA_ONLY, block="C")},
            ["location"],
        ),
        ({"title": "Other", "tags": ()}, ["name", "tags"]),
    ],
)
def test_changed_fields_names_exactly_the_fields_that_differ(
    change: dict[str, object], expected: list[str]
) -> None:
    assert changed_fields(state(), state(**change)) == expected


def test_changed_fields_never_contains_a_value() -> None:
    names = changed_fields(state(), state(title="Secret Name", image="/private.jpg"))

    assert names == ["name", "image"]
    assert all(isinstance(name, str) and len(name) <= 40 for name in names)
    assert len(names) <= 12  # the staff audit's list limit


def test_the_provider_scope_is_services() -> None:
    from app.models.enums import StaffScope
    from app.services.staff_scopes import listing_scope

    assert PROVIDER_SCOPE is StaffScope.SERVICES
    assert listing_scope(ListingKind.PROVIDER, None) is PROVIDER_SCOPE
