"""Dependencies shared by the owner / write endpoints (Phase 12D)."""

from typing import Annotated

from fastapi import Depends, Response

from app.dependencies.auth import ClockDep
from app.dependencies.db import DbSession
from app.dependencies.settings import SettingsDep
from app.services.listing_writes import ListingWriteService
from app.services.rate_limit import PostgresRateLimiter


def no_store(response: Response) -> None:
    """Owner and admin responses are private: never cached by a browser or an intermediary
    (API_CONTRACT.md §10.1)."""
    response.headers["Cache-Control"] = "no-store"


def get_listing_write_service(
    db: DbSession, settings: SettingsDep, clock: ClockDep
) -> ListingWriteService:
    return ListingWriteService(
        db,
        localities=settings.localities,
        clock=clock,
        limiter=PostgresRateLimiter(db, clock),
    )


ListingWriteServiceDep = Annotated[ListingWriteService, Depends(get_listing_write_service)]
NoStore = Depends(no_store)
