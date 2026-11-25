"""listing contact numbers: a listing's own public phone and optional WhatsApp number

Listing Contact v1 (docs/backend/DATA_MODEL.md §19, API_CONTRACT.md §10.11) — **additive and DDL-only**.

* ``listings``: ``contact_phone`` and ``whatsapp_phone`` (``varchar(20)``, both NULLable), the
  number customers should use for THAT listing. Shared by every kind, like the location block.
* Constraints are row-local only: a stored value must be canonical E.164 (``+`` then 8 to 15
  digits, first digit non-zero) — exactly the one shape ``app.core.phone.normalize_phone``
  produces, so a path that forgot to normalise is refused by the database instead of storing
  "0300 123 4567".

What this migration deliberately does NOT do:

* **No data statement of any kind** — no UPDATE, no INSERT, no backfill. No number is invented,
  parsed out of a description, or copied from anywhere: there is no account-level phone number in
  this schema to copy (``users`` has none), and a listing's contact number is listing data.
  Existing rows become the documented *legacy state* by construction: both columns NULL, every
  other column — ``status``, ``revision``, ``submitted_at``, ``updated_at``, ``search_document`` —
  untouched. Those rows stay valid, readable, moderatable and archivable.
* **No NOT NULL and no "an owner-managed listing has a contact number" CHECK.** Legacy rows have
  none, so a database rule would make them impossible to migrate and would re-check on every
  UPDATE (blocking approve / reject / archive of a legacy row). Per-kind requiredness is a
  WRITE-SERVICE rule (``listing_state._validate_contact``), the same decision the location block
  made for "a Property needs a map pin" (``LOCATION_MAP.md §3.1``). A validated database rule may
  be added by a later migration once no legacy row remains.
* **Nothing about Providers.** A ``provider`` listing is portal-managed (RBAC-D) and its staff
  write API has no contact field, so its columns stay NULL; no constraint is added that would
  prejudge whether the portal gets its own number in a later phase.
* No index: a phone number is never a query key (it is not searchable, and ``search_document``'s
  composition is unchanged, so no reindex is needed).

``ADD COLUMN`` with no default and no stored generation does not rewrite the table.

Revision ID: 0009
Revises: 0008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS: tuple[str, ...] = ("contact_phone", "whatsapp_phone")
#: Canonical E.164 and nothing else; NULL is always allowed (legacy rows, Providers).
CHECKS: tuple[tuple[str, str], ...] = tuple(
    (f"ck_listings_{column}_e164", rf"{column} IS NULL OR {column} ~ '^\+[1-9][0-9]{{7,14}}$'")
    for column in COLUMNS
)


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column("listings", sa.Column(column, sa.String(length=20), nullable=True))
    for name, condition in CHECKS:
        op.create_check_constraint(op.f(name), "listings", condition)


def downgrade() -> None:
    """Drops the two columns, and with them the numbers owners typed.

    This does NOT use the refusing-downgrade convention of ``0007`` / ``0008``: those refuse
    because a downgrade would leave live rows in a state the older release cannot manage (an
    ownerless Provider nobody can edit) or would destroy an append-only audit. Here the older
    release simply has no contact concept: every row stays valid, editable and moderatable without
    these columns, so dropping them is a clean, complete reversal of an additive change — the same
    thing ``0005`` does for the location block. Nothing else is touched.
    """
    for name, _ in reversed(CHECKS):
        op.drop_constraint(op.f(name), "listings", type_="check")
    for column in reversed(COLUMNS):
        op.drop_column("listings", column)
