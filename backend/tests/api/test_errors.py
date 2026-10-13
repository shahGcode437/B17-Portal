"""Error-envelope behavior.

The routes below exist only inside these tests (added to a throw-away app instance); nothing here
is, or ever becomes, a production endpoint.
"""

import json

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.errors import (
    AppError,
    ErrorCode,
    ErrorDetail,
    ErrorResponse,
    code_for_status,
    error_response,
)
from app.factory import create_app


class FoodBody(BaseModel):
    categories: list[str] = Field(min_length=1, max_length=3)


class ListingBody(BaseModel):
    name: str = Field(min_length=2)
    food: FoodBody


@pytest.fixture
def probe_app(settings: Settings) -> FastAPI:
    app = create_app(settings)
    router = APIRouter(prefix="/__probe")

    @router.post("/validate")
    def validate(body: ListingBody) -> dict[str, str]:
        return {"ok": body.name}

    @router.get("/query")
    def query(limit: int) -> dict[str, int]:
        return {"limit": limit}

    @router.get("/app-error")
    def app_error() -> None:
        raise AppError(
            ErrorCode.CONFLICT,
            "That slug is already taken.",
            status_code=409,
            details=[ErrorDetail(field="slug", code="duplicate", message="Already in use.")],
        )

    @router.get("/app-error-default")
    def app_error_default() -> None:
        raise AppError(ErrorCode.FORBIDDEN, status_code=403)

    @router.get("/boom")
    def boom() -> None:
        raise RuntimeError("db password is hunter2 at C:\\secret\\path")

    app.include_router(router)
    return app


@pytest.fixture
def probe(probe_app: FastAPI) -> TestClient:
    return TestClient(probe_app, raise_server_exceptions=False)


def assert_error(response, status: int, code: str) -> dict:  # type: ignore[no-untyped-def,type-arg]
    assert response.status_code == status
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert error["code"] == code
    assert isinstance(error["message"], str) and error["message"]
    # every error carries the request ID, and it matches the response header
    assert error["requestId"] == response.headers["x-request-id"]
    return error  # type: ignore[no-any-return]


# --- unknown routes -----------------------------------------------------------------------


def test_unknown_api_route_returns_the_not_found_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")

    error = assert_error(response, 404, "not_found")
    assert error["message"] == "Resource not found."
    assert "details" not in error  # absent, not null


def test_unknown_route_outside_the_api_prefix_uses_the_same_envelope(client: TestClient) -> None:
    assert_error(client.get("/nothing/here"), 404, "not_found")


def test_wrong_method_returns_method_not_allowed_and_keeps_the_allow_header(
    client: TestClient,
) -> None:
    response = client.post("/api/v1/health")

    assert_error(response, 405, "method_not_allowed")
    assert "GET" in response.headers["allow"]


def test_not_found_does_not_echo_the_framework_detail_or_the_path(client: TestClient) -> None:
    response = client.get("/api/v1/secret-admin-thing")

    assert "secret-admin-thing" not in response.text
    assert "Not Found" not in response.text


# --- validation ---------------------------------------------------------------------------


def test_body_validation_errors_are_normalized_with_field_paths(probe: TestClient) -> None:
    response = probe.post("/__probe/validate", json={"name": "x", "food": {"categories": []}})

    error = assert_error(response, 422, "validation_error")
    assert error["message"] == "Some fields are invalid."
    fields = {detail["field"]: detail for detail in error["details"]}
    assert set(fields) == {"name", "food.categories"}
    assert fields["name"]["code"] == "string_too_short"
    assert fields["food.categories"]["code"] == "too_short"
    for detail in error["details"]:
        assert set(detail) == {"field", "code", "message"}


def test_missing_fields_are_reported_by_name(probe: TestClient) -> None:
    error = assert_error(probe.post("/__probe/validate", json={}), 422, "validation_error")

    assert {detail["field"] for detail in error["details"]} == {"name", "food"}
    assert {detail["code"] for detail in error["details"]} == {"missing"}


def test_nested_list_index_is_part_of_the_field_path(probe: TestClient) -> None:
    response = probe.post("/__probe/validate", json={"name": "ok", "food": {"categories": [1]}})

    error = assert_error(response, 422, "validation_error")
    assert error["details"][0]["field"] == "food.categories.0"


