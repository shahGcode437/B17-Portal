"""Staff authority storage (RBAC-A, migration ``0007``; design: docs/backend/AUTH_RBAC.md §27,
docs/backend/DATA_MODEL.md §17).

Two tables and two database triggers (the triggers live only in the migration — SQLAlchemy models do
not describe them, and Alembic neither compares nor drops them):

* ``staff_scope_assignments`` — which module scopes a Moderator holds. A Moderator's authority is
  the ``moderator`` role **plus** at least one row here; a Super Admin (the ``admin`` role) has
  global authority and never has rows here.
* ``staff_audit_events`` — the durable, append-only record of staff-authority events.

Database-enforced invariants (each has a test in ``tests/db/test_staff_schema.py``):

* a scope row cannot exist unless the same user holds ``moderator`` — composite foreign key
  ``(user_id, role) -> user_roles`` with the constant ``role = 'moderator'`` — and removing the role
  removes its scope rows (``ON DELETE CASCADE``);
* no duplicate ``(user_id, scope)``; ``scope`` is a closed set (the ``CategoryModule`` values — one
  source of truth, never a second enum);
* a user cannot hold ``admin`` and ``moderator`` at once: the partial unique index
  ``uq_user_roles_one_staff_role`` on ``user_roles(user_id) WHERE role IN ('admin', 'moderator')``
  enforces this as a native database invariant, so it holds under every transaction isolation level;
* an audit row can be inserted but never updated, deleted or truncated through an ordinary database
  role: a row-level trigger ``trg_staff_audit_events_append_only`` refuses UPDATE and DELETE and a
  statement-level trigger ``trg_staff_audit_events_no_truncate`` refuses TRUNCATE, both sharing one
  function. The goal is application-level invariant protection against accidental or buggy
  destructive statements, not tamper-proofing against a PostgreSQL superuser.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import (
    CategoryModule,
    RoleName,
    StaffAuditAction,
    StaffAuditResource,
    StaffAuditSource,
)

#: Every staff-audit state payload is at most this many characters of JSON text (an abuse bound; the
#: writer's allow-list keeps real payloads far smaller).
MAX_AUDIT_PAYLOAD_CHARS = 4096
MAX_AUDIT_REASON_CHARS = 500
#: Actions whose record MUST carry a reason (also enforced by a CHECK). Kept in step with the
#: migration by a test: a migration may not import application code that can change later.
REASON_REQUIRED_ACTIONS = (
    StaffAuditAction.SUPER_ADMIN_PROMOTED,
    StaffAuditAction.SUPER_ADMIN_DEMOTED,
    StaffAuditAction.MODERATION_SELF_OVERRIDE,
)
#: Minimum length of a REQUIRED reason (the same bar as a rejection reason).
MIN_REQUIRED_REASON_CHARS = 10

_REASON_REQUIRED_SQL = ", ".join(f"'{action.value}'" for action in REASON_REQUIRED_ACTIONS)


class StaffScopeAssignment(Base):
    """One module scope held by one Moderator. Exists iff the scope is active (a revoke deletes the
    row; the history of grants lives in ``staff_audit_events``)."""

    __tablename__ = "staff_scope_assignments"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    scope: Mapped[CategoryModule] = mapped_column(str_enum(CategoryModule), primary_key=True)
    #: Constant ``moderator`` (CHECK): the target of the composite foreign key below.
    role: Mapped[RoleName] = mapped_column(
        str_enum(RoleName), nullable=False, default=RoleName.MODERATOR, server_default="moderator"
    )
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        in_values("scope", CategoryModule, name="scope_valid"),
        CheckConstraint("role = 'moderator'", name="role_is_moderator"),
        ForeignKeyConstraint(
            ["user_id", "role"],
            ["user_roles.user_id", "user_roles.role"],
            ondelete="CASCADE",
            name="fk_staff_scope_assignments_user_id_role_user_roles",
        ),
        Index("ix_staff_scope_assignments_scope", "scope"),
    )


class StaffAuditEvent(UUIDPrimaryKeyMixin, Base):
    """A durable, append-only staff audit record (docs/backend/AUTH_RBAC.md §27.11).

    **No foreign keys on purpose.** ``actor_user_id`` / ``target_user_id`` / ``resource_id`` are
    plain identifiers: a ``SET NULL`` / ``CASCADE`` action would need an ``UPDATE`` / ``DELETE``
    on this table (which the append-only trigger refuses) and ``RESTRICT`` would pin user rows
    forever. A tombstoned account therefore keeps its historical identifier here, and the audit
    never blocks account maintenance. ``session_id`` is a plain identifier too (sessions purge).

    Never stored: a password or hash, a session / reset / CSRF token, a cookie, an OAuth code, token
    or credential. ``before`` / ``after`` are written only through ``StaffAuditService``, which
    accepts an allow-listed set of keys and scalar values.
    """

    __tablename__ = "staff_audit_events"

    #: The wall clock of the write (``clock_timestamp()``), like the history tables; the writer
    #: passes the application clock explicitly.
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )
    #: ``NULL`` only for an operator-CLI action (CHECK: a web action always has an actor).
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    source: Mapped[StaffAuditSource] = mapped_column(str_enum(StaffAuditSource), nullable=False)
    action: Mapped[StaffAuditAction] = mapped_column(str_enum(StaffAuditAction), nullable=False)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    resource_type: Mapped[StaffAuditResource | None] = mapped_column(str_enum(StaffAuditResource))
    resource_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    reason: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(64))
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    __table_args__ = (
        in_values("source", StaffAuditSource, name="source_valid"),
        in_values("action", StaffAuditAction, name="action_valid"),
        in_values("resource_type", StaffAuditResource, name="resource_type_valid", nullable=True),
        CheckConstraint("source = 'cli' OR actor_user_id IS NOT NULL", name="web_has_actor"),
        CheckConstraint("(resource_type IS NULL) = (resource_id IS NULL)", name="resource_pair"),
        CheckConstraint("before IS NULL OR jsonb_typeof(before) = 'object'", name="before_object"),
        CheckConstraint("after IS NULL OR jsonb_typeof(after) = 'object'", name="after_object"),
        CheckConstraint(
            f"(before IS NULL OR octet_length(before::text) <= {MAX_AUDIT_PAYLOAD_CHARS}) "
            f"AND (after IS NULL OR octet_length(after::text) <= {MAX_AUDIT_PAYLOAD_CHARS})",
            name="payload_size",
        ),
        CheckConstraint(
            f"reason IS NULL OR (char_length(btrim(reason)) >= 1 "
            f"AND char_length(reason) <= {MAX_AUDIT_REASON_CHARS})",
            name="reason_length",
        ),
        CheckConstraint(
            f"action NOT IN ({_REASON_REQUIRED_SQL}) OR (reason IS NOT NULL "
            f"AND char_length(btrim(reason)) >= {MIN_REQUIRED_REASON_CHARS})",
            name="reason_required",
        ),
        Index("ix_staff_audit_events_occurred_at", "occurred_at"),
        Index("ix_staff_audit_events_actor_user_id_occurred_at", "actor_user_id", "occurred_at"),
        Index("ix_staff_audit_events_target_user_id_occurred_at", "target_user_id", "occurred_at"),
        Index("ix_staff_audit_events_resource_type_resource_id", "resource_type", "resource_id"),
    )
