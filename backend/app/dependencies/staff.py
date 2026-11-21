"""Dependencies of the staff-management routes (RBAC-C; docs/backend/AUTH_RBAC.md §27.7)."""

from typing import Annotated

from fastapi import Depends

from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import STAFF_MUTATION
from app.dependencies.auth import ClockDep, SensitiveSuperAdminUser
from app.dependencies.db import DbSession
from app.dependencies.settings import SettingsDep
from app.services.auth_sessions import Principal
from app.services.rate_limit import PostgresRateLimiter
from app.services.staff_authority import StaffAuthorityService, StaffPolicy


def require_staff_mutation(
    principal: SensitiveSuperAdminUser, db: DbSession, clock: ClockDep
) -> Principal:
    """The gate every staff-management MUTATION passes, in this order: a verified Super Admin with a
    fresh session (``require_super_admin``), a session created within the sensitive window
    (``require_sensitive_super_admin``), then a modest per-actor rate limit.

    The limiter runs LAST, so only an already-authorised Super Admin can consume it and a ``429``
    performs no mutation (the service is never reached). Every attempt that gets this far counts —
    failures included — so probing accounts through the appointment endpoint is throttled too. It
    is a tripwire for automation, not the security boundary."""
    decision = PostgresRateLimiter(db, clock).hit(
        f"staff-mutation:{principal.user_id}", STAFF_MUTATION
    )
    if not decision.allowed:
        raise AppError(
            ErrorCode.RATE_LIMITED,
            status_code=429,
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )
    return principal


def get_staff_authority_service(
    db: DbSession, settings: SettingsDep, clock: ClockDep
) -> StaffAuthorityService:
    return StaffAuthorityService(db, clock, StaffPolicy.from_settings(settings))


StaffMutationUser = Annotated[Principal, Depends(require_staff_mutation)]
StaffAuthorityDep = Annotated[StaffAuthorityService, Depends(get_staff_authority_service)]
