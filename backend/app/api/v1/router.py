"""The v1 API router. Mounted by the app factory under the configured ``/api/v1`` prefix."""

from fastapi import APIRouter

from app.api.routing import ContractRoute
from app.api.v1 import health
from app.core.errors import ErrorResponse

api_router = APIRouter(
    route_class=ContractRoute,
    responses={500: {"model": ErrorResponse, "description": "Unexpected server error"}},
)
api_router.include_router(health.router)
