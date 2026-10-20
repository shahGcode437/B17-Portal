import re
import uuid
from collections.abc import Callable

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app
from tests.conftest import ALLOWED_ORIGIN

UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def test_health_returns_200_with_the_success_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    # Exactly the agreed shape: `data` only — `meta` is omitted when there is nothing to report.
    assert response.json() == {
        "data": {"status": "ok", "service": "b17-portal-api", "version": "0.0.0-test"}
    }


def test_health_exposes_nothing_about_the_host_or_configuration(client: TestClient) -> None:
    data = client.get("/api/v1/health").json()["data"]

    # An allow-list, not a deny-list: only these three fields exist.
    assert set(data) == {"status", "service", "version"}


def test_health_is_mounted_only_under_the_versioned_prefix(client: TestClient) -> None:
    assert client.get("/health").status_code == 404
    assert client.get("/api/health").status_code == 404


def test_health_honours_a_custom_api_prefix(make_settings: Callable[..., Settings]) -> None:
    app = create_app(make_settings(api_v1_prefix="/api/v2"))
    with TestClient(app) as client:
        assert client.get("/api/v2/health").status_code == 200
        assert client.get("/api/v1/health").status_code == 404


def test_response_carries_a_generated_request_id(client: TestClient) -> None:
    first = client.get("/api/v1/health").headers["x-request-id"]
    second = client.get("/api/v1/health").headers["x-request-id"]

    assert UUID_PATTERN.match(first)
    assert uuid.UUID(first).version == 4
    assert first != second


def test_a_valid_incoming_request_id_is_kept(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"X-Request-ID": "frontend-trace-12345"})

    assert response.headers["x-request-id"] == "frontend-trace-12345"


def test_an_unsafe_or_malformed_incoming_request_id_is_replaced(client: TestClient) -> None:
    for bad in ("short", "has spaces in it!", "x" * 129, "semi;colon;injection"):
        response = client.get("/api/v1/health", headers={"X-Request-ID": bad})
        assert response.headers["x-request-id"] != bad
        assert UUID_PATTERN.match(response.headers["x-request-id"])


def test_openapi_document_loads_and_describes_the_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    document = response.json()
    assert document["openapi"].startswith("3.")
    assert document["info"]["title"] == "B-17 Portal API"
    assert document["info"]["version"] == "0.0.0-test"
    assert list(document["paths"]) == [
        "/api/v1/health",
        "/api/v1/health/ready",
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/auth/logout",
        "/api/v1/auth/logout-all",
        "/api/v1/auth/verify-email",
        "/api/v1/auth/resend-verification",
        "/api/v1/auth/forgot-password",
        "/api/v1/auth/reset-password",
        "/api/v1/auth/change-password",
        "/api/v1/auth/oauth/google/start",
        "/api/v1/auth/oauth/google/callback",
        "/api/v1/auth/oauth/google",
        "/api/v1/categories",
        "/api/v1/search",
        "/api/v1/search/suggestions",
        "/api/v1/listings/{listing_id}",
        "/api/v1/listings",
        "/api/v1/listings/{listing_id}/archive",
        "/api/v1/users/me/professional-profile",
        "/api/v1/users/me/listings",
        "/api/v1/users/me/listings/{listing_id}",
        "/api/v1/saved",
        "/api/v1/saved/{listing_id}",
        "/api/v1/requests",
        "/api/v1/users/me/leads",
        "/api/v1/requests/{request_id}",
        "/api/v1/requests/{request_id}/accept",
        "/api/v1/requests/{request_id}/start",
        "/api/v1/requests/{request_id}/complete",
        "/api/v1/requests/{request_id}/cancel",
        "/api/v1/admin/listings",
        "/api/v1/admin/listings/{listing_id}",
        "/api/v1/admin/listings/{listing_id}/approve",
        "/api/v1/admin/listings/{listing_id}/reject",
        "/api/v1/admin/categories",
        "/api/v1/admin/categories/reorder",
        "/api/v1/admin/categories/{category_id}",
        "/api/v1/news",
        "/api/v1/news/{article_id}",
    ]
    operation = document["paths"]["/api/v1/health"]["get"]
    assert operation["summary"] == "Application health check"
    ok = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert ok["$ref"].endswith("Envelope_HealthStatus_")
    error = operation["responses"]["500"]["content"]["application/json"]["schema"]
    assert error["$ref"].endswith("ErrorResponse")


def test_interactive_docs_are_served_outside_production(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200


def test_docs_and_openapi_are_not_published_in_production(
    make_settings: Callable[..., Settings],
) -> None:
    app = create_app(make_settings(environment="production", frontend_base_url=ALLOWED_ORIGIN))
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404
        assert client.get("/api/v1/openapi.json").status_code == 404
        # the API itself is unaffected
        assert client.get("/api/v1/health").status_code == 200
