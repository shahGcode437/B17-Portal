"""staff authority: the moderator role, scope assignments and the durable staff audit

RBAC-A (docs/backend/AUTH_RBAC.md §27, docs/backend/DATA_MODEL.md §17) — the schema foundation of
the Super Admin + scoped Moderator model. **No behaviour changes**: nothing in the running
application grants, reads for authorization decisions or writes any of this beyond what RBAC-A's
primitives (tested, not wired to any route) do.

What it does:

* widens ``user_roles.role`` to ``admin | moderator`` (``admin`` is the Super Admin role and keeps
  its stored value) and ``listing_status_history.actor_role`` to ``owner | admin | moderator``
  (nothing writes ``moderator`` until RBAC-B);
* ``staff_scope_assignments``: a scope row cannot exist unless the same user holds ``moderator``
  (composite foreign key on the constant ``role`` column, ``ON DELETE CASCADE``), ``(user_id,
  scope)`` is the primary key (no duplicate), ``scope`` is the closed ``CategoryModule`` set;
* partial unique index ``uq_user_roles_one_staff_role`` on ``user_roles(user_id) WHERE role IN
  ('admin', 'moderator')``: a user cannot hold ``admin`` and ``moderator`` at once. It is a native
  database invariant that holds under every transaction isolation level — a concurrent INSERT or
  UPDATE that would duplicate the key blocks on the first writer and, when the first commits, is
  refused with SQLSTATE 23505. The scope assignment foreign key still references ``(user_id, role)``
  through the existing primary key of ``user_roles``, which is unchanged;
* ``staff_audit_events`` and two sibling triggers that share one function: ``trg_staff_audit_events_
  append_only`` (row-level, BEFORE UPDATE OR DELETE) and ``trg_staff_audit_events_no_truncate``
  (statement-level, BEFORE TRUNCATE). Rows can be inserted but never updated, deleted or truncated
  through an ordinary database role. The identifier columns have no foreign keys on purpose (a ``SET
  NULL`` / ``CASCADE`` action would need an UPDATE / DELETE the triggers refuse, and ``RESTRICT``
  would pin user rows), so a tombstoned account keeps its historical identifier. The triggers do not
  claim to defend against a PostgreSQL superuser — their job is application-level invariant
  protection against accidental or buggy destructive statements. An operator who deliberately wants a
  downgrade must drop the triggers first; ``DROP TABLE`` in the downgrade cascades them.

``downgrade`` REFUSES (loudly, nothing is changed) while any moderator role, scope assignment, staff
audit event or ``moderator`` listing decision exists: dropping them would silently destroy staff
authority or audit history. An empty database (development / CI) downgrades cleanly.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Repeated here on purpose (a migration must not import application code that may change later).
SCOPES = "'services', 'directory', 'food', 'education', 'property', 'news'"
ACTIONS = (
    "'moderator_appointed', 'moderator_paused', 'moderator_removed', 'scope_granted', "
    "'scope_revoked', 'super_admin_promoted', 'super_admin_demoted', 'moderation_self_override', "
    "'provider_created', 'provider_updated', 'provider_archived', 'taxonomy_created', "
    "'taxonomy_updated', 'taxonomy_reordered'"
)
REASON_REQUIRED = "'super_admin_promoted', 'super_admin_demoted', 'moderation_self_override'"

APPEND_ONLY_FUNCTION = """
CREATE FUNCTION staff_audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'staff_audit_events is append-only: % is not allowed', TG_OP
        USING ERRCODE = '23001', CONSTRAINT = 'trg_staff_audit_events_append_only';
