"""Public news reads. Published items only; queries only — no commits."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import NewsArticle
from app.models.enums import NewsKind, NewsStatus


class NewsReadRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_published(
        self, *, kind: NewsKind | None, limit: int, offset: int
    ) -> tuple[int, list[NewsArticle]]:
        """Published items, newest publication date first (then newest created, then id)."""
        condition = [NewsArticle.status == NewsStatus.PUBLISHED]
        if kind is not None:
            condition.append(NewsArticle.kind == kind)
        total = self._session.scalar(
            select(func.count()).select_from(NewsArticle).where(*condition)
        )
        rows = self._session.scalars(
            select(NewsArticle)
            .where(*condition)
            .options(joinedload(NewsArticle.category))
            .order_by(
                NewsArticle.published_at.desc(), NewsArticle.created_at.desc(), NewsArticle.id
            )
            .limit(limit)
            .offset(offset)
        )
        return total or 0, list(rows)

    def get_published(self, article_id: uuid.UUID) -> NewsArticle | None:
        return self._session.scalars(
            select(NewsArticle)
            .where(NewsArticle.id == article_id, NewsArticle.status == NewsStatus.PUBLISHED)
            .options(joinedload(NewsArticle.category))
        ).one_or_none()

    def get_published_many(self, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, NewsArticle]:
        if not ids:
            return {}
        rows = self._session.scalars(
            select(NewsArticle)
            .where(NewsArticle.id.in_(ids), NewsArticle.status == NewsStatus.PUBLISHED)
            .options(joinedload(NewsArticle.category))
        )
        return {article.id: article for article in rows}
