"""Dependencies of the staff SERVICES surface: Provider authoring and portal Service request
handling (RBAC-D; docs/backend/AUTH_RBAC.md §31)."""

from typing import Annotated

from fastapi import Depends

from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import PROVIDER_WRITE
from app.dependencies.auth import ClockDep, StaffUser
from app.dependencies.db import DbSession
from app.dependencies.settings import SettingsDep
from app.services.auth_sessions import Principal
from app.services.portal_requests import PortalRequestService
from app.services.provider_authoring import ProviderAuthoringService
from app.services.rate_limit import PostgresRateLimiter


def require_services_staff(principal: StaffUser) -> Principal:
    """The front door of the whole Services staff surface (``services_staff`` in
    ``ADMIN_AUTHORITY``): a verified, fresh-session staff member (``require_staff`` — a Moderator
    with no effective scope at all is refused here). It is a FRONT DOOR, not the authority and not
    a scope check: whether this actor may act on Services right now is decided — and, for a write,
    locked — by the service inside its transaction (``ProviderAuthoringService``,
    ``PortalRequestService``), and the route class exists so that the inventory test can prove no
    Services route is reachable without it."""
    return principal


ServicesStaff = Annotated[Principal, Depends(require_services_staff)]


def require_provider_authoring(
    principal: ServicesStaff, db: DbSession, clock: ClockDep
) -> Principal:
    """The front door of every Provider authoring route, in this order: a verified, fresh-session
    staff member (``require_staff`` — a Moderator with no scope at all is refused here), then the
    operational provider-write rate limit.

    It is a FRONT DOOR, not the authority: it does not look at the ``services`` scope. Whether this
    actor may author Providers right now is decided — and locked — by ``ProviderAuthoringService``
    inside its transaction (a Moderator without ``services`` is ``403`` on create and ``404`` for an
    existing id, so an out-of-scope id is never confirmed). The limiter runs last, so only an
    already-authenticated staff member can consume it and a ``429`` performs no write. It is keyed
    per actor and is NOT the staff-management bucket (``STAFF_MUTATION``)."""
    decision = PostgresRateLimiter(db, clock).hit(
        f"provider-write:{principal.user_id}", PROVIDER_WRITE
    )
    if not decision.allowed:
        raise AppError(
            ErrorCode.RATE_LIMITED,
            status_code=429,
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )
    return principal


def get_provider_authoring_service(
    db: DbSession, settings: SettingsDep, clock: ClockDep
) -> ProviderAuthoringService:
    return ProviderAuthoringService(db, localities=settings.localities, clock=clock)


def get_portal_request_service(db: DbSession) -> PortalRequestService:
    return PortalRequestService(db)


ProviderAuthor = Annotated[Principal, Depends(require_provider_authoring)]
PortalRequestDep = Annotated[PortalRequestService, Depends(get_portal_request_service)]
ProviderAuthoringDep = Annotated[ProviderAuthoringService, Depends(get_provider_authoring_service)]
