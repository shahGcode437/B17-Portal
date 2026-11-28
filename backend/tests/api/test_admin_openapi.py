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


#: The Phase 12E surface (moderation + taxonomy): unchanged by RBAC-C.
PHASE_12E_OPERATIONS = {
    ("GET", "/admin/listings"),
    ("GET", "/admin/listings/{listing_id}"),
    ("POST", "/admin/listings/{listing_id}/approve"),
    ("POST", "/admin/listings/{listing_id}/reject"),
    ("GET", "/admin/categories"),
    ("POST", "/admin/categories"),
    ("POST", "/admin/categories/reorder"),
    ("PATCH", "/admin/categories/{category_id}"),
}
#: RBAC-C: staff management. Moderators only; there is NO Super Admin promotion / demotion route.
RBAC_C_OPERATIONS = {
    ("GET", "/admin/staff"),
    ("GET", "/admin/audit"),
    ("POST", "/admin/staff/moderators"),
    ("PUT", "/admin/staff/moderators/{user_id}/scopes"),
    ("POST", "/admin/staff/moderators/{user_id}/pause"),
    ("POST", "/admin/staff/moderators/{user_id}/resume"),
    ("DELETE", "/admin/staff/moderators/{user_id}"),
}
#: RBAC-D: staff Provider authoring. No DELETE / restore / ownership route: a Provider is
#: portal-managed, archived terminally, and never assigned to anyone.
RBAC_D_PROVIDER_OPERATIONS = {
    ("POST", "/admin/providers"),
    ("PATCH", "/admin/providers/{provider_id}"),
    ("POST", "/admin/providers/{provider_id}/archive"),
}
#: RBAC-D: the portal's Service request handling (the provider side of a request, by staff). The
#: lifecycle is the existing one: there is no reject / assign / reassign / delete route.
RBAC_D_REQUEST_OPERATIONS = {
    ("GET", "/admin/requests"),
    ("GET", "/admin/requests/{request_id}"),
    ("POST", "/admin/requests/{request_id}/accept"),
    ("POST", "/admin/requests/{request_id}/start"),
    ("POST", "/admin/requests/{request_id}/complete"),
    ("POST", "/admin/requests/{request_id}/cancel"),
}
RBAC_D_OPERATIONS = RBAC_D_PROVIDER_OPERATIONS | RBAC_D_REQUEST_OPERATIONS
#: GROCERY-1b: the Super Admin's operating settings. GROCERY-2: the staff order routes.
GROCERY_OPERATIONS = {
    ("GET", "/admin/grocery/settings"),
    ("PATCH", "/admin/grocery/settings"),
    ("GET", "/admin/grocery/orders"),
    ("GET", "/admin/grocery/orders/{order_id}"),
    ("POST", "/admin/grocery/orders/{order_id}/claim"),
    ("POST", "/admin/grocery/orders/{order_id}/release"),
    ("POST", "/admin/grocery/orders/{order_id}/confirm"),
    ("POST", "/admin/grocery/orders/{order_id}/reconfirm"),
    ("POST", "/admin/grocery/orders/{order_id}/reduce-amount"),
    ("POST", "/admin/grocery/orders/{order_id}/start-preparing"),
    ("POST", "/admin/grocery/orders/{order_id}/dispatch"),
    ("POST", "/admin/grocery/orders/{order_id}/delivery-failed"),
    ("POST", "/admin/grocery/orders/{order_id}/complete"),
    ("POST", "/admin/grocery/orders/{order_id}/cancel"),
    ("POST", "/admin/grocery/orders/{order_id}/issues"),
    ("POST", "/admin/grocery/orders/{order_id}/record-payment"),
    ("POST", "/admin/grocery/orders/{order_id}/refund"),
}


def test_exactly_the_frozen_admin_operations_exist(document: dict[str, Any]) -> None:
    assert admin_operations(document) == (
        PHASE_12E_OPERATIONS | RBAC_C_OPERATIONS | RBAC_D_OPERATIONS | GROCERY_OPERATIONS
    )


def test_the_phase_12e_surface_has_no_delete_no_module_endpoint_and_no_later_slice(
    document: dict[str, Any],
) -> None:
    """The moderation + taxonomy routes are unchanged: no DELETE / PUT, no module / role / user
    endpoint, nothing from a later slice. (RBAC-C's staff routes are checked separately below.)"""
    operations = {
        (method, path)
        for method, path in admin_operations(document)
        if path not in _staff_paths()
        and (method, path) not in RBAC_D_OPERATIONS | GROCERY_OPERATIONS
    }
    paths = [path for _, path in operations]

    assert operations == PHASE_12E_OPERATIONS
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