def test_query_parameter_errors_name_the_parameter(probe: TestClient) -> None:
    error = assert_error(probe.get("/__probe/query?limit=abc"), 422, "validation_error")

    assert [detail["field"] for detail in error["details"]] == ["limit"]


def test_validation_details_never_echo_input_values_or_internals(probe: TestClient) -> None:
    response = probe.post(
        "/__probe/validate", json={"name": "super-secret-value", "food": {"categories": "nope"}}
    )

    assert response.status_code == 422
    text = response.text
    assert "super-secret-value" not in text and "nope" not in text
    for internal in ("input", "ctx", "url", "pydantic", "loc", "Traceback"):
        assert f'"{internal}"' not in text


def test_malformed_json_is_a_bad_request_not_a_validation_error(probe: TestClient) -> None:
    response = probe.post(
        "/__probe/validate", content=b'{"name": ', headers={"content-type": "application/json"}
    )

    error = assert_error(response, 400, "bad_request")
    assert error["message"] == "The request body is not valid JSON."


# --- application errors -------------------------------------------------------------------


def test_app_error_renders_code_message_status_and_details(probe: TestClient) -> None:
    response = probe.get("/__probe/app-error")

    error = assert_error(response, 409, "conflict")
    assert error["message"] == "That slug is already taken."
    assert error["details"] == [
        {"field": "slug", "code": "duplicate", "message": "Already in use."}
    ]


def test_app_error_falls_back_to_the_default_message_for_its_code(probe: TestClient) -> None:
    error = assert_error(probe.get("/__probe/app-error-default"), 403, "forbidden")

    assert error["message"] == "You do not have permission to do this."


# --- unexpected errors --------------------------------------------------------------------


def test_unhandled_exception_returns_the_generic_envelope_without_internals(
    probe: TestClient,
) -> None:
    response = probe.get("/__probe/boom")

    error = assert_error(response, 500, "internal_error")
    assert error["message"] == "An unexpected error occurred."
    for leaked in ("hunter2", "secret", "Traceback", "RuntimeError", ".py", "boom"):
        assert leaked not in response.text


def test_unhandled_exception_is_logged_server_side_with_the_request_id(
    probe: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    response = probe.get("/__probe/boom")
    request_id = response.headers["x-request-id"]

    records = [
        json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")
    ]
    failure = next(
        r for r in records if r["message"] == "Unhandled exception while handling request"
    )
    assert failure["level"] == "ERROR"
    assert failure["requestId"] == request_id
    assert "RuntimeError" in failure["exception"] and "hunter2" in failure["exception"]
    access = next(r for r in records if r["message"] == "request" and r["path"] == "/__probe/boom")
    assert access["status"] == 500 and access["level"] == "ERROR"


def test_the_server_keeps_working_after_an_unhandled_exception(probe: TestClient) -> None:
    assert probe.get("/__probe/boom").status_code == 500
    assert probe.get("/api/v1/health").status_code == 200


# --- the envelope builder itself ----------------------------------------------------------


def test_error_response_matches_the_documented_error_model() -> None:
    response = error_response(
        422,
        ErrorCode.VALIDATION_ERROR,
        "Some fields are invalid.",
        details=[ErrorDetail(field="name", code="missing", message="Field required")],
        request_id="req-12345678",
    )

    body = json.loads(bytes(response.body))
    ErrorResponse.model_validate(body)  # the wire shape is the documented model
    assert body == {
        "error": {
            "code": "validation_error",
            "message": "Some fields are invalid.",
            "details": [{"field": "name", "code": "missing", "message": "Field required"}],
            "requestId": "req-12345678",
        }
    }
    assert response.headers["x-request-id"] == "req-12345678"


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (400, "bad_request"),
        (401, "unauthenticated"),
        (403, "forbidden"),
        (404, "not_found"),
        (405, "method_not_allowed"),
        (409, "conflict"),
        (422, "validation_error"),
        (429, "rate_limited"),
        (418, "bad_request"),  # unknown 4xx
        (500, "internal_error"),
        (502, "internal_error"),  # unknown 5xx
        (503, "service_unavailable"),
    ],
)
def test_status_to_error_code_mapping(status: int, code: str) -> None:
    assert code_for_status(status) == code
