"""The OpenAPI surface of the Phase 12E Admin group (database-free).

Exactly the frozen moderation + taxonomy operations exist (no delete, no module endpoint, no role
management, nothing from Saved / requests); the request schemas cannot describe a server-owned or
immutable field; the responses cannot describe a secret.
"""

from typing import Any

import pytest

from app.core.config import Settings
from app.factory import create_app
from app.models.enums import CategoryModule

PREFIX = "/api/v1"


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    app = create_app(Settings(_env_file=None, environment="test", app_version="0.0.0-test"))
    doc: dict[str, Any] = app.openapi()
    return doc


def schemas(document: dict[str, Any]) -> dict[str, Any]:
    components: dict[str, Any] = document["components"]["schemas"]
    return components


def admin_operations(document: dict[str, Any]) -> set[tuple[str, str]]:
    return {
        (method.upper(), path.removeprefix(PREFIX))
        for path, ops in document["paths"].items()
        if path.startswith(f"{PREFIX}/admin")
        for method in ops
    }


def test_exactly_the_frozen_admin_operations_exist(document: dict[str, Any]) -> None:
    assert admin_operations(document) == {
        ("GET", "/admin/listings"),
        ("GET", "/admin/listings/{listing_id}"),
        ("POST", "/admin/listings/{listing_id}/approve"),
        ("POST", "/admin/listings/{listing_id}/reject"),
        ("GET", "/admin/categories"),
        ("POST", "/admin/categories"),
        ("POST", "/admin/categories/reorder"),
        ("PATCH", "/admin/categories/{category_id}"),
    }


def test_there_is_no_delete_no_module_endpoint_no_role_management_and_no_later_slice(
    document: dict[str, Any],
) -> None:
    operations = admin_operations(document)
    paths = [path for _, path in operations]

    assert not any(
        method == "DELETE" for method, _ in operations
    )  # a used category cannot be deleted
    assert not any(method == "PUT" for method, _ in operations)
    for forbidden in (
        "module",
        "role",
        "user",
        "admin/news",
        "saved",
        "request",
        "archive",
        "featured",
    ):
        assert not any(forbidden in path.removeprefix("/admin") for path in paths), forbidden
    assert not any(
        later in path
        for path in document["paths"]
        for later in ("/media", "/upload", "/notifications", "/payments", "/chat")
    )


def test_every_admin_operation_documents_the_auth_failures(document: dict[str, Any]) -> None:
    for path, ops in document["paths"].items():
        if not path.startswith(f"{PREFIX}/admin"):
            continue
        for method, operation in ops.items():
            assert {"401", "403"} <= set(operation["responses"]), (method, path)


def test_the_moderation_request_bodies(document: dict[str, Any]) -> None:
    approve = schemas(document)["ApproveRequest"]
    reject = schemas(document)["RejectRequest"]

    assert set(approve["properties"]) == {"revision"} and approve["required"] == ["revision"]
    assert set(reject["properties"]) == {"revision", "reason"}
    assert set(reject["required"]) == {"revision", "reason"}
    assert (
        reject["properties"]["reason"]["minLength"] == 1
        and "maxLength" in reject["properties"]["reason"]
    )


def test_the_category_request_bodies_cannot_describe_immutable_or_server_owned_fields(
    document: dict[str, Any],
) -> None:
    create = schemas(document)["CategoryCreate"]
    patch = schemas(document)["CategoryPatch"]
    reorder = schemas(document)["CategoryReorder"]

    assert set(create["properties"]) == {"module", "name", "slug", "parentId", "displayOrder"}
    assert set(create["required"]) == {"module", "name"}
    assert set(patch["properties"]) == {
        "name",
        "parentId",
        "isActive",
        "displayOrder",
    }  # no module, no slug
    assert "required" not in patch  # every field optional: omitted = unchanged
    assert set(reorder["properties"]) == {"module", "parentId", "orderedIds"}
    assert set(reorder["required"]) == {"module", "parentId", "orderedIds"}
    for body in (create, patch, reorder):
        assert not {"id", "createdAt", "updatedAt", "status", "ownerId", "children"} & set(
            body["properties"]
        )


def test_modules_are_a_closed_code_defined_set(document: dict[str, Any]) -> None:
    assert schemas(document)["CategoryModule"]["enum"] == [m.value for m in CategoryModule]
    assert set(schemas(document)["CategoryModule"]["enum"]) == {
        "services", "directory", "food", "education", "property", "news",
    }  # fmt: skip


def test_admin_responses_describe_no_secret(document: dict[str, Any]) -> None:
    secret = {
        "email", "password", "passwordHash", "csrfToken", "token", "sessionId", "authMethods",
        "emailVerified", "providerSubject", "roles", "ownerId", "searchDocument",
    }  # fmt: skip
    for name in (
        "AdminListingSummary", "AdminSubmitter", "AdminActor", "AdminHistoryEntry", "AdminCategory",
        "AdminProvider", "AdminBusiness", "AdminTutor", "AdminProperty",
    ):  # fmt: skip
        properties = set(schemas(document)[name]["properties"])
        assert not secret & properties, (name, secret & properties)
    assert set(schemas(document)["AdminSubmitter"]["properties"]) == {"displayName"}


def test_the_queue_row_has_no_private_location_and_the_detail_is_a_discriminated_union(
    document: dict[str, Any],
) -> None:
    summary = set(schemas(document)["AdminListingSummary"]["properties"])
    assert not {"location", "latitude", "longitude", "address", "landmark", "description"} & summary
    assert {
        "id",
        "kind",
        "title",
        "status",
        "revision",
        "locationVisibility",
        "submitter",
    } <= summary

    detail = schemas(document)["AdminListingEnvelope"]["properties"]["data"]
    assert detail["discriminator"]["propertyName"] == "kind"
    assert set(detail["discriminator"]["mapping"]) == {"provider", "business", "tutor", "property"}
    for name in ("AdminProvider", "AdminBusiness", "AdminTutor", "AdminProperty"):
        props = set(schemas(document)[name]["properties"])
        assert {"location", "publicLocation", "history", "submitter", "revision", "status"} <= props


def test_the_documented_status_codes(document: dict[str, Any]) -> None:
    def codes(method: str, path: str) -> set[str]:
        return set(document["paths"][f"{PREFIX}{path}"][method]["responses"])

    assert {"200", "404"} <= codes("get", "/admin/listings/{listing_id}")
    assert {"200", "404", "409", "422"} <= codes("post", "/admin/listings/{listing_id}/approve")
    assert {"200", "404", "409", "422"} <= codes("post", "/admin/listings/{listing_id}/reject")
    assert {"201", "409", "422"} <= codes("post", "/admin/categories")
    assert {"200", "404", "409", "422"} <= codes("patch", "/admin/categories/{category_id}")
    assert {"200", "422"} <= codes("post", "/admin/categories/reorder")
