"""News & Daily Updates: admin-authored content, not a listing (no moderation lifecycle)."""

import uuid
from datetime import date

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import CategoryModule, NewsKind, NewsStatus
from app.models.taxonomy import Category


class NewsArticle(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "news_articles"

    kind: Mapped[NewsKind] = mapped_column(str_enum(NewsKind), nullable=False)
    status: Mapped[NewsStatus] = mapped_column(
        str_enum(NewsStatus), nullable=False, default=NewsStatus.DRAFT, server_default="draft"
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    summary: Mapped[str] = mapped_column(String(400), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: Always ``'news'`` (CHECK); with the composite foreign key it guarantees that a news article
    #: can only be filed under a category of the ``news`` module.
    category_module: Mapped[CategoryModule] = mapped_column(
        str_enum(CategoryModule),
        nullable=False,
        default=CategoryModule.NEWS,
        server_default="news",
    )
    image_url: Mapped[str | None] = mapped_column(Text)
    #: Date-only, as the frontend (`publishedAt: "2026-09-05"`).
    published_at: Mapped[date] = mapped_column(Date, nullable=False)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    category: Mapped[Category] = relationship(viewonly=True)
    #: Authorship survives the author's account being tombstoned/removed.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        in_values("kind", NewsKind, name="kind_valid"),
        in_values("status", NewsStatus, name="status_valid"),
        CheckConstraint("char_length(btrim(title)) > 0", name="title_not_blank"),
        CheckConstraint("char_length(btrim(summary)) > 0", name="summary_not_blank"),
        CheckConstraint("category_module = 'news'", name="category_module_is_news"),
        ForeignKeyConstraint(
            ["category_id", "category_module"],
            ["categories.id", "categories.module"],
            ondelete="RESTRICT",
            name="fk_news_articles_category_id_category_module_categories",
        ),
        Index("ix_news_articles_category_id", "category_id"),
    )


Index("ix_news_articles_status_published_at", NewsArticle.status, NewsArticle.published_at.desc())
