from collections.abc import Callable

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app
from tests.conftest import ALLOWED_ORIGIN

PREFLIGHT = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type,authorization",
}


def test_preflight_from_a_configured_origin_is_allowed(client: TestClient) -> None:
    response = client.options("/api/v1/health", headers={"Origin": ALLOWED_ORIGIN, **PREFLIGHT})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN  # echoed, never "*"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
    # Phase 11B: cookie sessions need credentialed CORS — only ever with an exact echoed origin.
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "x-request-id" in response.headers  # request ID wraps CORS responses too


def test_preflight_from_an_unlisted_origin_is_refused(client: TestClient) -> None:
    response = client.options(
        "/api/v1/health", headers={"Origin": "https://evil.example", **PREFLIGHT}
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_preflight_with_an_unlisted_header_is_refused(client: TestClient) -> None:
    response = client.options(
        "/api/v1/health",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-unlisted-header",
        },
    )

    assert response.status_code == 400


def test_actual_request_from_a_configured_origin_gets_cors_headers(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": ALLOWED_ORIGIN})

    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    # the frontend must be able to read the request ID to quote it in a bug report
    assert "x-request-id" in response.headers["access-control-expose-headers"].lower()


def test_actual_request_from_an_unlisted_origin_gets_no_cors_headers(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_error_responses_also_carry_cors_headers(client: TestClient) -> None:
    response = client.get("/api/v1/nope", headers={"Origin": ALLOWED_ORIGIN})

    assert response.status_code == 404
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN


def test_no_origin_is_allowed_when_none_are_configured(
    make_settings: Callable[..., Settings],
) -> None:
    app = create_app(make_settings(frontend_origins=[]))
    with TestClient(app) as client:
        response = client.get("/api/v1/health", headers={"Origin": ALLOWED_ORIGIN})

        assert response.status_code == 200
        assert "access-control-allow-origin" not in response.headers


def test_a_wildcard_is_never_sent_even_with_several_origins(
    make_settings: Callable[..., Settings],
) -> None:
    app = create_app(
        make_settings(frontend_origins=["http://localhost:5173", "http://127.0.0.1:4173"])
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/health", headers={"Origin": "http://127.0.0.1:4173"})

        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:4173"
