"""The v1 API router. Mounted by the app factory under the configured ``/api/v1`` prefix."""

from fastapi import APIRouter

from app.api.routing import ContractRoute
from app.api.v1 import (
    admin,
    admin_grocery,
    admin_grocery_orders,
    admin_providers,
    admin_requests,
    admin_staff,
    auth,
    categories,
    grocery,
    health,
    listings,
    news,
    owner_listings,
    requests,
    saved,
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
api_router.include_router(saved.router)
api_router.include_router(requests.router)
api_router.include_router(grocery.router)
# Moderation first, taxonomy second: the order the published OpenAPI document has always listed.
api_router.include_router(admin.staff_router)
api_router.include_router(admin.router)
api_router.include_router(admin_staff.router)
api_router.include_router(admin_staff.sensitive_router)
api_router.include_router(admin_providers.router)
api_router.include_router(admin_requests.router)
api_router.include_router(admin_grocery.router)
api_router.include_router(admin_grocery_orders.router)
api_router.include_router(news.router)
