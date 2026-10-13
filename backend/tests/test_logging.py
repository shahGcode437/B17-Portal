import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.logging import JsonFormatter, RequestIdFilter, configure_logging, request_id_var
from tests.conftest import SETTINGS_ENV_VARS

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def lines(capsys: pytest.CaptureFixture[str]) -> list[dict[str, object]]:
    """Structured log lines written by the application (not the test client's own logger)."""
    out = capsys.readouterr().out
    records = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    return [r for r in records if str(r["logger"]).startswith("app")]


def test_each_request_writes_one_structured_line(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    response = client.get("/api/v1/health")

    record = next(r for r in lines(capsys) if r["logger"] == "app.request")
    assert record["level"] == "INFO"
    assert record["message"] == "request"
    assert record["method"] == "GET"
    assert record["path"] == "/api/v1/health"
    assert record["route"] == "/health"
    assert record["status"] == 200
    assert isinstance(record["durationMs"], float)
    assert record["requestId"] == response.headers["x-request-id"]
    assert str(record["timestamp"]).endswith("+00:00")


def test_the_query_string_is_never_logged(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    client.get("/api/v1/health?token=super-secret&email=a@b.co")

    records = lines(capsys)
    assert records  # the request was logged...
    output = json.dumps(records)
    assert "super-secret" not in output and "a@b.co" not in output  # ...without its query string


def test_authorization_headers_and_bodies_are_never_logged(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    client.post(
        "/api/v1/health",
        headers={"Authorization": "Bearer top-secret-token"},
        json={"password": "hunter2"},
    )

    output = json.dumps(lines(capsys))
    assert "top-secret-token" not in output and "hunter2" not in output


def test_client_errors_log_at_info_and_include_the_status(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    client.get("/api/v1/nope")

    record = next(r for r in lines(capsys) if r["logger"] == "app.request")
    assert (record["status"], record["level"]) == (404, "INFO")
    assert "route" not in record  # no route matched: absent, not null


def test_formatter_emits_json_with_request_id_and_extras() -> None:
    token = request_id_var.set("req-abcdef12")
    try:
        record = logging.LogRecord(
            "app.x", logging.WARNING, __file__, 1, "hello %s", ("you",), None
        )
        record.custom = "value"
        RequestIdFilter().filter(record)
        payload = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)

    assert payload["message"] == "hello you"
    assert payload["level"] == "WARNING"
    assert payload["requestId"] == "req-abcdef12"
    assert payload["custom"] == "value"
    assert "exception" not in payload


def test_formatter_includes_exception_traces_for_server_side_logs() -> None:
    try:
        raise ValueError("kaboom")
    except ValueError:
        record = logging.LogRecord(
            "app.x", logging.ERROR, __file__, 1, "failed", (), sys.exc_info()
        )

    assert "ValueError: kaboom" in json.loads(JsonFormatter().format(record))["exception"]


def test_configure_logging_is_idempotent_and_sets_the_level() -> None:
    root = logging.getLogger()
    configure_logging("INFO")
    configure_logging("WARNING")

    ours = [h for h in root.handlers if getattr(h, "_b17_json_handler", False)]
    assert len(ours) == 1
    assert root.level == logging.WARNING
    configure_logging("INFO")


def test_importing_app_main_builds_a_working_app_from_a_controlled_environment() -> None:
    """Smoke test of the real entry point (``uvicorn app.main:app``) in a clean subprocess."""
    code = "\n".join(
        [
            "from fastapi.testclient import TestClient",
            "from app.main import app",
            "print(TestClient(app).get('/api/v1/health').status_code)",
        ]
    )
    env = {k: v for k, v in os.environ.items() if k not in SETTINGS_ENV_VARS}
    env["ENVIRONMENT"] = "test"
    result = subprocess.run(
        [sys.executable, "-W", "ignore", "-c", code],
        cwd=BACKEND_ROOT / "tests",  # not the backend root, so no developer `.env` is picked up
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "200"
