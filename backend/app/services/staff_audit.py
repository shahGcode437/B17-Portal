"""The writer of the durable staff audit (RBAC-A; docs/backend/AUTH_RBAC.md §27.11).

A narrow, typed door into ``staff_audit_events``:

* only the closed ``StaffAuditAction`` / ``StaffAuditSource`` / ``StaffAuditResource`` vocabularies;
* ``before`` / ``after`` are **allow-listed**: an unapproved key is REFUSED (not silently dropped,
  so a programming error is loud and nothing is half-recorded) and the error names the key, never
  the value. Values are short scalars or short lists of scalars — no nested blobs;
* a second, independent guard refuses any key that looks like a secret (password, hash, token,
  cookie, credential, OAuth, CSRF, ...) even if someone later adds it to the allow-list by mistake;
* a reason is normalized and bounded like a rejection reason; the actions that REQUIRE one cannot be
  written without it (the database CHECK says the same);
* it runs inside the **caller's** transaction and never commits (``flush`` only), so an event
  commits or rolls back together with the action it records.

No production path uses it yet: RBAC-B (the Service / Professional approval override) and RBAC-C
(staff changes) are its first writers.
"""

import uuid
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.logging import request_id_var
from app.models import StaffAuditEvent
from app.models.enums import StaffAuditAction, StaffAuditResource, StaffAuditSource
from app.models.staff import MIN_REQUIRED_REASON_CHARS, REASON_REQUIRED_ACTIONS
from app.repositories.staff import StaffAuditRepository
from app.services.moderation_rules import MAX_REJECTION_REASON_LENGTH, normalize_reason

#: The only keys a ``before`` / ``after`` payload may carry. Adding one is a reviewed code change.
ALLOWED_STATE_KEYS = frozenset(
    {
        "role",
        "scope",
        "scopes",
        "status",
        "revision",
        "sessions_revoked",
        "super_admin_count",
        "break_glass",
        "override",
        "name",
        "slug",
        "is_active",
        "display_order",
        "parent_id",
        "kind",
        "vertical",
        "changed_fields",
    }
)
#: Fragments no payload key may ever contain, whatever the allow-list says.
FORBIDDEN_KEY_FRAGMENTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "cookie",
    "hash",
    "credential",
    "oauth",
    "csrf",
    "authorization",
    "bearer",
    "api_key",
    "apikey",
)
_MAX_STRING = 120
_MAX_ITEMS = 12
_MAX_ITEM_STRING = 40
_MAX_REQUEST_ID = 64


class StaffAuditError(ValueError):
    """The record would be unsafe or malformed, so nothing was written."""


def _has_forbidden_fragment(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in FORBIDDEN_KEY_FRAGMENTS)


# The allow-list itself must never contain a secret-looking key (checked at import time, so a bad
# edit fails every test run instead of waiting for a runtime refusal).
_BAD = sorted(key for key in ALLOWED_STATE_KEYS if _has_forbidden_fragment(key))
if _BAD:  # pragma: no cover - a development-time assertion
    raise RuntimeError(f"staff audit allow-list contains secret-looking keys: {_BAD}")


def _scalar(value: object, key: str, *, limit: int) -> str | int | bool | None:
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, str):
        text = str(value)  # StrEnum members become their plain value
        if len(text) > limit or not text.isprintable():
            raise StaffAuditError(f"audit payload value for {key!r} is too long or not plain text")
        return text
    raise StaffAuditError(f"audit payload value for {key!r} has an unsupported type")


def clean_state(payload: Mapping[str, object] | None) -> dict[str, Any] | None:
    """The allow-listed, JSON-safe copy of a ``before`` / ``after`` payload (or ``None``)."""
    if payload is None:
        return None
    cleaned: dict[str, Any] = {}
    for key, value in payload.items():
        if key not in ALLOWED_STATE_KEYS or _has_forbidden_fragment(key):
            raise StaffAuditError(f"audit payload key {key!r} is not allowed")
        if isinstance(value, Sequence) and not isinstance(value, str | bytes):
            if len(value) > _MAX_ITEMS:
                raise StaffAuditError(f"audit payload list for {key!r} is too long")
            cleaned[key] = [_scalar(item, key, limit=_MAX_ITEM_STRING) for item in value]
        else:
            cleaned[key] = _scalar(value, key, limit=_MAX_STRING)
    return cleaned


def clean_reason(action: StaffAuditAction, reason: str | None) -> str | None:
    """A normalized reason: required for the actions that demand one, bounded for all."""
    if reason is None:
        if action in REASON_REQUIRED_ACTIONS:
            raise StaffAuditError(f"a reason is required for {action.value}")
        return None
    text = normalize_reason(reason)
    if len(text) < MIN_REQUIRED_REASON_CHARS:
        raise StaffAuditError(f"the reason must be at least {MIN_REQUIRED_REASON_CHARS} characters")
    if len(text) > MAX_REJECTION_REASON_LENGTH:
        raise StaffAuditError(
            f"the reason must be at most {MAX_REJECTION_REASON_LENGTH} characters"
        )
    return text


def _member[E: StrEnum](enum_class: type[E], value: str, label: str) -> E:
    try:
        return enum_class(value)
    except ValueError:
        raise StaffAuditError(f"unsupported staff audit {label}") from None


class StaffAuditService:
    def __init__(self, session: Session, clock: Clock) -> None:
        self._events = StaffAuditRepository(session)
        self._clock = clock

    def record(
        self,
        action: StaffAuditAction,
        *,
        source: StaffAuditSource,
        actor_user_id: uuid.UUID | None = None,
        target_user_id: uuid.UUID | None = None,
        resource_type: StaffAuditResource | None = None,
        resource_id: uuid.UUID | None = None,
        before: Mapping[str, object] | None = None,
        after: Mapping[str, object] | None = None,
        reason: str | None = None,
        session_id: uuid.UUID | None = None,
    ) -> StaffAuditEvent:
        """Append one event inside the caller's transaction (``flush`` only; never commits)."""
        action = _member(StaffAuditAction, action, "action")
        source = _member(StaffAuditSource, source, "source")
        if source is StaffAuditSource.WEB and actor_user_id is None:
            raise StaffAuditError("a web staff action needs an actor")
        if (resource_type is None) != (resource_id is None):
            raise StaffAuditError("resource_type and resource_id go together")
        kind = (
            _member(StaffAuditResource, resource_type, "resource type") if resource_type else None
        )
        request_id = request_id_var.get()
        return self._events.add(
            StaffAuditEvent(
                occurred_at=self._clock(),
                actor_user_id=actor_user_id,
                source=source,
                action=action,
                target_user_id=target_user_id,
                resource_type=kind,
                resource_id=resource_id,
                before=clean_state(before),
                after=clean_state(after),
                reason=clean_reason(action, reason),
                request_id=request_id[:_MAX_REQUEST_ID] if request_id else None,
                session_id=session_id,
            )
        )