END
$$
"""

#: What the downgrade refuses to destroy: (description, SQL returning a row count).
LIVE_DATA = (
    ("moderator role grants", "SELECT count(*) FROM user_roles WHERE role = 'moderator'"),
    ("staff scope assignments", "SELECT count(*) FROM staff_scope_assignments"),
    ("staff audit events", "SELECT count(*) FROM staff_audit_events"),
    (
        "moderator listing decisions",
        "SELECT count(*) FROM listing_status_history WHERE actor_role = 'moderator'",
    ),
)


def upgrade() -> None:
    op.drop_constraint(op.f("ck_user_roles_role_valid"), "user_roles", type_="check")
    op.create_check_constraint(
        op.f("ck_user_roles_role_valid"), "user_roles", "role IN ('admin', 'moderator')"
    )
    op.drop_constraint(
        op.f("ck_listing_status_history_actor_role_valid"),
        "listing_status_history",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_listing_status_history_actor_role_valid"),
        "listing_status_history",
        "actor_role IN ('owner', 'admin', 'moderator')",
    )

    op.create_table(
        "staff_scope_assignments",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=32), server_default="moderator", nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=True),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"scope IN ({SCOPES})", name=op.f("ck_staff_scope_assignments_scope_valid")
        ),
        sa.CheckConstraint(
            "role = 'moderator'", name=op.f("ck_staff_scope_assignments_role_is_moderator")
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "role"],
            ["user_roles.user_id", "user_roles.role"],
            name=op.f("fk_staff_scope_assignments_user_id_role_user_roles"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by"],
            ["users.id"],
            name=op.f("fk_staff_scope_assignments_granted_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("user_id", "scope", name=op.f("pk_staff_scope_assignments")),
    )
    op.create_index(
        "ix_staff_scope_assignments_scope", "staff_scope_assignments", ["scope"], unique=False
    )

    op.create_table(
        "staff_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=True),
        sa.Column("resource_type", sa.String(length=32), nullable=True),
        sa.Column("resource_id", sa.Uuid(), nullable=True),
        sa.Column("before", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("after", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "source IN ('web', 'cli')", name=op.f("ck_staff_audit_events_source_valid")
        ),
        sa.CheckConstraint(
            f"action IN ({ACTIONS})", name=op.f("ck_staff_audit_events_action_valid")
        ),
        sa.CheckConstraint(
            "resource_type IS NULL OR resource_type IN ('listing', 'category')",
            name=op.f("ck_staff_audit_events_resource_type_valid"),
        ),
        sa.CheckConstraint(
            "source = 'cli' OR actor_user_id IS NOT NULL",
            name=op.f("ck_staff_audit_events_web_has_actor"),
        ),
        sa.CheckConstraint(
            "(resource_type IS NULL) = (resource_id IS NULL)",
            name=op.f("ck_staff_audit_events_resource_pair"),
        ),
        sa.CheckConstraint(
            "before IS NULL OR jsonb_typeof(before) = 'object'",
            name=op.f("ck_staff_audit_events_before_object"),
        ),
        sa.CheckConstraint(
            "after IS NULL OR jsonb_typeof(after) = 'object'",
            name=op.f("ck_staff_audit_events_after_object"),
        ),
        sa.CheckConstraint(
            "(before IS NULL OR octet_length(before::text) <= 4096) "
            "AND (after IS NULL OR octet_length(after::text) <= 4096)",
            name=op.f("ck_staff_audit_events_payload_size"),
        ),
        sa.CheckConstraint(
            "reason IS NULL OR (char_length(btrim(reason)) >= 1 AND char_length(reason) <= 500)",
            name=op.f("ck_staff_audit_events_reason_length"),
        ),
        sa.CheckConstraint(
            f"action NOT IN ({REASON_REQUIRED}) "
            "OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 10)",
            name=op.f("ck_staff_audit_events_reason_required"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff_audit_events")),
    )
    op.create_index(
        "ix_staff_audit_events_occurred_at", "staff_audit_events", ["occurred_at"], unique=False
    )
    op.create_index(
        "ix_staff_audit_events_actor_user_id_occurred_at",
        "staff_audit_events",
        ["actor_user_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_staff_audit_events_target_user_id_occurred_at",
        "staff_audit_events",
        ["target_user_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_staff_audit_events_resource_type_resource_id",
        "staff_audit_events",
        ["resource_type", "resource_id"],
        unique=False,
    )

    # The native, isolation-independent Super Admin / Moderator exclusivity invariant: the WHERE
    # restricts it to the two staff roles, so adding a future non-staff role would need no change.
    op.execute(
        "CREATE UNIQUE INDEX uq_user_roles_one_staff_role "
        "ON user_roles (user_id) WHERE role IN ('admin', 'moderator')"
    )

    op.execute(APPEND_ONLY_FUNCTION)
    op.execute(
        "CREATE TRIGGER trg_staff_audit_events_append_only "
        "BEFORE UPDATE OR DELETE ON staff_audit_events "
        "FOR EACH ROW EXECUTE FUNCTION staff_audit_events_append_only()"
    )
    # TRUNCATE fires only a STATEMENT-level trigger (one trigger cannot combine it with UPDATE /
    # DELETE); both triggers share the same function and the same refusal path.
    op.execute(
        "CREATE TRIGGER trg_staff_audit_events_no_truncate "
        "BEFORE TRUNCATE ON staff_audit_events "
        "FOR EACH STATEMENT EXECUTE FUNCTION staff_audit_events_append_only()"
    )


def downgrade() -> None:
    bind = op.get_bind()
    found = {
        description: int(bind.execute(sa.text(query)).scalar_one())
        for description, query in LIVE_DATA
    }
    live = {description: count for description, count in found.items() if count}
    if live:
        listing = ", ".join(f"{count} {description}" for description, count in live.items())
        raise RuntimeError(
            "Refusing to downgrade 0007: it would destroy or invalidate live staff authority / "
            f"audit data ({listing}). Nothing was changed. Remove the moderator roles and scope "
            "assignments through the staff tooling and archive the audit rows deliberately first; "
            "a downgrade is only for an empty development or CI database."
        )

    # ``IF EXISTS`` because a deliberate operator cleanup (the only legitimate way to clear the
    # append-only audit before a downgrade) may already have dropped these triggers.
    op.execute("DROP TRIGGER IF EXISTS trg_staff_audit_events_no_truncate ON staff_audit_events")
    op.execute("DROP TRIGGER IF EXISTS trg_staff_audit_events_append_only ON staff_audit_events")
    op.execute("DROP FUNCTION IF EXISTS staff_audit_events_append_only()")
    op.execute("DROP INDEX IF EXISTS uq_user_roles_one_staff_role")

    op.drop_index(
        "ix_staff_audit_events_resource_type_resource_id", table_name="staff_audit_events"
    )
    op.drop_index(
        "ix_staff_audit_events_target_user_id_occurred_at", table_name="staff_audit_events"
    )
    op.drop_index(
        "ix_staff_audit_events_actor_user_id_occurred_at", table_name="staff_audit_events"
    )
    op.drop_index("ix_staff_audit_events_occurred_at", table_name="staff_audit_events")
    op.drop_table("staff_audit_events")
    op.drop_index("ix_staff_scope_assignments_scope", table_name="staff_scope_assignments")
    op.drop_table("staff_scope_assignments")

    op.drop_constraint(
        op.f("ck_listing_status_history_actor_role_valid"),
        "listing_status_history",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_listing_status_history_actor_role_valid"),
        "listing_status_history",
        "actor_role IN ('owner', 'admin')",
    )
    op.drop_constraint(op.f("ck_user_roles_role_valid"), "user_roles", type_="check")
    op.create_check_constraint(op.f("ck_user_roles_role_valid"), "user_roles", "role IN ('admin')")
