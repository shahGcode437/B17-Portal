"""search foundation

Phase 10D: the PostgreSQL search schema deferred from Phase 10C.

* ``pg_trgm`` — trigram operator classes, so ``LIKE '%q%'`` can use an index.
* ``listings.search_document`` — lower-cased public text (application-maintained; see
  ``app.services.search_document``). Existing rows get ``''`` and must be indexed once with
  ``python -m app.db.search_index rebuild`` after this migration (a release step, like seeding).
* ``ix_listings_search_document_trgm`` — GIN trigram index serving substring search.
* ``ix_listings_approved_area`` — partial B-tree for the public ``area`` filter.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.add_column(
        "listings",
        sa.Column("search_document", sa.Text(), server_default=sa.text("''"), nullable=False),
    )
    op.create_index(
        "ix_listings_search_document_trgm",
        "listings",
        ["search_document"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"search_document": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_listings_approved_area",
        "listings",
        ["area"],
        unique=False,
        postgresql_where=sa.text("status = 'approved'"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_listings_approved_area",
        table_name="listings",
        postgresql_where=sa.text("status = 'approved'"),
    )
    op.drop_index(
        "ix_listings_search_document_trgm",
        table_name="listings",
        postgresql_using="gin",
        postgresql_ops={"search_document": "gin_trgm_ops"},
    )
    op.drop_column("listings", "search_document")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
