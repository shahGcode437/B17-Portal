"""Application health check."""

import logging
from typing import Literal

from fastapi import APIRouter, Request
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.routing import ContractRoute
from app.core.config import SERVICE_NAME
from app.core.errors import AppError, ErrorCode, ErrorResponse
from app.dependencies.settings import SettingsDep
from app.schemas.envelope import ApiModel, Envelope

logger = logging.getLogger(__name__)

router = APIRouter(route_class=ContractRoute, tags=["health"])


class HealthStatus(ApiModel):
    status: Literal["ok"]
    service: str
    version: str


@router.get(
    "/health",
    response_model=Envelope[HealthStatus],
    summary="Application health check",
)
async def get_health(settings: SettingsDep) -> Envelope[HealthStatus]:
    """Liveness of the API process only.

    It deliberately checks no dependencies, so it stays 200 while the database is down — an
    orchestrator uses it to decide whether to *restart* the process. ``/health/ready`` reports on
    the database and decides whether to *send traffic*.
    """
    return Envelope(
        data=HealthStatus(status="ok", service=SERVICE_NAME, version=settings.app_version)
    )


class ReadinessStatus(ApiModel):
    status: Literal["ready"]
    checks: dict[str, str]


@router.get(
    "/health/ready",
    response_model=Envelope[ReadinessStatus],
    summary="Readiness check (database reachable)",
    responses={503: {"model": ErrorResponse, "description": "A dependency is not available"}},
)
def get_readiness(request: Request) -> Envelope[ReadinessStatus]:
    """200 when PostgreSQL answers ``SELECT 1``; otherwise a normalized 503.

    The response and the log line never contain the connection URL, host or credentials.
    """
    engine: Engine | None = request.app.state.db_engine
    if engine is None:
        logger.warning("Readiness check failed: DATABASE_URL is not configured")
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, status_code=503)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        # Class name only: driver messages can include the host and port of the database.
        logger.warning("Readiness check failed: %s", type(error).__name__)
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, status_code=503) from error
    return Envelope(data=ReadinessStatus(status="ready", checks={"database": "ok"}))
