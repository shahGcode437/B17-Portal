"""Persistence for categories. Queries and ``add``/upsert only — never commits."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.reference_data import CategorySeed
from app.models import Category, ListingCategory
from app.models.enums import CategoryModule

#: The one advisory-lock key of the taxonomy (Phase 12E). Listing writers that may LINK a category
#: take it SHARED for their transaction; admin category writes take it EXCLUSIVE. Both come first in
#: their transaction (before any profile, listing or category row lock), so the lock order is the
#: same everywhere and a rename + reindex can never interleave with a listing write that read the
#: old name (BACKEND_ARCHITECTURE.md §5.1).
TAXONOMY_LOCK_KEY = 7_517_001


class CategoryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # -- taxonomy lock (transaction-scoped; released at commit / rollback) ------------------------

    def lock_taxonomy_shared(self) -> None:
        self._session.execute(select(func.pg_advisory_xact_lock_shared(TAXONOMY_LOCK_KEY)))

    def lock_taxonomy_exclusive(self) -> None:
        self._session.execute(select(func.pg_advisory_xact_lock(TAXONOMY_LOCK_KEY)))

    # -- admin reads / writes ----------------------------------------------------------------------

    def get(self, category_id: uuid.UUID, *, lock: bool = False) -> Category | None:
        statement = select(Category).where(Category.id == category_id)
        if lock:
            statement = statement.with_for_update()
        return self._session.scalars(statement).one_or_none()

    def list_all(self, module: CategoryModule | None = None) -> list[Category]:
        """EVERY category, inactive included (admin only): module, roots first, order, slug."""
        statement = select(Category)
        if module is not None:
            statement = statement.where(Category.module == module)
        return list(
            self._session.scalars(
                statement.order_by(
                    Category.module,
                    Category.parent_id.is_not(None),
                    Category.parent_id,
                    Category.display_order,
                    Category.slug,
                )
            )
        )

    def siblings(
        self, module: CategoryModule, parent_id: uuid.UUID | None, *, lock: bool = False
    ) -> list[Category]:
        """Categories of one ``(module, parent)`` group, inactive included. With ``lock`` the rows
        are locked ``FOR UPDATE`` in id order (the frozen lock order for category rows)."""
        statement = select(Category).where(
            Category.module == module,
            Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id,
        )
        if lock:
            return list(self._session.scalars(statement.order_by(Category.id).with_for_update()))
        return list(
            self._session.scalars(statement.order_by(Category.display_order, Category.slug))
        )

    def child_count(self, category_id: uuid.UUID) -> int:
        return int(
            self._session.scalar(
                select(func.count()).select_from(Category).where(Category.parent_id == category_id)
            )
            or 0
        )

    def max_display_order(self, module: CategoryModule, parent_id: uuid.UUID | None) -> int:
        statement = select(func.max(Category.display_order)).where(
            Category.module == module,
            Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id,
        )
        return int(self._session.scalar(statement) or 0)

    def add(self, category: Category) -> Category:
        self._session.add(category)
        self._session.flush()
        return category

    def flush(self) -> None:
        self._session.flush()

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

    def list_public(self, module: CategoryModule | None = None) -> list[Category]:
        """Active categories for public clients, optionally of one module.

        Deterministic: module, then ``display_order``, then slug. Inactive categories are never
        returned here (only a future admin API may list them).
        """
        statement = select(Category).where(Category.is_active.is_(True))
        if module is not None:
            statement = statement.where(Category.module == module)
        return list(
            self._session.scalars(
                statement.order_by(Category.module, Category.display_order, Category.slug)
            )
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
