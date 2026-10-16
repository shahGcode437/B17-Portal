"""Security audit events (docs/backend/AUTH_RBAC.md §13.2).

Writes to ``auth_events`` inside the **caller's** transaction, so an event commits or rolls back
together with the action it records. ``details`` is an allow-list, never a request dump: only the
keys below survive, as short strings. Passwords, tokens, cookies, IP addresses, user agents and the
emails of unknown accounts are never recorded.
"""

import uuid
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.logging import request_id_var
from app.models import AuthEvent
from app.models.enums import AuthEventType
from app.repositories.auth import EventRepository

ALLOWED_DETAIL_KEYS = frozenset({"provider", "reason", "session_id"})
_MAX_DETAIL_LENGTH = 64


class AuthAuditService:
    def __init__(self, session: Session, clock: Clock) -> None:
        self._events = EventRepository(session)
        self._clock = clock

    def record(
        self,
        event_type: AuthEventType,
        *,
        user_id: uuid.UUID | None = None,
        actor_user_id: uuid.UUID | None = None,
        details: Mapping[str, object] | None = None,
    ) -> None:
        safe = {
            key: str(value)[:_MAX_DETAIL_LENGTH]
            for key, value in (details or {}).items()
            if key in ALLOWED_DETAIL_KEYS
        }
        request_id = request_id_var.get()
        self._events.add(
            AuthEvent(
                occurred_at=self._clock(),
                user_id=user_id,
                actor_user_id=actor_user_id,
                event_type=event_type,
                request_id=request_id[:64] if request_id else None,
                details=safe or None,
            )
        )
