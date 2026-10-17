"""shared listing location: block, address, landmark, point, visibility, generated public point

Phase 12B (docs/backend/LOCATION_MAP.md §3, §3.1) — **additive and DDL-only**.

* ``listings``: ``block``, ``address``, ``landmark``, ``latitude``/``longitude`` (``numeric(9,6)``),
  ``location_visibility`` (``VARCHAR`` + ``CHECK``; default ``'area_only'``) and the stored
  GENERATED columns ``public_latitude`` / ``public_longitude`` (``exact`` -> the point,
  ``approximate`` -> ``round(x, 2)``, ``area_only`` -> NULL).
* Constraints are row-local only: valid visibility, coordinates both-or-neither, latitude
  ``-90..90`` / longitude ``-180..180``, ``area_only`` <=> no stored point, non-blank text.

What this migration deliberately does NOT do:

* **No data statement of any kind** — no UPDATE, no INSERT, no backfill. Existing rows become the
  documented *legacy state* by construction: ``location_visibility = 'area_only'`` (the column
  default), every other location column NULL, ``area`` / ``status`` / ``search_document`` /
  ``updated_at`` untouched. No coordinate is guessed and no ``area`` text is parsed.
* **No "a Property needs a point" CHECK.** Legacy Property rows have none; per-kind requiredness
  belongs to the write service (Phase 12D). A validated rule may be added by a later migration once
  no legacy row remains (LOCATION_MAP.md §3.1).
* No B-17 geofence (only universal coordinate ranges), no PostGIS, no new index.

Adding the generated columns rewrites ``listings`` once (``ACCESS EXCLUSIVE``); acceptable at this
table's size and run in the normal migration window.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Repeated here on purpose (a migration must not import application code that may change later).
PUBLIC_LATITUDE_SQL = (
    "CASE location_visibility WHEN 'exact'::text THEN latitude "
    "WHEN 'approximate'::text THEN round(latitude, 2) ELSE NULL::numeric END"
)
PUBLIC_LONGITUDE_SQL = (
    "CASE location_visibility WHEN 'exact'::text THEN longitude "
    "WHEN 'approximate'::text THEN round(longitude, 2) ELSE NULL::numeric END"
)

CHECKS: tuple[tuple[str, str], ...] = (
    (
        "ck_listings_location_visibility_valid",
        "location_visibility IN ('exact', 'approximate', 'area_only')",
    ),
    ("ck_listings_coordinates_pair", "(latitude IS NULL) = (longitude IS NULL)"),
    ("ck_listings_latitude_range", "latitude IS NULL OR latitude BETWEEN -90 AND 90"),
    ("ck_listings_longitude_range", "longitude IS NULL OR longitude BETWEEN -180 AND 180"),
    (
        "ck_listings_visibility_matches_point",
        "(location_visibility = 'area_only') = (latitude IS NULL)",
    ),
    ("ck_listings_block_not_blank", "block IS NULL OR char_length(btrim(block)) > 0"),
    ("ck_listings_address_not_blank", "address IS NULL OR char_length(btrim(address)) > 0"),
    ("ck_listings_landmark_not_blank", "landmark IS NULL OR char_length(btrim(landmark)) > 0"),
)


def upgrade() -> None:
    op.add_column("listings", sa.Column("block", sa.String(length=40), nullable=True))
    op.add_column("listings", sa.Column("address", sa.String(length=200), nullable=True))
    op.add_column("listings", sa.Column("landmark", sa.String(length=100), nullable=True))
    op.add_column("listings", sa.Column("latitude", sa.Numeric(9, 6), nullable=True))
    op.add_column("listings", sa.Column("longitude", sa.Numeric(9, 6), nullable=True))
    op.add_column(
        "listings",
        sa.Column(
            "location_visibility",
            sa.Enum(
                "exact",
                "approximate",
                "area_only",
                name="locationvisibility",
                native_enum=False,
                length=32,
            ),
            server_default="area_only",
            nullable=False,
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "public_latitude",
            sa.Numeric(9, 6),
            sa.Computed(PUBLIC_LATITUDE_SQL, persisted=True),
            nullable=True,
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "public_longitude",
            sa.Numeric(9, 6),
            sa.Computed(PUBLIC_LONGITUDE_SQL, persisted=True),
            nullable=True,
        ),
    )
    for name, condition in CHECKS:
        op.create_check_constraint(op.f(name), "listings", condition)


def downgrade() -> None:
    for name, _ in reversed(CHECKS):
        op.drop_constraint(op.f(name), "listings", type_="check")
    for column in (
        "public_longitude",
        "public_latitude",
        "location_visibility",
        "longitude",
        "latitude",
        "landmark",
        "address",
        "block",
    ):
        op.drop_column("listings", column)
