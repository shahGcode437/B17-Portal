"""The v1 API router. Mounted by the app factory under the configured ``/api/v1`` prefix."""

from fastapi import APIRouter

from app.api.routing import ContractRoute
from app.api.v1 import (
    admin,
    auth,
    categories,
    health,
    listings,
    news,
    owner_listings,
    search,
    users,
)
from app.core.errors import ErrorResponse

api_router = APIRouter(
    route_class=ContractRoute,
    responses={500: {"model": ErrorResponse, "description": "Unexpected server error"}},
)
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(categories.router)
api_router.include_router(search.router)
api_router.include_router(listings.router)
api_router.include_router(owner_listings.router)
api_router.include_router(users.router)
api_router.include_router(admin.router)
api_router.include_router(news.router)