def _staff_paths() -> set[str]:
    return {path for _, path in RBAC_C_OPERATIONS}


def test_staff_management_manages_moderators_only_and_never_a_super_admin(
    document: dict[str, Any],
) -> None:
    """Promotion and demotion are CLI-only: no staff path or method can grant, remove or even name
    the Super Admin role, and the only DELETE removes a MODERATOR."""
    operations = {op for op in admin_operations(document) if op in RBAC_C_OPERATIONS}
    paths = [path for _, path in operations]

    assert operations == RBAC_C_OPERATIONS
    assert [path for method, path in operations if method == "DELETE"] == [
        "/admin/staff/moderators/{user_id}"
    ]
    for forbidden in ("super", "promot", "demot", "role", "grant", "revoke", "admin-"):
        assert not any(forbidden in path.removeprefix("/admin") for path in paths), forbidden
    # request bodies cannot name a role either
    for name in ("AppointModeratorRequest", "ReplaceScopesRequest", "ResumeModeratorRequest"):
        properties = set(schemas(document)[name]["properties"])
        assert not {"role", "roles", "superAdmin", "userId", "grantedBy"} & properties, name


def test_the_staff_request_bodies_are_exactly_the_declared_fields(document: dict[str, Any]) -> None:
    appoint = schemas(document)["AppointModeratorRequest"]
    assert set(appoint["properties"]) == set(appoint["required"]) == {"email", "scopes", "revision"}
    for name in ("ReplaceScopesRequest", "ResumeModeratorRequest"):
        body = schemas(document)[name]
        assert set(body["properties"]) == set(body["required"]) == {"scopes", "revision"}
    pause = schemas(document)["PauseModeratorRequest"]
    assert set(pause["properties"]) == set(pause["required"]) == {"revision"}
    # A removal has no body: it states the revision in the query, and must.
    remove = document["paths"][f"{PREFIX}/admin/staff/moderators/{{user_id}}"]["delete"]
    (stated,) = [p for p in remove["parameters"] if p["name"] == "revision"]
    assert stated["in"] == "query" and stated["required"] is True


def test_every_staff_mutation_documents_its_refusals(document: dict[str, Any]) -> None:
    for method, path in RBAC_C_OPERATIONS:
        if method == "GET":
            continue
        codes = set(document["paths"][f"{PREFIX}{path}"][method.lower()]["responses"])
        assert {"401", "403", "422", "429"} <= codes or method == "DELETE", (method, path)
        assert {"401", "403", "429"} <= codes, (method, path)


def test_the_staff_responses_describe_no_secret(document: dict[str, Any]) -> None:
    secret = {
        "password", "passwordHash", "csrfToken", "token", "sessionId", "authMethods", "roles",
        "providerSubject", "searchDocument",
    }  # fmt: skip
    for name in ("StaffMember", "StaffGrantor", "StaffPerson", "StaffAuditEntry"):
        properties = set(schemas(document)[name]["properties"])
        assert not secret & properties, (name, secret & properties)
    assert set(schemas(document)["StaffGrantor"]["properties"]) == {"userId", "displayName"}
    assert "sessionId" not in schemas(document)["StaffAuditEntry"]["properties"]


def test_every_admin_operation_documents_the_auth_failures(document: dict[str, Any]) -> None:
    for path, ops in document["paths"].items():
        if not path.startswith(f"{PREFIX}/admin"):
            continue
        for method, operation in ops.items():
            assert {"401", "403"} <= set(operation["responses"]), (method, path)


def test_the_moderation_request_bodies(document: dict[str, Any]) -> None:
    approve = schemas(document)["ApproveRequest"]
    reject = schemas(document)["RejectRequest"]

    # RBAC-D removed RBAC-B's temporary ``overrideReason``: an approval carries the revision only.
    assert set(approve["properties"]) == {"revision"}
    assert approve["required"] == ["revision"]
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


# -- RBAC-D: staff Provider authoring ---------------------------------------------------------------

PROVIDER_FORBIDDEN_FIELDS = {
    "kind",
    "vertical",
    "ownerId",
    "owner",
    "status",
    "role",
    "roles",
    "scope",
    "scopes",
    "staffScopes",
    "actorUserId",
    "managedBy",
    "createdBy",
    "featured",
    "food",
    "grade",
    "price",
    "propertyType",
    "listingType",
}


