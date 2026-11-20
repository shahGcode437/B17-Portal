"""Persistence for the durable staff audit (RBAC-A). ``add`` + ``flush`` only — **never commits**
(BACKEND_ARCHITECTURE.md §5): a staff audit row commits or rolls back with the action it records.
There is deliberately no update or delete method: the table is append-only (a database trigger
enforces it too)."""

from sqlalchemy.orm import Session

from app.models import StaffAuditEvent


class StaffAuditRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, event: StaffAuditEvent) -> StaffAuditEvent:
        self._session.add(event)
        self._session.flush()
        return event
