"""Admin taxonomy writes: create, patch, reorder, list (Phase 12E; API_CONTRACT.md §10.7).

Every write is ONE transaction that starts by taking the taxonomy lock EXCLUSIVE
(``CategoryRepository.lock_taxonomy_exclusive``). Listing writers that may link a category hold the
same lock SHARED for their transaction, so:

* a rename + reindex never interleaves with a listing write that read the old name — the rename
  waits for in-flight writes to commit (their documents are then rebuilt by the reindex), and writes
  that start later read the new name;
* name uniqueness (``(module, parent)``, case-insensitive — no database constraint exists for it)
  and sibling reordering are serialised without a schema change;
* the lock order is identical everywhere: taxonomy lock first, then category rows (by id), then the
  listing rows the reindex touches — and no listing writer takes a category or taxonomy lock after a
  listing lock, so there is no inversion.

A rename refreshes ``search_document`` for exactly the listings in that category (batched,
set-based) inside the same transaction; ``isActive`` / ``parentId`` / ``displayOrder`` never
touch documents.
Modules are code-defined and ``slug`` is immutable, so neither can change; there is no delete.
"""

import uuid
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.db.session import transaction
from app.models import Category
from app.models.enums import CategoryModule
from app.repositories.taxonomy import CategoryRepository
from app.schemas.admin import CategoryCreate, CategoryPatch, CategoryReorder
from app.services.listing_writes import not_found, validation_error
from app.services.search_index import SearchIndexer
from app.services.taxonomy_rules import (
    CategoryState,
    derive_slug,
    duplicate_name_problem,
    normalize_name,
    parent_problems,
    problem,
    renumber,
    reorder_problems,
    search_impact,
    slug_problem,
)


def _state(category: Category) -> CategoryState:
    return CategoryState(
        id=category.id,
        module=category.module,
        parent_id=category.parent_id,
        name=category.name,
        slug=category.slug,
        is_active=category.is_active,
        display_order=category.display_order,
    )


def _conflict(field: str, message: str) -> AppError:
    return AppError(
        ErrorCode.CONFLICT,
        status_code=409,
        details=[ErrorDetail(field=field, code="duplicate", message=message)],
    )


