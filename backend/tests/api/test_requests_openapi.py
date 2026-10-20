"""The OpenAPI surface of Phase 12F (database-free): exactly the frozen Saved and service-request
operations exist; nothing about payments, chat, notifications or media; request bodies cannot
describe a server-owned field; responses cannot describe a secret."""

from typing import Any

import pytest

from app.core.config import Settings
from app.factory import create_app

PREFIX = "/api/v1"


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
        if path.removeprefix(PREFIX).startswith(("/saved", "/requests", "/users/me/leads"))
    }


def test_exactly_the_frozen_operations_exist(document: dict[str, Any]) -> None:
    assert operations(document) == {
        ("GET", "/saved"),
        ("PUT", "/saved/{listing_id}"),
        ("DELETE", "/saved/{listing_id}"),
        ("POST", "/requests"),
        ("GET", "/requests"),
        ("GET", "/requests/{request_id}"),
        ("GET", "/users/me/leads"),
        ("POST", "/requests/{request_id}/accept"),
        ("POST", "/requests/{request_id}/start"),
        ("POST", "/requests/{request_id}/complete"),
        ("POST", "/requests/{request_id}/cancel"),
    }


def test_nothing_the_phase_excludes_exists(document: dict[str, Any]) -> None:
    forbidden = {
        "payment", "payments", "wallet", "vault", "chat", "message", "messages", "whatsapp", "sms",
        "call", "calls", "notification", "notifications", "webhook", "webhooks", "media", "upload",
        "uploads", "map", "maps", "geocode",
    }  # fmt: skip
    for path in document["paths"]:
        segments = {segment.lower() for segment in path.split("/")}
        assert not forbidden & segments, (forbidden & segments, path)
    # no way to edit, delete, reopen or admin-manage a request
    methods = {method for method, path in operations(document) if path.startswith("/requests")}
    assert methods == {"GET", "POST"}
    assert not any(
        path.endswith(("/reopen", "/reject", "/decline", "/assign", "/status"))
        for _, path in operations(document)
    )


def test_every_operation_documents_the_auth_failures(document: dict[str, Any]) -> None:
    for path, ops in document["paths"].items():
        if not path.removeprefix(PREFIX).startswith(("/saved", "/requests", "/users/me/leads")):
            continue
        for method, operation in ops.items():
            assert {"401", "403"} <= set(operation["responses"]), (method, path)


def test_the_documented_status_codes(document: dict[str, Any]) -> None:
    def codes(method: str, path: str) -> set[str]:
        return set(document["paths"][f"{PREFIX}{path}"][method]["responses"])

    assert {"201", "404", "422", "429"} <= codes("post", "/requests")
    assert {"200", "422"} <= codes("get", "/requests")
    assert {"200", "404"} <= codes("get", "/requests/{request_id}")
    assert {"200"} <= codes("get", "/users/me/leads")
    assert {"204", "404"} <= codes("put", "/saved/{listing_id}")
    assert {"204"} <= codes("delete", "/saved/{listing_id}")
    for action in ("accept", "start", "complete", "cancel"):
        assert {"200", "404", "409", "422"} <= codes("post", f"/requests/{{request_id}}/{action}")


def test_the_create_body_cannot_describe_a_server_owned_field(document: dict[str, Any]) -> None:
    create = schemas(document)["ServiceRequestCreate"]

    assert set(create["properties"]) == {
        "providerListingId", "service", "details", "area", "preferredDate", "preferredTime",
        "notes", "preferredContactChannel",
    }  # fmt: skip
    assert set(create["required"]) == {
        "providerListingId", "service", "details", "area", "preferredDate",
    }  # fmt: skip
    forbidden = {
        "id", "requesterId", "providerId", "ownerId", "userId", "status", "createdAt", "updatedAt",
        "requestedBy", "providerName", "history", "phone", "whatsappNumber", "email",
    }  # fmt: skip
    assert not forbidden & set(create["properties"])
    assert create["properties"]["preferredContactChannel"]["$ref"].endswith("ContactChannel")


def test_the_contact_channel_is_a_closed_set(document: dict[str, Any]) -> None:
    assert schemas(document)["ContactChannel"]["enum"] == ["in_app", "whatsapp", "phone"]


def test_the_status_vocabulary_is_the_frozen_one(document: dict[str, Any]) -> None:
    assert schemas(document)["RequestStatus"]["enum"] == [
        "submitted", "accepted", "in-progress", "completed", "cancelled",
    ]  # fmt: skip


def test_action_bodies_describe_nothing(document: dict[str, Any]) -> None:
    action = schemas(document)["ActionRequest"]

    assert not action.get("properties")
    for name in ("accept", "start", "complete", "cancel"):
        operation = document["paths"][f"{PREFIX}/requests/{{request_id}}/{name}"]["post"]
        body = operation["requestBody"]
        assert body.get("required") is not True  # the body may be omitted entirely


def test_responses_describe_no_secret(document: dict[str, Any]) -> None:
    secret = {
        "email", "password", "passwordHash", "csrfToken", "token", "sessionId", "roles",
        "ownerId", "requesterId", "providerId", "userId", "phone", "whatsapp", "address",
        "latitude", "longitude", "landmark", "searchDocument",
    }  # fmt: skip
    for name in (
        "ServiceRequestSummary",
        "LeadSummary",
        "ServiceRequestDetail",
        "RequestHistoryEntry",
    ):
        assert not secret & set(schemas(document)[name]["properties"]), name
    for name in ("SavedProvider", "SavedBusiness", "SavedTutor", "SavedProperty"):
        assert set(schemas(document)[name]["properties"]) == {"kind", "item", "savedAt"}


def test_saved_covers_every_listing_kind_and_never_news(document: dict[str, Any]) -> None:
    saved = schemas(document)["SavedEnvelope"]["properties"]["data"]["items"]

    assert set(saved["discriminator"]["mapping"]) == {"provider", "business", "tutor", "property"}


def test_the_saved_item_is_the_public_card_not_an_owner_or_admin_shape(
    document: dict[str, Any],
) -> None:
    for name, ref in (
        ("SavedProvider", "ProviderRead"),
        ("SavedBusiness", "BusinessRead"),
        ("SavedTutor", "TutorRead"),
        ("SavedProperty", "PropertyRead"),
    ):
        assert schemas(document)[name]["properties"]["item"]["$ref"].endswith(ref)


def test_the_lists_are_paginated(document: dict[str, Any]) -> None:
    for name in ("ServiceRequestsEnvelope", "LeadsEnvelope", "SavedEnvelope"):
        assert set(schemas(document)[name]["properties"]) == {"data", "meta"}
