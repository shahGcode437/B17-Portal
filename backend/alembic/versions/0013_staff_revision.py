"""staff revision: the version a staff-management change was decided on

GROCERY-4A (docs/backend/AUTH_RBAC.md §39) — **additive**. One column; no existing row changes
meaning and no data statement: every account starts at revision 0.

``users.staff_revision`` counts the changes to the account's staff role and scopes. It is on the
ACCOUNT so that it survives removal and re-appointment, and it only grows, so a change decided on
an earlier state is recognised even after the visible state has returned to it (ABA).

Rolling back the application does NOT need the downgrade: older code ignores the column. But
older code does not advance it either, so a staff page left open across a roll-back and
roll-forward may hold a revision that no longer reflects what happened between: reload staff pages
after any such change (docs/backend/DEPLOYMENT.md §19). The downgrade drops the counts.

Revision ID: 0013
Revises: 0012
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("staff_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        op.f("ck_users_staff_revision_non_negative"), "users", "staff_revision >= 0"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_staff_revision_non_negative"), "users", type_="check")
    op.drop_column("users", "staff_revision")
