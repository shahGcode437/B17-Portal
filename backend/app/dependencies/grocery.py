"""Dependencies of the Grocery routes (GROCERY-1b)."""

from typing import Annotated

from fastapi import Depends

from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import GROCERY_SETTINGS_WRITE
from app.dependencies.auth import ClockDep, SuperAdminUser
from app.dependencies.db import DbSession
from app.services.auth_sessions import Principal
from app.services.grocery_orders import GroceryOrderService
from app.services.grocery_settings import GrocerySettingsService
from app.services.rate_limit import PostgresRateLimiter


def get_grocery_order_service(db: DbSession, clock: ClockDep) -> GroceryOrderService:
    return GroceryOrderService(db, clock=clock, limiter=PostgresRateLimiter(db, clock))


def get_grocery_settings_service(db: DbSession, clock: ClockDep) -> GrocerySettingsService:
    return GrocerySettingsService(db, clock=clock)


def require_grocery_settings_write(
    principal: SuperAdminUser, db: DbSession, clock: ClockDep
) -> Principal:
    """The gate of the settings change: a verified Super Admin with a fresh session, then a
    per-actor rate limit (last, so only an authorised Super Admin can consume it)."""
    decision = PostgresRateLimiter(db, clock).hit(
        f"grocery-settings:{principal.user_id}", GROCERY_SETTINGS_WRITE
    )
    if not decision.allowed:
        raise AppError(
            ErrorCode.RATE_LIMITED,
            status_code=429,
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )
    return principal


GroceryOrderServiceDep = Annotated[GroceryOrderService, Depends(get_grocery_order_service)]
GrocerySettingsServiceDep = Annotated[GrocerySettingsService, Depends(get_grocery_settings_service)]
GrocerySettingsWriter = Annotated[Principal, Depends(require_grocery_settings_write)]
