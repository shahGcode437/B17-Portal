"""Shared helpers for the RBAC-C staff-management tests (service, CLI, API and concurrency).

Everything here inspects the STORED truth (``user_roles``, ``staff_scope_assignments``,
``auth_sessions``, ``auth_events``, ``staff_audit_events``) through plain column queries — never the
API's description of it — so a test cannot pass because a response said what it wanted to hear.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from typing import Any

from httpx import Response
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.models import (
    AuthEvent,
    AuthSession,
    StaffAuditEvent,
    StaffScopeAssignment,
    User,
    UserRole,
)
from app.models.enums import AuthEventType, AuthProvider, CategoryModule
from app.services.staff_authority import StaffAuthorityService, StaffPolicy
from tests.db.auth_helpers import AuthApi, AuthEnv, FakeClock, make_account
from tests.db.write_helpers import signed_in

STAFF = "/admin/staff"
MODERATORS = "/admin/staff/moderators"
AUDIT = "/admin/audit"
REASON = "Rotating credentials after the quarterly review."

FOOD, DIRECTORY, SERVICES, EDUCATION, PROPERTY, NEWS = (
    CategoryModule.FOOD,
    CategoryModule.DIRECTORY,
    CategoryModule.SERVICES,
    CategoryModule.EDUCATION,
    CategoryModule.PROPERTY,
    CategoryModule.NEWS,
)


def values(scopes: Iterable[CategoryModule | str]) -> list[str]:
    return [s.value if isinstance(s, CategoryModule) else s for s in scopes]


# -- services and accounts -------------------------------------------------------------------------


def policy(
    *, hosted: bool = False, ceiling: int = 3, providers: Iterable[AuthProvider] = ()
) -> StaffPolicy:
    """A staff policy. ``providers`` are the login providers that can authenticate (default none:
    "password only", the same as a default configuration where Google sign-in is disabled)."""
    return StaffPolicy(hosted=hosted, safety_ceiling=ceiling, login_providers=frozenset(providers))


def service(
    session: Session, clock: FakeClock | None = None, **policy_overrides: Any
) -> StaffAuthorityService:
    return StaffAuthorityService(session, clock or FakeClock(), policy(**policy_overrides))


def super_admin(env: AuthEnv, email: str = "sa@example.org", name: str = "Sam Admin") -> AuthApi:
    """A Super Admin signed in through the real login (a session created now)."""
    return signed_in(env, email, professional=None, admin=True, display_name=name)


def candidate(env: AuthEnv, email: str = "cand@example.org", **account: Any) -> User:
    """An ordinary account (NOT signed in): a Resident unless ``account`` says otherwise."""
    account.setdefault("display_name", "Casey Candidate")
    return make_account(env.session, email, **account)


def sign_in(env: AuthEnv, email: str) -> AuthApi:
    api = env.client()
    assert api.login(email).status_code == 200
    return api


# -- the API, one thin call per route -------------------------------------------------------------


def appoint(
    api: AuthApi, email: str, scopes: Iterable[CategoryModule | str], **kw: Any
) -> Response:
    return api.request("POST", MODERATORS, json={"email": email, "scopes": values(scopes)}, **kw)


def put_scopes(
    api: AuthApi, user_id: uuid.UUID | str, scopes: Iterable[CategoryModule | str], **kw: Any
) -> Response:
    return api.request(
        "PUT", f"{MODERATORS}/{user_id}/scopes", json={"scopes": values(scopes)}, **kw
    )


def pause(api: AuthApi, user_id: uuid.UUID | str, **kw: Any) -> Response:
    return api.request("POST", f"{MODERATORS}/{user_id}/pause", **kw)


def resume(
    api: AuthApi, user_id: uuid.UUID | str, scopes: Iterable[CategoryModule | str], **kw: Any
) -> Response:
    return api.request(
        "POST", f"{MODERATORS}/{user_id}/resume", json={"scopes": values(scopes)}, **kw
    )


def remove(api: AuthApi, user_id: uuid.UUID | str, **kw: Any) -> Response:
    return api.request("DELETE", f"{MODERATORS}/{user_id}", **kw)


def detail_code(response: Response) -> str:
    """The stable ``details[0].code`` of an error response."""
    return str(response.json()["error"]["details"][0]["code"])


# -- stored state ---------------------------------------------------------------------------------


def roles_of(session: Session, user_id: uuid.UUID) -> set[str]:
    session.expire_all()
    return {
        r.value for r in session.scalars(select(UserRole.role).where(UserRole.user_id == user_id))
    }


def scopes_of(session: Session, user_id: uuid.UUID) -> list[str]:
    session.expire_all()
    return sorted(
        s.value
        for s in session.scalars(
            select(StaffScopeAssignment.scope).where(StaffScopeAssignment.user_id == user_id)
        )
    )


def live_sessions(session: Session, user_id: uuid.UUID) -> int:
    session.expire_all()
    return int(
        session.scalar(
            select(func.count())
            .select_from(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        )
        or 0
    )


def revoke_reasons(session: Session, user_id: uuid.UUID) -> set[str]:
    session.expire_all()
    return {
        str(r)
        for r in session.scalars(
            select(AuthSession.revoke_reason).where(
                AuthSession.user_id == user_id, AuthSession.revoked_at.is_not(None)
            )
        )
    }


def auth_event_types(session: Session, user_id: uuid.UUID) -> list[AuthEventType]:
    session.expire_all()
    return list(
        session.scalars(
            select(AuthEvent.event_type)
            .where(AuthEvent.user_id == user_id)
            .order_by(AuthEvent.occurred_at, AuthEvent.id)
        )
    )


def role_event_types(session: Session, user_id: uuid.UUID) -> list[AuthEventType]:
    """Only the ``role_granted`` / ``role_revoked`` timeline events of the account, sorted (the fake
    clock stamps every event with the same instant, so their ORDER is not defined by the data)."""
    return sorted(
        (
            t
            for t in auth_event_types(session, user_id)
            if t in (AuthEventType.ROLE_GRANTED, AuthEventType.ROLE_REVOKED)
        ),
        key=str,
    )


def audit_events(session: Session) -> list[StaffAuditEvent]:
    session.expire_all()
    return list(
        session.scalars(
            select(StaffAuditEvent).order_by(StaffAuditEvent.occurred_at, StaffAuditEvent.id)
        )
    )


def audit_count(session: Session) -> int:
    session.expire_all()
    return int(session.scalar(select(func.count()).select_from(StaffAuditEvent)) or 0)


def auth_event_count(session: Session) -> int:
    session.expire_all()
    return int(session.scalar(select(func.count()).select_from(AuthEvent)) or 0)


def snapshot(session: Session, user_id: uuid.UUID) -> tuple[Any, ...]:
    """Everything a refused or rolled-back operation must leave exactly as it was."""
    return (
        roles_of(session, user_id),
        scopes_of(session, user_id),
        live_sessions(session, user_id),
        audit_count(session),
        auth_event_count(session),
    )


def open_sessions(env: AuthEnv, email: str, count: int = 2) -> list[AuthApi]:
    """``count`` independent signed-in browsers for one account (several live sessions)."""
    return [sign_in(env, email) for _ in range(count)]


# -- committed-world cleanup ---------------------------------------------------------------------


@contextmanager
def purge_staff_audit(engine: Engine) -> Iterator[None]:
    """The staff audit is append-only (row- and statement-level triggers), and ``TRUNCATE ... users
    CASCADE`` does not reach it (it has no foreign keys), so a committed-world test would leave its
    audit rows for every later test to see. Clear them in TEST teardown only, by disabling the two
    triggers for the duration of one transaction (the test role owns the table; production roles
    do not) — DDL is transactional, so the triggers are back on whatever happens."""
    try:
        yield
    finally:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "ALTER TABLE staff_audit_events DISABLE TRIGGER trg_staff_audit_events_append_only"
                )
            )
            connection.execute(
                text(
                    "ALTER TABLE staff_audit_events DISABLE TRIGGER trg_staff_audit_events_no_truncate"
                )
            )
            connection.execute(text("TRUNCATE staff_audit_events"))
            connection.execute(
                text(
                    "ALTER TABLE staff_audit_events ENABLE TRIGGER trg_staff_audit_events_append_only"
                )
            )
            connection.execute(
                text(
                    "ALTER TABLE staff_audit_events ENABLE TRIGGER trg_staff_audit_events_no_truncate"
                )
            )


def no_secrets(text_: str) -> None:
    """A response / audit text must never carry these."""
    lowered = text_.lower()
    for forbidden in ("password", "hash", "token", "cookie", "secret", "csrf", "oauth"):
        assert forbidden not in lowered, forbidden
