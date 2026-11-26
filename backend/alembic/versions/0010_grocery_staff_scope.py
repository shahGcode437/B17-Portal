"""grocery staff scope: allow an explicit ``grocery`` staff assignment

GROCERY-1a (docs/backend/AUTH_RBAC.md §32, docs/backend/DATA_MODEL.md §20) — **DDL only**.

It replaces ONE check constraint, ``ck_staff_scope_assignments_scope_valid``, so that
``staff_scope_assignments.scope`` also accepts ``grocery``. Every other rule of the table stays: the
primary key, the composite foreign key to the ``moderator`` role and the ``role`` check.

What this migration deliberately does NOT do:

* **No data statement of any kind** — no INSERT, UPDATE or DELETE. **Nobody receives ``grocery``**,
  existing Moderators included; it is only ever granted explicitly through staff management.
* **No listing taxonomy change**: no ``grocery`` module, no category and no listing kind (the
  ``categories.module`` check is untouched). The pre-existing ``grocery`` slug of the *directory*
  module is an ordinary business category and is unrelated.
* No change to ``staff_audit_events``: its vocabularies do not enumerate scopes.

``downgrade`` REFUSES (loudly, nothing is changed) while any ``grocery`` assignment exists: removing
it here would silently take staff authority away with no audit record. Remove the assignments first
through staff management (replace scopes, pause or remove), which audits the change and revokes
sessions. Audit history that MENTIONS ``grocery`` never blocks a downgrade and is kept unchanged.

**Rolling back the application too:** code older than this revision cannot read a ``grocery`` row
(the column maps to a closed enum, so loading it raises). Remove the assignments while the new code
is still running, then downgrade, then roll back the code (docs/backend/DEPLOYMENT.md §14). This
downgrade can enforce the first step; it cannot stop a rollback of the code alone.

Revision ID: 0010
Revises: 0009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "staff_scope_assignments"
CONSTRAINT = "ck_staff_scope_assignments_scope_valid"
# Repeated here on purpose (a migration must not import application code that may change later).
PREVIOUS_SCOPES = "'services', 'directory', 'food', 'education', 'property', 'news'"
SCOPES = f"{PREVIOUS_SCOPES}, 'grocery'"


def _replace_scope_check(scopes: str) -> None:
    # PostgreSQL validates a re-added CHECK against every existing row, inside this transaction.
    op.drop_constraint(op.f(CONSTRAINT), TABLE, type_="check")
    op.create_check_constraint(op.f(CONSTRAINT), TABLE, f"scope IN ({scopes})")


def upgrade() -> None:
    _replace_scope_check(SCOPES)


def downgrade() -> None:
    bind = op.get_bind()
    # Lock first, so no assignment can appear between the count and the narrower constraint.
    bind.execute(sa.text(f"LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE"))
    held = int(
        bind.execute(sa.text(f"SELECT count(*) FROM {TABLE} WHERE scope = 'grocery'")).scalar_one()
    )
    if held:
        raise RuntimeError(
            f"Refusing to downgrade 0010: {held} grocery staff scope assignment(s) exist. Nothing "
            "was changed. While the application that knows the grocery scope is still running, "
            "remove them through staff management (replace the scopes, or pause or remove the "
            "Moderator), then downgrade, and only then roll back the application code. Audit "
            "history is kept."
        )
    _replace_scope_check(PREVIOUS_SCOPES)
