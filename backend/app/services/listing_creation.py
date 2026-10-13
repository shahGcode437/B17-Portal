"""Creating a business listing: the Phase 10C proof of the transaction/ownership architecture.

This is NOT the listing write API (Phase 12 owns that: quota, authorization, edit/resubmit,
moderation). It exists to prove, against real PostgreSQL, the architecture rule that **a service
owns the transaction** and the division of labor between database and service:

* the DATABASE guarantees row-local integrity and uniqueness, plus the composite foreign keys;
* this SERVICE enforces what needs a cross-row or type-specific view — a Food business must have a
  Food profile, a General business must not; **Food has 1..3 categories, every other listing
  exactly one** (the generic ``listing_categories`` table imposes no maximum); positions are
  contiguous from 1 so a primary exists; the categories belong to the right *module* and are
  active; at least one service option; tags are normalized — and writes the listing, its subtype,
  categories, menu items and the initial history row in ONE transaction. If any statement fails,
  nothing is persisted.

Category rules are checked twice on purpose: friendly, field-addressed validation errors BEFORE
anything is written, and a post-write check that reads the stored rows back INSIDE the transaction
(``verify_category_structure``). The second is the real guarantee: if the structure the database
actually holds ever violates a rule, the whole transaction rolls back.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.db.session import transaction
from app.models import (
    BusinessProfile,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    ListingStatusHistory,
)
from app.models.enums import (
    MAX_FOOD_CATEGORIES,
    MAX_FOOD_MENU_ITEMS,
    ActorRole,
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    HistoryAction,
    ListingKind,
    ListingStatus,
)
from app.repositories.listings import ListingRepository
from app.repositories.taxonomy import CategoryRepository


@dataclass(frozen=True)
class MenuItemInput:
    name: str
    section: str | None = None
    description: str | None = None
    price_text: str | None = None


@dataclass(frozen=True)
class FoodInput:
    #: 1..3 Food category slugs (a Food-only rule); the first is the primary category.
    category_slugs: Sequence[str]
    service_options: Sequence[FoodServiceOption]
    hours_note: str | None = None
    menu_items: Sequence[MenuItemInput] = ()
    menu_image_url: str | None = None


@dataclass(frozen=True)
class BusinessListingInput:
    owner_id: uuid.UUID
    title: str
    area: str
    description: str | None = None
    tags: Sequence[str] = ()
    image_url: str | None = None
    #: General business: exactly one Directory category slug (and no ``food``).
    category_slug: str | None = None
    #: Food business: present for Food & Dining, absent for a General business.
    food: FoodInput | None = None


class ListingInvariantError(RuntimeError):
    """The stored listing violates a service-level invariant; the transaction is rolled back.

    Unlike ``AppError`` this is not a client mistake (those are rejected before anything is
    written) — it means a code path produced a structure the rules forbid.
    """


def category_structure_problems(
    vertical: BusinessVertical, categories: Sequence[tuple[int, CategoryModule]]
) -> list[str]:
    """What is wrong with a business listing's stored ``(position, module)`` category rows.

    The cross-row rules PostgreSQL cannot express (see ``ListingCategory``):

    * Food: 1..3 categories, all in the ``food`` module; General: exactly one, in ``directory``;
    * positions are exactly 1..n, so position 1 (the primary category) exists.
    """
    problems: list[str] = []
    count = len(categories)
    is_food = vertical is BusinessVertical.FOOD
    expected_module = CategoryModule.FOOD if is_food else CategoryModule.DIRECTORY
    if is_food and not 1 <= count <= MAX_FOOD_CATEGORIES:
        problems.append(f"a Food listing needs 1 to {MAX_FOOD_CATEGORIES} categories, has {count}")
    if not is_food and count != 1:
        problems.append(f"a General business needs exactly 1 category, has {count}")
    if [position for position, _ in categories] != list(range(1, count + 1)):
        problems.append(
            "category positions must be exactly 1..n so that a primary (position 1) exists"
        )
    if any(module is not expected_module for _, module in categories):
        problems.append(f"every category must belong to the {expected_module.value!r} module")
    return problems


def normalize_tags(tags: Sequence[str]) -> list[str]:
    """Trim, lower-case, drop blanks/duplicates, keep first-seen order (frontend ``parseTags``)."""
    seen: dict[str, None] = {}
    for tag in tags:
        cleaned = tag.strip().lower()
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


class ListingCreationService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._listings = ListingRepository(session)
        self._categories = CategoryRepository(session)

    def create_business_listing(self, data: BusinessListingInput) -> Listing:
        """Create a pending business listing (General or Food & Dining) atomically."""
        with transaction(self._session):
            listing = self._build(data)
            self._listings.add(listing)
            self.verify_category_structure(listing)
        return listing

    def verify_category_structure(self, listing: Listing) -> None:
        """Post-write check, inside the transaction: read the stored rows back and enforce the
        cross-row category rules. Raises ``ListingInvariantError``, rolling everything back."""
        assert listing.business is not None
        problems = category_structure_problems(
            listing.business.vertical, self._categories.list_for_listing(listing.id)
        )
        if problems:
            raise ListingInvariantError("; ".join(problems))

    # -- building (validates the rules the database cannot express) ---------------------------

    def _build(self, data: BusinessListingInput) -> Listing:
        is_food = data.food is not None
        problems: list[ErrorDetail] = []

        if is_food and data.category_slug is not None:
            problems.append(
                _problem("categorySlug", "not_allowed", "A Food business has no typed category.")
            )
        if not is_food and data.category_slug is None:
            problems.append(_problem("categorySlug", "required", "Choose a category."))

        categories: list[ListingCategory] = []
        if data.food is not None:
            categories = self._food_categories(data.food, problems)
            _validate_food(data.food, problems)
        elif data.category_slug is not None:
            categories = self._directory_category(data.category_slug, problems)

        if problems:
            raise AppError(ErrorCode.VALIDATION_ERROR, status_code=422, details=problems)

        listing = Listing(
            kind=ListingKind.BUSINESS,
            owner_id=data.owner_id,
            status=ListingStatus.PENDING,
            title=data.title,
            description=data.description,
            area=data.area,
            tags=normalize_tags(data.tags),
            image_url=data.image_url,
            revision=1,
        )
        listing.business = BusinessProfile(
            vertical=BusinessVertical.FOOD if is_food else BusinessVertical.GENERAL
        )
        if data.food is not None:
            listing.business.food = FoodProfile(
                service_options=_canonical_options(data.food.service_options),
                hours_note=data.food.hours_note,
                menu_image_url=data.food.menu_image_url,
                menu_items=[
                    FoodMenuItem(
                        position=position,
                        name=item.name,
                        section=item.section,
                        description=item.description,
                        price_text=item.price_text,
                    )
                    for position, item in enumerate(data.food.menu_items, start=1)
                ],
            )
        listing.categories = categories
        # Creation is part of the audit trail: NULL -> pending, revision 1, by the owner.
        listing.status_history.append(
            ListingStatusHistory(
                from_status=None,
                to_status=ListingStatus.PENDING,
                action=HistoryAction.SUBMITTED,
                revision=1,
                actor_user_id=data.owner_id,
                actor_role=ActorRole.OWNER,
            )
        )
        return listing

    def _food_categories(
        self, food: FoodInput, problems: list[ErrorDetail]
    ) -> list[ListingCategory]:
        slugs = list(food.category_slugs)
        if not 1 <= len(slugs) <= MAX_FOOD_CATEGORIES:
            problems.append(
                _problem(
                    "food.categories", "count", f"Choose 1 to {MAX_FOOD_CATEGORIES} categories."
                )
            )
        if len(set(slugs)) != len(slugs):
            problems.append(_problem("food.categories", "duplicate", "Each category only once."))
        return self._resolve(CategoryModule.FOOD, slugs, "food.categories", problems)

    def _directory_category(self, slug: str, problems: list[ErrorDetail]) -> list[ListingCategory]:
        return self._resolve(CategoryModule.DIRECTORY, [slug], "categorySlug", problems)

    def _resolve(
        self, module: CategoryModule, slugs: list[str], field: str, problems: list[ErrorDetail]
    ) -> list[ListingCategory]:
        found = self._categories.list_by_slugs(module, slugs)
        result: list[ListingCategory] = []
        for position, slug in enumerate(slugs, start=1):
            category = found.get(slug)
            if category is None or not category.is_active:
                problems.append(_problem(field, "unknown_category", f"Unknown category '{slug}'."))
            else:
                result.append(ListingCategory(position=position, category_id=category.id))
        return result


def _validate_food(food: FoodInput, problems: list[ErrorDetail]) -> None:
    if not food.service_options:
        problems.append(_problem("food.serviceOptions", "required", "Choose a service option."))
    if len(food.menu_items) > MAX_FOOD_MENU_ITEMS:
        problems.append(
            _problem("food.menuHighlights", "too_many", f"At most {MAX_FOOD_MENU_ITEMS} items.")
        )


def _canonical_options(options: Sequence[FoodServiceOption]) -> list[str]:
    """Service options as a de-duplicated set in canonical (enum) order, whatever the input."""
    chosen = set(options)
    return [option.value for option in FoodServiceOption if option in chosen]


def _problem(field: str, code: str, message: str) -> ErrorDetail:
    return ErrorDetail(field=field, code=code, message=message)
