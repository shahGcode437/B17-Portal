"""The pure rules of admin taxonomy writes (Phase 12E; docs/backend/API_CONTRACT.md §10.7).

Frozen rules implemented here, with no database:

* a category lives in a code-defined ``module`` that never changes; the ``slug`` is immutable
  (slugs are URLs and filter values) and derived from the name when omitted;
* ``name`` 2-60 characters, unique per ``(module, parent)`` **case-insensitively**;
* ``parentId`` is in the same module, never the category itself, never a cycle, and the hierarchy is
  at most TWO levels deep (a parent must be a root; a category with children cannot get a parent);
* reorder renumbers the WHOLE sibling group ``1..n`` in the order given.

Rename is the only change that alters listing search documents (the category *name* is part of
them); :func:`search_impact` says whether a patch needs the reindex.
"""

import re
import unicodedata
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from app.core.errors import ErrorDetail
from app.models.enums import CategoryModule

MIN_NAME_LENGTH = 2
MAX_NAME_LENGTH = 60
MAX_SLUG_LENGTH = 60
MAX_DISPLAY_ORDER = 100_000
#: At most two levels: a root and its children.
MAX_DEPTH = 2

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


@dataclass(frozen=True)
class CategoryState:
    """What the rules need to know about one stored category."""

    id: uuid.UUID
    module: CategoryModule
    parent_id: uuid.UUID | None
    name: str
    slug: str
    is_active: bool
    display_order: int


def problem(field: str, code: str, message: str) -> ErrorDetail:
    return ErrorDetail(field=field, code=code, message=message)


def normalize_name(name: str) -> str:
    """Trim and collapse inner whitespace (``"  Fast   Food "`` -> ``"Fast Food"``)."""
    return " ".join(name.split())


def name_key(name: str) -> str:
    """The case-insensitive identity of a name within its sibling group."""
    return normalize_name(name).casefold()


def slugify(name: str) -> str:
    """``"Biryani / Rice"`` -> ``"biryani-rice"``. ASCII letters and digits only; may be empty."""
    ascii_text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")[:MAX_SLUG_LENGTH].strip("-")


def slug_problem(slug: str) -> ErrorDetail | None:
    if not 2 <= len(slug) <= MAX_SLUG_LENGTH or not SLUG_PATTERN.match(slug):
        return problem(
            "slug",
            "invalid_format",
            "Use 2-60 lowercase letters, digits and single hyphens (e.g. 'fast-food').",
        )
    return None


def derive_slug(name: str) -> tuple[str, ErrorDetail | None]:
    """The slug an omitted ``slug`` becomes, or the problem if the name has no usable letters."""
    slug = slugify(name)
    issue = slug_problem(slug)
    if issue is not None:
        return slug, problem(
            "slug", "required", "This name has no usable letters; provide a slug of your own."
        )
    return slug, None


def parent_problems(
    *,
    module: CategoryModule,
    category_id: uuid.UUID | None,
    parent: CategoryState | None,
    parent_id: uuid.UUID | None,
    own_child_count: int,
    ancestors_of_parent: Sequence[uuid.UUID] = (),
) -> list[ErrorDetail]:
    """Validate a (new) parent: it exists, same module, is not the category itself, creates no cycle
    and keeps the hierarchy within two levels. ``parent_id is None`` (a root) is always valid."""
    if parent_id is None:
        return []
    if category_id is not None and parent_id == category_id:
        return [problem("parentId", "invalid_parent", "A category cannot be its own parent.")]
    if parent is None:
        return [problem("parentId", "unknown_parent", "That parent category does not exist.")]
    if parent.module is not module:
        return [problem("parentId", "invalid_parent", "A parent must be in the same module.")]
    if category_id is not None and category_id in ancestors_of_parent:
        return [problem("parentId", "invalid_parent", "That would create a cycle.")]
    if parent.parent_id is not None:
        return [
            problem(
                "parentId",
                "invalid_parent",
                f"Categories are at most {MAX_DEPTH} levels deep: choose a top-level parent.",
            )
        ]
    if own_child_count > 0:
        return [
            problem(
                "parentId",
                "invalid_parent",
                "A category that has sub-categories must stay top-level.",
            )
        ]
    return []


def duplicate_name_problem(name: str, sibling_names: Sequence[str]) -> ErrorDetail | None:
    if name_key(name) in {name_key(other) for other in sibling_names}:
        return problem("name", "duplicate", "A category with this name already exists here.")
    return None


def search_impact(old_name: str, new_name: str) -> bool:
    """Does changing the name change any listing's ``search_document``? (Only the name is in it;
    ``isActive``, ``parentId`` and ``displayOrder`` never are.)"""
    return normalize_name(old_name) != normalize_name(new_name)


def reorder_problems(
    sibling_ids: Sequence[uuid.UUID], ordered_ids: Sequence[uuid.UUID]
) -> list[ErrorDetail]:
    """``ordered_ids`` must be exactly the sibling group: no duplicate, stranger or omission."""
    problems: list[ErrorDetail] = []
    seen: set[uuid.UUID] = set()
    for index, category_id in enumerate(ordered_ids):
        if category_id in seen:
            problems.append(problem(f"orderedIds.{index}", "duplicate", "Each category only once."))
        seen.add(category_id)
    known = set(sibling_ids)
    for index, category_id in enumerate(ordered_ids):
        if category_id not in known:
            problems.append(
                problem(
                    f"orderedIds.{index}",
                    "unknown_category",
                    "Not a category of this module and parent.",
                )
            )
    missing = known - seen
    if missing:
        problems.append(
            problem(
                "orderedIds",
                "incomplete",
                f"List every category of the group ({len(missing)} missing); reload and retry.",
            )
        )
    return problems


def renumber(ordered_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Deterministic ``displayOrder``: ``1..n`` in the order given."""
    return {category_id: position for position, category_id in enumerate(ordered_ids, start=1)}
