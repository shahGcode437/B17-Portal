"""Staff management: the Super Admin roster and audit, and Moderator appointment / scopes / pause /
resume / removal (RBAC-C; docs/backend/AUTH_RBAC.md §27.7, §30).

TWO routers share the ``/admin`` prefix, and the choice of router IS the authority — the same
fail-closed structure as ``admin.py``:

* ``router`` — the DEFAULT of this module, **Super Admin only** (``require_super_admin``): the two
  READ routes. A route added here without a further decision can never be public or reachable by a
  Moderator.
* ``sensitive_router`` — every MUTATION: ``require_staff_mutation`` = a Super Admin with a fresh
  session (idle <= 2 h, age <= 12 h), whose session was also CREATED within the 15-minute
  sensitive window, within a per-actor rate limit. CSRF and Origin are checked by the existing
  middleware for every unsafe method (POST / PUT / DELETE), before routing.

There is NO route that promotes or demotes a Super Admin, here or anywhere: that stays an operator
CLI operation (``python -m app.cli.staff``). Every mutation delegates to
``StaffAuthorityService``, which owns the transaction, the locks, the session revocation and the
audit; a route only parses, calls it, and shapes the answer. Every answer is ``no-store``.
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.api.routing import ContractRoute
from app.core.errors import AppError, ErrorCode, ErrorDetail, ErrorResponse
from app.dependencies.auth import require_super_admin
from app.dependencies.db import DbSession
from app.dependencies.staff import StaffAuthorityDep, StaffMutationUser, require_staff_mutation
from app.dependencies.write import NoStore
from app.schemas.envelope import PageMeta
from app.schemas.staff import (
    AppointModeratorRequest,
    ReplaceScopesRequest,
    ResumeModeratorRequest,
    StaffAuditEnvelope,
    StaffAuditQuery,
    StaffMemberEnvelope,
    StaffRosterEnvelope,
    StaffRosterQuery,
)
from app.services.staff_reads import StaffReadService
from app.services.staff_rules import StaffAuthorityError, StaffCode

_READ_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated / session_expired"},
    403: {
        "model": ErrorResponse,
        "description": "email_not_verified | forbidden (not a Super Admin)",
    },
}
_MUTATION_RESPONSES: dict[int | str, dict[str, Any]] = {
    **_READ_RESPONSES,
    403: {
        "model": ErrorResponse,
        "description": (
            "email_not_verified | forbidden (not a Super Admin / super_admin_target_forbidden) "
            "| sensitive_reauth_required | csrf_failed"
        ),
    },
    404: {"model": ErrorResponse, "description": "moderator_not_found"},
    409: {
        "model": ErrorResponse,
        "description": (
            "already_moderator | moderator_paused | moderator_not_paused | moderator_already_paused"
        ),
    },
    422: {
        "model": ErrorResponse,
        "description": "validation_error | invalid_staff_scope | target_not_eligible",
    },
    429: {"model": ErrorResponse, "description": "rate_limited"},
}

#: The default of this module: Super Admin only. Reads live here.
router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_super_admin)],
    responses=_READ_RESPONSES,
)

#: Mutations only: Super Admin + the sensitive window + the rate limit.
sensitive_router = APIRouter(
    prefix="/admin",
    route_class=ContractRoute,
    tags=["admin"],
    dependencies=[NoStore, Depends(require_staff_mutation)],
    responses=_MUTATION_RESPONSES,
)

#: ``StaffCode`` -> (HTTP status, API error code). Anything not listed is a CLI-only code that a
#: route can never raise; it would surface as ``400``.
_HTTP: dict[StaffCode, tuple[int, ErrorCode]] = {
    StaffCode.MODERATOR_NOT_FOUND: (404, ErrorCode.NOT_FOUND),
    StaffCode.TARGET_NOT_ELIGIBLE: (422, ErrorCode.VALIDATION_ERROR),
    StaffCode.INVALID_STAFF_SCOPE: (422, ErrorCode.VALIDATION_ERROR),
    StaffCode.SUPER_ADMIN_TARGET_FORBIDDEN: (403, ErrorCode.FORBIDDEN),
    StaffCode.ACTOR_NOT_AUTHORISED: (403, ErrorCode.FORBIDDEN),
    StaffCode.ALREADY_MODERATOR: (409, ErrorCode.CONFLICT),
    StaffCode.MODERATOR_PAUSED: (409, ErrorCode.CONFLICT),
    StaffCode.MODERATOR_NOT_PAUSED: (409, ErrorCode.CONFLICT),
    StaffCode.MODERATOR_ALREADY_PAUSED: (409, ErrorCode.CONFLICT),
    StaffCode.LAST_SUPER_ADMIN: (409, ErrorCode.CONFLICT),
}


def _app_error(error: StaffAuthorityError) -> AppError:
    status, code = _HTTP.get(error.code, (400, ErrorCode.BAD_REQUEST))
    return AppError(
        code,
        error.message,
        status_code=status,
        details=[
            ErrorDetail(
                field=error.field or "request", code=error.code.value, message=error.message
            )
        ],
    )


@contextmanager
def _staff_errors() -> Iterator[None]:
    """Render a service refusal as the stable API error (its ``details[].code`` is the contract)."""
    try:
        yield
    except StaffAuthorityError as error:
        raise _app_error(error) from None


def _user_id(raw: str) -> uuid.UUID:
    """A malformed id is the same ``moderator_not_found`` as an unknown one."""
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise _app_error(
            StaffAuthorityError(StaffCode.MODERATOR_NOT_FOUND, "No such moderator.")
        ) from None


# -- reads (Super Admin) ---------------------------------------------------------------------------


@router.get("/staff", response_model=StaffRosterEnvelope, summary="The staff roster")
def staff_roster(
    session: DbSession, query: Annotated[StaffRosterQuery, Query()]
) -> StaffRosterEnvelope:
    """Super Admins (read-only) first, then Moderators, with their scopes, account state and who
    granted the role. Paused = a Moderator with no scopes. Nothing secret has a field here."""
    members, total = StaffReadService(session).roster(query.limit, query.offset)
    return StaffRosterEnvelope(
        data=members, meta=PageMeta(total=total, limit=query.limit, offset=query.offset)
    )


@router.get("/audit", response_model=StaffAuditEnvelope, summary="The durable staff audit")
def staff_audit(
    session: DbSession, query: Annotated[StaffAuditQuery, Query()]
) -> StaffAuditEnvelope:
    """``staff_audit_events``, newest first, in bounded pages, with optional ``action`` / ``actor``
    / ``target`` / ``resource`` / ``since`` / ``until`` filters. Read-only (the table is
    append-only)."""
    entries, total = StaffReadService(session).audit(query)
    return StaffAuditEnvelope(
        data=entries, meta=PageMeta(total=total, limit=query.limit, offset=query.offset)
    )


# -- mutations (Super Admin + sensitive window + rate limit) -------------------------------------


@sensitive_router.post(
    "/staff/moderators",
    status_code=201,
    response_model=StaffMemberEnvelope,
    summary="Appoint a Moderator",
)
def appoint_moderator(
    payload: AppointModeratorRequest,
    actor: StaffMutationUser,
    service: StaffAuthorityDep,
    session: DbSession,
) -> StaffMemberEnvelope:
    """Make an existing, active, verified account a Moderator with at least one assignable scope
    (``news`` is reserved). A Professional profile is not required. The target's sessions are
    revoked: the new authority is usable only after a fresh sign-in. An unknown address and every
    ineligible state answer the same ``target_not_eligible``."""
    with _staff_errors():
        change = service.appoint_moderator(actor.user_id, payload.email, payload.scopes)
    return StaffMemberEnvelope(data=StaffReadService(session).member(change.user_id))


@sensitive_router.put(
    "/staff/moderators/{user_id}/scopes",
    response_model=StaffMemberEnvelope,
    summary="Replace a Moderator's scopes",
)
def replace_scopes(
    user_id: str,
    payload: ReplaceScopesRequest,
    actor: StaffMutationUser,
    service: StaffAuthorityDep,
    session: DbSession,
) -> StaffMemberEnvelope:
    """The Moderator ends with EXACTLY these scopes (at least one). An identical set changes
    nothing. An empty set is a pause (its own operation); a paused Moderator is resumed, not
    updated. Any real change revokes the target's sessions."""
    target = _user_id(user_id)
    with _staff_errors():
        service.replace_scopes(actor.user_id, target, payload.scopes)
    return StaffMemberEnvelope(data=StaffReadService(session).member(target))