def test_the_provider_request_bodies_are_exactly_the_declared_content_fields(
    document: dict[str, Any],
) -> None:
    create = schemas(document)["ProviderCreateRequest"]
    patch = schemas(document)["ProviderPatchRequest"]
    archive = schemas(document)["ProviderArchiveRequest"]

    content = {"name", "category", "area", "description", "tags", "image", "location"}
    assert set(create["properties"]) == content
    assert set(create["required"]) == {"name", "category", "area", "description"}
    assert set(patch["properties"]) == content | {"revision"}
    assert patch["required"] == ["revision"]
    assert set(archive["properties"]) == {"revision"} and archive["required"] == ["revision"]
    for name, schema in (("create", create), ("patch", patch), ("archive", archive)):
        assert not PROVIDER_FORBIDDEN_FIELDS & set(schema["properties"]), name


def test_the_provider_routes_return_the_staff_listing_detail_and_document_every_failure(
    document: dict[str, Any],
) -> None:
    def operation(method: str, path: str) -> dict[str, Any]:
        found: dict[str, Any] = document["paths"][f"{PREFIX}{path}"][method]
        return found

    create = operation("post", "/admin/providers")
    edit = operation("patch", "/admin/providers/{provider_id}")
    archive = operation("post", "/admin/providers/{provider_id}/archive")

    assert {"201", "401", "403", "422", "429"} <= set(create["responses"])
    for existing in (edit, archive):
        assert {"200", "401", "403", "404", "409", "422", "429"} <= set(existing["responses"])
    for op, status in ((create, "201"), (edit, "200"), (archive, "200")):
        reference = op["responses"][status]["content"]["application/json"]["schema"]["$ref"]
        assert reference.endswith("/AdminListingEnvelope")


def test_there_is_no_provider_delete_restore_or_ownership_operation(
    document: dict[str, Any],
) -> None:
    provider_paths = [path for path in document["paths"] if "/admin/providers" in path]

    assert sorted(provider_paths) == [
        f"{PREFIX}/admin/providers",
        f"{PREFIX}/admin/providers/{{provider_id}}",
        f"{PREFIX}/admin/providers/{{provider_id}}/archive",
    ]
    methods = {
        (method, path.removeprefix(PREFIX))
        for path in provider_paths
        for method in document["paths"][path]
    }
    assert methods == {(m.lower(), p) for m, p in RBAC_D_PROVIDER_OPERATIONS}
    for forbidden in ("owner", "assign", "claim", "restore", "transfer", "delete"):
        assert not any(forbidden in path for path in provider_paths), forbidden


def test_the_owner_listing_api_still_documents_the_provider_refusal(
    document: dict[str, Any],
) -> None:
    create = document["paths"][f"{PREFIX}/listings"]["post"]

    assert "provider_admin_only" in create["responses"]["403"]["description"]
    assert "staff" in create["responses"]["403"]["description"]


def test_the_portal_request_routes_document_every_failure_and_carry_no_body_fields(
    document: dict[str, Any],
) -> None:
    def operation(method: str, path: str) -> dict[str, Any]:
        found: dict[str, Any] = document["paths"][f"{PREFIX}{path}"][method]
        return found

    queue = operation("get", "/admin/requests")
    one = operation("get", "/admin/requests/{request_id}")
    actions = [
        operation("post", f"/admin/requests/{{request_id}}/{name}")
        for name in ("accept", "start", "complete", "cancel")
    ]

    assert {"200", "401", "403", "422"} <= set(queue["responses"])
    assert {"200", "401", "403", "404"} <= set(one["responses"])
    for action in actions:
        assert {"200", "401", "403", "404", "409", "422"} <= set(action["responses"])
        reference = action["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        assert reference.endswith("/ServiceRequestEnvelope")
        body = action.get("requestBody", {}).get("content", {}).get("application/json", {})
        assert "ActionRequest" in str(body)  # the empty body of the requester's API: nothing to set
    reference = queue["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert reference.endswith("/LeadsEnvelope")


def test_there_is_no_portal_request_reject_assign_or_delete_operation(
    document: dict[str, Any],
) -> None:
    request_paths = [path for path in document["paths"] if "/admin/requests" in path]

    methods = {
        (method.upper(), path.removeprefix(PREFIX))
        for path in request_paths
        for method in document["paths"][path]
    }
    assert methods == RBAC_D_REQUEST_OPERATIONS
    for forbidden in ("reject", "assign", "claim", "reassign", "transfer", "delete", "owner"):
        assert not any(forbidden in path for path in request_paths), forbidden


def test_the_requesters_api_has_no_provider_recipient_in_its_schemas(
    document: dict[str, Any],
) -> None:
    """The requester's responses and create body never carry a personal provider account: the
    provider side is the portal."""
    for name in (
        "ServiceRequestCreate",
        "ServiceRequestSummary",
        "ServiceRequestDetail",
        "LeadSummary",
    ):
        properties = set(schemas(document)[name]["properties"])
        forbidden = {"providerId", "providerUserId", "providerOwnerId", "ownerId", "recipientId"}
        assert not forbidden & properties, name
