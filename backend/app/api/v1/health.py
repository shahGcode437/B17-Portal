"""Application health check."""

from typing import Literal

from fastapi import APIRouter

from app.api.routing import ContractRoute
from app.core.config import SERVICE_NAME
from app.dependencies.settings import SettingsDep
from app.schemas.envelope import ApiModel, Envelope

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

    It deliberately checks no dependencies: there is no database yet, and this endpoint must not
    pretend otherwise. A readiness check (``/health/ready``) arrives with the data layer.
    """
    return Envelope(
        data=HealthStatus(status="ok", service=SERVICE_NAME, version=settings.app_version)
    )
