"""/health (liveness) vs /health/ready (database) — without needing a database.

The "database is down" cases use a closed local port and a 1-second connect timeout, so they fail
fast and deterministically instead of waiting on a network timeout.
"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app

UNREACHABLE = "postgresql+psycopg://b17_user:hunter2-secret@127.0.0.1:1/b17_secret_db"


@pytest.fixture
def no_database(make_settings: Callable[..., Settings]) -> TestClient:
    return TestClient(create_app(make_settings()), raise_server_exceptions=False)


@pytest.fixture
def unreachable_database(make_settings: Callable[..., Settings]) -> TestClient:
    settings = make_settings(database_url=UNREACHABLE, db_connect_timeout_seconds=1)
    return TestClient(create_app(settings), raise_server_exceptions=False)


def assert_unavailable(response) -> None:  # type: ignore[no-untyped-def]
    assert response.status_code == 503
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "service_unavailable"
    assert body["error"]["message"] == "The service is temporarily unavailable."
    assert body["error"]["requestId"] == response.headers["x-request-id"]


def test_readiness_is_503_when_no_database_is_configured(no_database: TestClient) -> None:
    assert_unavailable(no_database.get("/api/v1/health/ready"))


def test_readiness_is_503_when_the_database_is_unreachable(
    unreachable_database: TestClient,
) -> None:
    assert_unavailable(unreachable_database.get("/api/v1/health/ready"))


def test_readiness_never_reveals_connection_details(unreachable_database: TestClient) -> None:
    response = unreachable_database.get("/api/v1/health/ready")

    for secret in ("hunter2-secret", "b17_user", "b17_secret_db", "127.0.0.1", "postgresql"):
        assert secret not in response.text, f"response leaked {secret!r}"


def test_the_database_url_is_never_logged_by_the_application(
    unreachable_database: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    unreachable_database.get("/api/v1/health/ready")

    app_lines = [
        line
        for line in capsys.readouterr().out.splitlines()
        if line.startswith("{") and '"logger": "app' in line
    ]
    assert app_lines, "the failed readiness check should be logged server-side"
    joined = "\n".join(app_lines)
    assert "hunter2-secret" not in joined and "b17_secret_db" not in joined
    assert "Readiness check failed" in joined


def test_liveness_stays_200_while_the_database_is_down(
    unreachable_database: TestClient, no_database: TestClient
) -> None:
    for client in (unreachable_database, no_database):
        response = client.get("/api/v1/health")

        assert response.status_code == 200
        assert response.json()["data"]["status"] == "ok"


def test_the_readiness_endpoint_is_documented_with_its_503(client: TestClient) -> None:
    document = client.get("/api/v1/openapi.json").json()

    operation = document["paths"]["/api/v1/health/ready"]["get"]
    assert operation["responses"]["503"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "ErrorResponse"
    )
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "Envelope_ReadinessStatus_"
    )


def test_the_database_dependency_reports_unavailable_without_a_configured_database(
    make_settings: Callable[..., Settings],
) -> None:
    from fastapi import APIRouter

    from app.dependencies.db import DbSession

    app = create_app(make_settings())
    router = APIRouter()

    @router.get("/__probe/db")
    def probe(session: DbSession) -> dict[str, bool]:  # test-only route on a throw-away app
        return {"ok": session is not None}

    app.include_router(router)

    response = TestClient(app, raise_server_exceptions=False).get("/__probe/db")

    assert_unavailable(response)
