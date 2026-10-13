"""Dynamic taxonomy: ``categories`` and the normalized ``listing_categories`` relation.

A *category* is the primary classification a user browses by **inside an existing module**
(Services category, Directory category, Food category, Property type, Education subject, News
category). A *module* is a code-defined product area (``CategoryModule``) and is never created by
inserting a row here. See docs/backend/DATA_MODEL.md §8.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import CategoryModule

if TYPE_CHECKING:
    from app.models.listings import Listing


class Category(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "categories"

    module: Mapped[CategoryModule] = mapped_column(str_enum(CategoryModule), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    #: Stable identifier; seeded slugs equal the frontend's current slugs (URLs/filters stay valid).
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    display_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )

    __table_args__ = (
        in_values("module", CategoryModule, name="module_valid"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="parent_not_self"),
        # Slugs are unique *per module* (the same slug may exist in two modules, e.g. a Food
        # "bakeries" and a Directory "bakeries").
        UniqueConstraint("module", "slug", name="uq_categories_module_slug"),
        # Target of the composite foreign keys below and in news_articles, so that a parent (or a
        # news category) can only ever belong to the SAME module — enforced by the database.
        UniqueConstraint("id", "module", name="uq_categories_id_module"),
        ForeignKeyConstraint(
            ["parent_id", "module"],
            ["categories.id", "categories.module"],
            ondelete="RESTRICT",
            name="fk_categories_parent_id_module_categories",
        ),
        Index(
            "ix_categories_module_is_active_display_order", "module", "is_active", "display_order"
        ),
    )


class ListingCategory(Base):
    """A listing's category, in order. **Position 1 is the primary category.**

    This relation is GENERIC — it serves every listing kind — so the database only guarantees what
    is true for all of them: a valid listing and category, no category twice on a listing, no
    position twice on a listing, and ``position >= 1``. It deliberately imposes no maximum: "a Food
    business has 1..3 categories" is a Food rule, and every other kind has exactly one.

    Those per-kind rules need a cross-row, type-specific view, so they are the SERVICE's
    transactional job (``ListingCreationService``): the count (Food 1..3, others exactly 1),
    positions contiguous from 1 so that a primary exists, and the category's module matching the
    listing (Food business -> ``food``, General business -> ``directory``, ...).
    """

    __tablename__ = "listing_categories"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    # RESTRICT: a category in use is deactivated, never deleted.
    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False
    )

    listing: Mapped["Listing"] = relationship(back_populates="categories")
    category: Mapped[Category] = relationship()

    __table_args__ = (
        CheckConstraint("position >= 1", name="position_positive"),
        UniqueConstraint(
            "listing_id", "category_id", name="uq_listing_categories_listing_id_category_id"
        ),
        Index("ix_listing_categories_category_id_listing_id", "category_id", "listing_id"),
    )