class TaxonomyAdminService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._categories = CategoryRepository(session)
        self._search_index = SearchIndexer(session)

    # -- reads ---------------------------------------------------------------------------------

    def list_all(self, module: CategoryModule | None) -> list[Category]:
        return self._categories.list_all(module)

    # -- create --------------------------------------------------------------------------------

    def create(self, data: CategoryCreate) -> Category:
        try:
            with transaction(self._session):
                self._categories.lock_taxonomy_exclusive()
                return self._create(data)
        except IntegrityError as error:
            raise self._integrity(error) from None

    def _create(self, data: CategoryCreate) -> Category:
        name = normalize_name(data.name)
        problems: list[ErrorDetail] = []

        if data.slug is not None:
            slug = data.slug
            issue = slug_problem(slug)
            if issue is not None:
                problems.append(issue)
        else:
            slug, issue = derive_slug(name)
            if issue is not None:
                problems.append(issue)

        parent = self._categories.get(data.parent_id) if data.parent_id else None
        problems.extend(
            parent_problems(
                module=data.module,
                category_id=None,
                parent=_state(parent) if parent else None,
                parent_id=data.parent_id,
                own_child_count=0,
            )
        )
        if problems:
            raise validation_error(problems)
        siblings = self._categories.siblings(data.module, data.parent_id)
        duplicate = duplicate_name_problem(name, [sibling.name for sibling in siblings])
        if duplicate is not None:
            raise _conflict("name", duplicate.message)
        if self._categories.get_by_slug(data.module, slug) is not None:
            raise _conflict("slug", "A category with this slug already exists in this module.")

        order = (
            data.display_order
            if data.display_order is not None
            else self._categories.max_display_order(data.module, data.parent_id) + 1
        )
        return self._categories.add(
            Category(
                module=data.module,
                parent_id=data.parent_id,
                name=name,
                slug=slug,
                is_active=True,
                display_order=order,
            )
        )

    # -- patch ---------------------------------------------------------------------------------

    def patch(self, raw_id: str, patch: CategoryPatch) -> Category:
        try:
            category_id = uuid.UUID(raw_id)
        except ValueError:
            raise not_found() from None
        try:
            with transaction(self._session):
                self._categories.lock_taxonomy_exclusive()
                return self._patch(category_id, patch)
        except IntegrityError as error:
            raise self._integrity(error) from None

    def _patch(self, category_id: uuid.UUID, patch: CategoryPatch) -> Category:
        category = self._categories.get(category_id, lock=True)
        if category is None:
            raise not_found()
        provided = patch.model_fields_set
        problems: list[ErrorDetail] = []
        for name, alias in (
            ("name", "name"),
            ("is_active", "isActive"),
            ("display_order", "displayOrder"),
        ):
            if name in provided and getattr(patch, name) is None:
                problems.append(problem(alias, "not_nullable", "This field cannot be cleared."))
        if problems:
            raise validation_error(problems)

        new_name = (
            normalize_name(patch.name) if "name" in provided and patch.name else category.name
        )
        new_parent = patch.parent_id if "parent_id" in provided else category.parent_id
        new_active = (
            patch.is_active
            if "is_active" in provided and patch.is_active is not None
            else category.is_active
        )
        new_order = (
            patch.display_order
            if "display_order" in provided and patch.display_order is not None
            else category.display_order
        )

        if new_parent != category.parent_id:
            parent = self._categories.get(new_parent) if new_parent else None
            problems.extend(
                parent_problems(
                    module=category.module,
                    category_id=category.id,
                    parent=_state(parent) if parent else None,
                    parent_id=new_parent,
                    own_child_count=self._categories.child_count(category.id),
                    ancestors_of_parent=(parent.parent_id,) if parent and parent.parent_id else (),
                )
            )
        if problems:
            raise validation_error(problems)
        if new_name != category.name or new_parent != category.parent_id:
            others = [
                sibling.name
                for sibling in self._categories.siblings(category.module, new_parent)
                if sibling.id != category.id
            ]
            duplicate = duplicate_name_problem(new_name, others)
            if duplicate is not None:
                raise _conflict("name", duplicate.message)

        changes: dict[str, Any] = {}
        if new_name != category.name:
            changes["name"] = new_name
        if new_parent != category.parent_id:
            changes["parent_id"] = new_parent
        if new_active != category.is_active:
            changes["is_active"] = new_active
        if new_order != category.display_order:
            changes["display_order"] = new_order
        if not changes:
            return category  # a no-op writes nothing (no updated_at, no reindex)

        renamed = "name" in changes and search_impact(category.name, new_name)
        for field, value in changes.items():
            setattr(category, field, value)
        self._categories.flush()
        if renamed:
            self._search_index.reindex_category(category.id)
        return category

    # -- reorder -------------------------------------------------------------------------------

    def reorder(self, data: CategoryReorder) -> list[Category]:
        with transaction(self._session):
            self._categories.lock_taxonomy_exclusive()
            if data.parent_id is not None:
                parent = self._categories.get(data.parent_id)
                if parent is None or parent.module is not data.module:
                    raise validation_error(
                        [problem("parentId", "unknown_parent", "No such parent in this module.")]
                    )
            siblings = self._categories.siblings(data.module, data.parent_id, lock=True)
            issues = reorder_problems([c.id for c in siblings], data.ordered_ids)
            if issues:
                raise validation_error(issues)
            numbers = renumber(data.ordered_ids)
            for sibling in siblings:
                if sibling.display_order != numbers[sibling.id]:
                    sibling.display_order = numbers[sibling.id]
            self._categories.flush()
        by_id = {sibling.id: sibling for sibling in siblings}
        return [by_id[category_id] for category_id in data.ordered_ids]

    # -- shared --------------------------------------------------------------------------------

    def _integrity(self, error: IntegrityError) -> AppError:
        """The database backstop of the checks above, as a stable API error — never a raw 500."""
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_categories_module_slug":
            return _conflict("slug", "A category with this slug already exists in this module.")
        return AppError(ErrorCode.CONFLICT, status_code=409)
