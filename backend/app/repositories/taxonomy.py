"""Persistence for categories. Queries and ``add``/upsert only — never commits."""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.reference_data import CategorySeed
from app.models import Category, ListingCategory
from app.models.enums import CategoryModule


class CategoryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_slug(self, module: CategoryModule, slug: str) -> Category | None:
        return self._session.scalars(
            select(Category).where(Category.module == module, Category.slug == slug)
        ).one_or_none()

    def list_by_slugs(self, module: CategoryModule, slugs: Sequence[str]) -> dict[str, Category]:
        """Categories of ``module`` with the given slugs, keyed by slug (unknown slugs absent)."""
        rows = self._session.scalars(
            select(Category).where(Category.module == module, Category.slug.in_(slugs))
        )
        return {category.slug: category for category in rows}

    def list_by_module(self, module: CategoryModule, *, active_only: bool = True) -> list[Category]:
        """A module's taxonomy in display order (the query the active-taxonomy index serves)."""
        statement = select(Category).where(Category.module == module)
        if active_only:
            statement = statement.where(Category.is_active.is_(True))
        return list(
            self._session.scalars(statement.order_by(Category.display_order, Category.slug))
        )

    def list_for_listing(self, listing_id: uuid.UUID) -> list[tuple[int, CategoryModule]]:
        """A listing's ``(position, category module)`` pairs as stored, ordered by position."""
        rows = self._session.execute(
            select(ListingCategory.position, Category.module)
            .join(Category, Category.id == ListingCategory.category_id)
            .where(ListingCategory.listing_id == listing_id)
            .order_by(ListingCategory.position)
        ).all()
        return [(int(position), module) for position, module in rows]

    def insert_missing(self, seeds: Sequence[CategorySeed]) -> int:
        """Insert seeds whose ``(module, slug)`` is absent; return how many were inserted.

        ``ON CONFLICT DO NOTHING`` makes it idempotent *and* non-destructive: a row an admin has
        since renamed, reordered or deactivated is never overwritten by a re-run.
        """
        if not seeds:
            return 0
        statement = (
            pg_insert(Category)
            .values(
                [
                    {
                        "id": uuid.uuid4(),
                        "module": seed.module,
                        "slug": seed.slug,
                        "name": seed.name,
                        "display_order": seed.display_order,
                    }
                    for seed in seeds
                ]
            )
            .on_conflict_do_nothing(constraint="uq_categories_module_slug")
            .returning(Category.id)
        )
        return len(self._session.execute(statement).all())
