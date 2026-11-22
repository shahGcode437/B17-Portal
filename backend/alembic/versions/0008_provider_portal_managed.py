"""portal-managed Providers: a Provider listing has no personal owner

RBAC-D (docs/backend/AUTH_RBAC.md §27.9 and §31, docs/backend/DATA_MODEL.md §18).

A Service / Professional ("provider") listing is a PORTAL-MANAGED resource, not a personally owned
one. Until now an administrator created a provider through the owner-bound listing endpoint, so the
row carried that administrator as ``owner_id`` and only that account could ever edit it again:
demote or remove the author and the provider was orphaned. RBAC-D moves provider authoring to a
dedicated staff API whose authority is the live staff role / scope (never an owner), and records WHO
authored what in the append-only ``staff_audit_events`` and ``listing_status_history`` instead.

What this migration does, and nothing else:

1. **Backfill.** ``UPDATE listings SET owner_id = NULL WHERE kind = 'provider'`` — every existing
   provider becomes portal-managed. ``owner_id`` is already nullable ("admin-curated / unclaimed
   content", ``DATA_MODEL.md`` §4 / §12), and no other column changes (not
   ``revision``, ``status``, ``submitted_at`` nor ``updated_at``): the content did not change.
   Nothing is deleted and no history is rewritten — the original author stays recorded as the actor
   of the provider's first ``listing_status_history`` row (``submitted``, ``actor_role = 'owner'``),
   which is the only place the old ownership was ever written down. No staff audit row is invented
   for the past: there was no staff audit then.
2. **Invariant.** ``ck_listings_provider_has_no_owner``: ``kind <> 'provider' OR owner_id IS NULL``.
   A provider can never be personally owned again, whatever code path writes the row. It is
   deliberately ONE-directional: ``owner_id IS NULL`` stays legal for every other kind, because
   admin-curated / unclaimed content (seed data, ``DATA_MODEL.md`` §4 / §12; databases loaded by
   earlier fixture versions hold such rows) is a documented state that nothing can reconstruct an
   owner for. The ownership, quota and dashboard rules of Business, Food, Tutor and Property
   listings are untouched, and every write path still sets the owner from the session.

``downgrade`` REFUSES while any live (non-archived) provider exists, using the repository's
destructive-downgrade convention (see ``0007``). Dropping the constraint rewrites no row, but that
is not what makes a downgrade safe: the backfill cannot be undone — the previous owners are gone
and are NOT guessed or assigned to an arbitrary administrator — and the pre-RBAC-D release can only
edit or archive an OWNED listing. After a downgrade every live provider would stay public and
moderatable but could never be edited or archived by anyone. The way to roll the APPLICATION back
without losing the Services section is NOT to downgrade: the RBAC-C code runs against a ``0008``
database (providers are unmanageable until RBAC-D is redeployed, nothing is lost). The refusal
changes nothing; archive the providers deliberately first if a downgrade is really wanted. An empty
development / CI database, or one whose providers are all archived, downgrades cleanly, and
re-upgrading is idempotent: the backfill clears any provider given an owner meanwhile before the
constraint is added again.

Revision ID: 0008
Revises: 0007
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_listings_provider_has_no_owner"


def upgrade() -> None:
    # The backfill MUST come first: the constraint is validated against every existing row.
    op.execute(
        "UPDATE listings SET owner_id = NULL WHERE kind = 'provider' AND owner_id IS NOT NULL"
    )
    op.create_check_constraint(
        op.f(CONSTRAINT), "listings", "kind <> 'provider' OR owner_id IS NULL"
    )


def downgrade() -> None:
    live = int(
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM listings WHERE kind = 'provider' AND status <> 'archived'"
            )
        )
        .scalar_one()
    )
    if live:
        raise RuntimeError(
            f"Refusing to downgrade 0008: {live} live Service / Professional listing(s) exist. "
            "Upgrade 0008 made every provider portal-managed (owner_id NULL); the previous owners "
            "cannot be reconstructed (and are never guessed), and the pre-RBAC-D release can only "
            "edit or archive an OWNED listing, so after a downgrade these providers would stay "
            "public and moderatable but could never be edited or archived. Nothing was changed. "
            "Roll the application back WITHOUT downgrading (the RBAC-C code runs against a 0008 "
            "database), or archive the providers deliberately first."
        )
    op.drop_constraint(op.f(CONSTRAINT), "listings", type_="check")
