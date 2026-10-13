"""Readiness against a real database, and the per-request session lifecycle."""

from collections.abc import Callable, Iterator

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.dependencies.db import DbSession, get_db_session
from app.factory import create_app
from app.models import Category
from app.models.enums import CategoryModule


@pytest.fixture
def db_app(make_settings: Callable[..., Settings], test_database_url: URL) -> Iterator[FastAPI]:
    url = test_database_url.render_as_string(hide_password=False)
    app = create_app(make_settings(database_url=url))
    yield app
    app.state.db_engine.dispose()


@pytest.fixture
def db_client(db_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(db_app, raise_server_exceptions=False) as client:
        yield client


def test_readiness_is_200_when_postgresql_answers(db_client: TestClient) -> None:
    response = db_client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ready", "checks": {"database": "ok"}}}
    assert "x-request-id" in response.headers


def test_readiness_does_not_expose_the_connection_url_even_on_success(
    db_client: TestClient, test_database_url: URL
) -> None:
    text = db_client.get("/api/v1/health/ready").text

    assert (test_database_url.password or "") not in text
    assert (test_database_url.database or "") not in text


def test_liveness_and_readiness_are_independent_endpoints(db_client: TestClient) -> None:
    assert db_client.get("/api/v1/health").json()["data"]["status"] == "ok"
    assert db_client.get("/api/v1/health/ready").json()["data"]["status"] == "ready"


# -- session lifecycle ---------------------------------------------------------------------------


def _probe_router() -> APIRouter:
    router = APIRouter(prefix="/__probe")

    @router.get("/uncommitted-write")
    def uncommitted_write(session: DbSession) -> dict[str, int]:
        # A "forgotten commit": the write is flushed but never committed by a service.
        session.add(Category(module=CategoryModule.NEWS, slug="never-committed", name="Ghost"))
        session.flush()
        return {"visible_inside": session.scalar(select(func.count()).select_from(Category)) or 0}

    @router.get("/boom")
    def boom(session: DbSession) -> None:
        session.execute(select(1))
        raise RuntimeError("handler failed")

    return router


def test_a_session_is_created_per_request_and_closed_afterwards(db_app: FastAPI) -> None:
    created: list[Session] = []
    real_factory = db_app.state.db_session_factory

    def spy() -> Session:
        session: Session = real_factory()
        created.append(session)
        return session

    db_app.state.db_session_factory = spy
    db_app.include_router(_probe_router())

    with TestClient(db_app, raise_server_exceptions=False) as client:
        client.get("/__probe/uncommitted-write")
        client.get("/__probe/uncommitted-write")

    assert len(created) == 2 and created[0] is not created[1]  # never shared between requests
    assert all(not session.in_transaction() for session in created)  # closed: nothing left open


def test_work_that_was_never_committed_is_rolled_back_when_the_request_ends(
    db_app: FastAPI, db_engine: Engine
) -> None:
    db_app.include_router(_probe_router())

    with TestClient(db_app, raise_server_exceptions=False) as client:
        response = client.get("/__probe/uncommitted-write")
    assert response.status_code == 200 and response.json()["visible_inside"] >= 1

    with Session(db_engine) as other:  # a different connection: only committed data is visible
        ghost = other.scalar(
            select(func.count()).select_from(Category).where(Category.slug == "never-committed")
        )
    assert ghost == 0


def test_a_failing_handler_still_closes_the_session_and_returns_the_error_envelope(
    db_app: FastAPI,
) -> None:
    created: list[Session] = []
    real_factory = db_app.state.db_session_factory

    def spy() -> Session:
        session: Session = real_factory()
        created.append(session)
        return session

    db_app.state.db_session_factory = spy
    db_app.include_router(_probe_router())

    with TestClient(db_app, raise_server_exceptions=False) as client:
        response = client.get("/__probe/boom")

    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
    assert created and not created[0].in_transaction()


def test_tests_can_override_the_session_dependency_cleanly(
    db_app: FastAPI, db_session: Session
) -> None:
    """The documented seam: route work lands in the test's own rolled-back transaction."""

    def override() -> Iterator[Session]:
        yield db_session

    db_app.dependency_overrides[get_db_session] = override
    db_app.include_router(_probe_router())

    with TestClient(db_app, raise_server_exceptions=False) as client:
        client.get("/__probe/uncommitted-write")

    assert (
        db_session.scalar(
            select(func.count()).select_from(Category).where(Category.slug == "never-committed")
        )
        == 1
    )