@sensitive_router.post(
    "/staff/moderators/{user_id}/pause",
    response_model=StaffMemberEnvelope,
    summary="Pause a Moderator",
)
def pause_moderator(
    user_id: str, actor: StaffMutationUser, service: StaffAuthorityDep, session: DbSession
) -> StaffMemberEnvelope:
    """Keep the role, delete every scope, revoke every session. A paused Moderator has no staff
    authority at all."""
    target = _user_id(user_id)
    with _staff_errors():
        service.pause_moderator(actor.user_id, target)
    return StaffMemberEnvelope(data=StaffReadService(session).member(target))


@sensitive_router.post(
    "/staff/moderators/{user_id}/resume",
    response_model=StaffMemberEnvelope,
    summary="Resume a paused Moderator",
)
def resume_moderator(
    user_id: str,
    payload: ResumeModeratorRequest,
    actor: StaffMutationUser,
    service: StaffAuthorityDep,
    session: DbSession,
) -> StaffMemberEnvelope:
    """Give a paused Moderator at least one assignable scope again (same eligibility checks as an
    appointment). Revokes the target's sessions: authority returns after a fresh sign-in."""
    target = _user_id(user_id)
    with _staff_errors():
        service.resume_moderator(actor.user_id, target, payload.scopes)
    return StaffMemberEnvelope(data=StaffReadService(session).member(target))


@sensitive_router.delete(
    "/staff/moderators/{user_id}",
    status_code=204,
    summary="Remove a Moderator",
)
def remove_moderator(
    user_id: str, actor: StaffMutationUser, service: StaffAuthorityDep
) -> Response:
    """Delete the ``moderator`` role (its scopes go with it) and revoke every session. The account
    itself remains: this is never a user deletion."""
    with _staff_errors():
        service.remove_moderator(actor.user_id, _user_id(user_id))
    return Response(status_code=204)
