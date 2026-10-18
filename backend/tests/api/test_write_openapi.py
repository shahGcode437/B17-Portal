"""The OpenAPI surface of the Phase 12D write endpoints (database-free).

Only the real 12D operations exist outside /admin (no Saved, no requests, no public category writes); the
request schemas cannot even DESCRIBE a server-owned field; the public coordinates are not writable;
the revision token is the one required field of PATCH and archive.
"""

from typing import Any

import pytest

from app.core.config import Settings
from app.factory import create_app

PREFIX = "/api/v1"
SERVER_OWNED = {
    "id",
    "ownerId",
    "userId",
    "status",
    "revision",
    "featured",
    "isFeatured",
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
    "planCode",
    "publicLatitude",
    "publicLongitude",
    "searchDocument",
    "coordinates",
}
REQUEST_SCHEMAS = [
    "ProviderCreate",
    "BusinessCreate",
    "TutorCreate",
    "PropertyCreate",
    "ListingPatch",
    "LocationInput",
    "FoodInput",
    "FoodPatch",
    "MenuItemInput",
    "ArchiveRequest",
    "ProfessionalProfileRequest",
]


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    app = create_app(Settings(_env_file=None, environment="test", app_version="0.0.0-test"))
    doc: dict[str, Any] = app.openapi()
    return doc


def schemas(document: dict[str, Any]) -> dict[str, Any]:
    components: dict[str, Any] = document["components"]["schemas"]
    return components


def operations(document: dict[str, Any]) -> set[tuple[str, str]]:
    return {
        (method.upper(), path.removeprefix(PREFIX))
        for path, ops in document["paths"].items()
        for method in ops
    }


def test_exactly_the_12d_operations_were_added(document: dict[str, Any]) -> None:
    written = {
        (method, path)
        for method, path in operations(document)
        if method != "GET" and not path.startswith(("/auth/", "/health", "/admin/"))
    }

    assert written == {
        ("PUT", "/users/me/professional-profile"),
        ("POST", "/listings"),
        ("PATCH", "/listings/{listing_id}"),
        ("POST", "/listings/{listing_id}/archive"),
    }
    reads = {(method, path) for method, path in operations(document) if path.startswith("/users/")}
    assert reads >= {
        ("GET", "/users/me/listings"),
        ("GET", "/users/me/listings/{listing_id}"),
    }


def test_nothing_from_later_slices_leaked_in(document: dict[str, Any]) -> None:
    paths = [path.removeprefix(PREFIX) for path in document["paths"]]

    for later in ("/saved", "/requests", "/leads", "/media", "/upload"):
        assert not any(later in path for path in paths), later
    # Phase 12E added the admin moderation + taxonomy routes (and nothing else under /admin)
    assert not any(path.endswith("/unarchive") for path in paths)
    assert not any(
        path.endswith(("/approve", "/reject")) for path in paths if not path.startswith("/admin/")
    )
    assert {m for m, p in operations(document) if p == "/categories"} == {
        "GET"
    }  # the PUBLIC category route is read-only (writes live under /admin/categories)


@pytest.mark.parametrize("name", REQUEST_SCHEMAS)
def test_no_request_schema_can_describe_a_server_owned_field(
    document: dict[str, Any], name: str
) -> None:
    properties = set(schemas(document)[name].get("properties", {}))

    allowed_token = {"revision"} if name in ("ListingPatch", "ArchiveRequest") else set()
    assert properties & SERVER_OWNED == allowed_token, name


def test_the_revision_is_the_only_required_field_of_patch_and_archive(
    document: dict[str, Any],
) -> None:
    assert schemas(document)["ListingPatch"]["required"] == ["revision"]
    assert schemas(document)["ArchiveRequest"]["required"] == ["revision"]
    for name in ("ProviderCreate", "BusinessCreate", "TutorCreate", "PropertyCreate"):
        assert "revision" not in schemas(document)[name]["properties"], name


def test_create_is_a_union_discriminated_on_kind(document: dict[str, Any]) -> None:
    body = document["paths"][f"{PREFIX}/listings"]["post"]["requestBody"]["content"][
        "application/json"
    ]["schema"]

    assert body["discriminator"]["propertyName"] == "kind"
    assert set(body["discriminator"]["mapping"]) == {"provider", "business", "tutor", "property"}
    assert len(body["oneOf"]) == 4
    for name, kind in (
        ("ProviderCreate", "provider"),
        ("BusinessCreate", "business"),
        ("TutorCreate", "tutor"),
        ("PropertyCreate", "property"),
    ):
        assert schemas(document)[name]["properties"]["kind"]["const"] == kind


def test_food_is_a_business_vertical_not_a_kind(document: dict[str, Any]) -> None:
    kinds = {
        schemas(document)[name]["properties"]["kind"]["const"]
        for name in ("ProviderCreate", "BusinessCreate", "TutorCreate", "PropertyCreate")
    }

    assert kinds == {"provider", "business", "tutor", "property"}
    assert "food" in schemas(document)["BusinessCreate"]["properties"]
    assert schemas(document)["BusinessVertical"]["enum"] == ["general", "food"]
    assert schemas(document)["ListingKind"]["enum"] == ["provider", "business", "tutor", "property"]


def test_the_public_coordinates_are_not_writable(document: dict[str, Any]) -> None:
    location = schemas(document)["LocationInput"]["properties"]

    assert set(location) == {"visibility", "block", "address", "landmark", "latitude", "longitude"}
    assert "coordinates" not in location and "publicLatitude" not in location


def test_public_location_stays_free_of_the_private_point(document: dict[str, Any]) -> None:
    public = set(schemas(document)["LocationRead"]["properties"])
    owner = set(schemas(document)["OwnerLocation"]["properties"])

    assert "latitude" not in public and "longitude" not in public
    assert {"latitude", "longitude", "address", "landmark"} <= owner
    for name in ("OwnerProvider", "OwnerBusiness", "OwnerTutor", "OwnerProperty"):
        properties = schemas(document)[name]["properties"]
        assert {"status", "revision", "location", "publicLocation"} <= set(properties), name
        assert not {"ownerId", "passwordHash", "email", "searchDocument"} & set(properties), name


def test_the_documented_responses(document: dict[str, Any]) -> None:
    def codes(method: str, path: str) -> set[str]:
        return set(document["paths"][f"{PREFIX}{path}"][method]["responses"])

    assert {"201", "401", "403", "422", "429"} <= codes("post", "/listings")
    assert {"200", "401", "403", "404", "409", "422"} <= codes("patch", "/listings/{listing_id}")
    assert {"200", "404", "409", "422"} <= codes("post", "/listings/{listing_id}/archive")
    assert {"200", "201", "401", "403", "422"} <= codes("put", "/users/me/professional-profile")
    assert {"200", "404"} <= codes("get", "/users/me/listings/{listing_id}")


def test_the_profile_put_has_an_optional_empty_body(document: dict[str, Any]) -> None:
    operation = document["paths"][f"{PREFIX}/users/me/professional-profile"]["put"]

    assert operation["requestBody"].get("required", False) is False
    assert schemas(document)["ProfessionalProfileRequest"].get("properties", {}) == {}
