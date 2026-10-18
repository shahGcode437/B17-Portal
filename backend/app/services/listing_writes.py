"""Listing writes: create, edit / resubmit, archive (Phase 12D; docs/backend/API_CONTRACT.md §10).

The service owns the transaction (``BACKEND_ARCHITECTURE.md`` §5.1): everything one operation
touches — the base row, subtype, Food profile and menu, categories, the history row and the
``search_document`` — commits together or not at all. Repositories only query / ``add`` / flush.

How an edit is decided (``API_CONTRACT.md`` §10.3, ``LOCATION_MAP.md`` §7.4):

1. ownership first — a non-owner and a missing listing are the same ``404``;
2. ``archived`` is terminal (``invalid_state_transition``), then a stale ``revision`` is
   ``listing_conflict`` — both checked against the row **locked** ``FOR UPDATE`` and again by the
   guarded ``UPDATE … WHERE revision = :expected``, so a lost update is impossible;
3. the request becomes a complete NEW state (PATCH: stored state + the request) and is compared with
   the stored one after normalisation: *no change*, a *pure visibility narrowing*, or a *material*
   edit (``listing_state.classify_change`` — the one place that decides it);
4. effects: no-op writes nothing (and an unedited ``rejected`` listing cannot be resubmitted);
   a narrowing bumps ``revision`` and refreshes the search document but keeps the status and writes
   no history; a material edit returns the listing to ``pending`` (``submitted_at`` reset,
   ``resubmitted`` history row, quota re-checked for a ``rejected`` one).

Lock order (frozen): ``professional_profiles`` row -> ``listings`` row. An edit takes the profile
lock only when the quota applies (the listing is ``rejected``); if that is only discovered after the
listing row was locked, the attempt is rolled back and repeated profile-first, so the order is never
inverted.
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.core.rate_limit import LISTING_CREATE, RateLimiter
from app.db.session import transaction
from app.models import (
    BusinessProfile,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    ListingStatusHistory,
    PropertyProfile,
    TutorProfile,
)
from app.models.enums import (
    MAX_FOOD_CATEGORIES,
    ActorRole,
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    HistoryAction,
    ListingKind,
    ListingStatus,
    PlanCode,
)
from app.repositories.owner_listings import OwnerListingRepository, ProfessionalProfileRepository
from app.repositories.taxonomy import CategoryRepository
from app.schemas.write import ListingCreate, ListingPatch
from app.services.entitlements import max_active_listings
from app.services.listing_state import (
    Change,
    FoodState,
    ListingState,
    LocationState,
    MenuItemState,
    apply_patch,
    canonical_service_options,
    classify_change,
    problem,
    state_from_create,
    validate_state,
)
from app.services.search_index import SearchIndexer


class ListingInvariantError(RuntimeError):
    """A write produced a stored structure the rules forbid; the transaction is rolled back."""


class _NeedsProfileLock(Exception):
    """Internal: the quota applies but the profile was not locked first (lock order)."""


def validation_error(problems: list[ErrorDetail]) -> AppError:
    return AppError(ErrorCode.VALIDATION_ERROR, status_code=422, details=problems)


def not_found() -> AppError:
    return AppError(ErrorCode.NOT_FOUND, status_code=404)


def parse_listing_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise not_found() from None  # a malformed id cannot exist: same answer as an unknown one


def _stale_revision(current: int) -> AppError:
    return AppError(
        ErrorCode.LISTING_CONFLICT,
        status_code=409,
        details=[
            problem(
                "revision",
                "stale_revision",
                f"This listing changed since you opened it; the current revision is {current}.",
            )
        ],
    )


def _invalid_transition() -> AppError:
    return AppError(ErrorCode.INVALID_STATE_TRANSITION, status_code=409)


# ------------------------------------------------------------------------------ state <-> ORM


def module_for(state: ListingState) -> CategoryModule:
    """The taxonomy module the listing's categories must belong to."""
    if state.kind is ListingKind.PROVIDER:
        return CategoryModule.SERVICES
    if state.kind is ListingKind.TUTOR:
        return CategoryModule.EDUCATION
    if state.kind is ListingKind.PROPERTY:
        return CategoryModule.PROPERTY
    return (
        CategoryModule.FOOD if state.vertical is BusinessVertical.FOOD else CategoryModule.DIRECTORY
    )


def state_of(listing: Listing) -> ListingState:
    """The stored listing as a normalised state (the owner loader must have loaded everything)."""
    slugs = tuple(link.category.slug for link in listing.categories)
    location = LocationState(
        visibility=listing.location_visibility,
        block=listing.block,
        address=listing.address,
        landmark=listing.landmark,
        latitude=listing.latitude,
        longitude=listing.longitude,
    )
    common: dict[str, Any] = {
        "title": listing.title,
        "description": listing.description,
        "area": listing.area,
        "tags": tuple(listing.tags),
        "image": listing.image_url,
        "location": location,
    }
    if listing.kind is ListingKind.BUSINESS:
        business = listing.business
        assert business is not None
        if business.vertical is BusinessVertical.FOOD and business.food is not None:
            food = business.food
            return ListingState(
                kind=ListingKind.BUSINESS,
                vertical=BusinessVertical.FOOD,
                food=FoodState(
                    categories=slugs,
                    service_options=canonical_service_options(
                        [FoodServiceOption(value) for value in food.service_options]
                    ),
                    hours_note=food.hours_note,
                    menu_image=food.menu_image_url,
                    menu=tuple(
                        MenuItemState(item.name, item.section, item.description, item.price_text)
                        for item in food.menu_items
                    ),
                ),
                **common,
            )
        return ListingState(
            kind=ListingKind.BUSINESS,
            vertical=business.vertical,
            category=slugs[0] if slugs else None,
            **common,
        )
    category = slugs[0] if slugs else None
    if listing.kind is ListingKind.TUTOR:
        tutor = listing.tutor_profile
        assert tutor is not None
        return ListingState(kind=listing.kind, category=category, grade=tutor.grade, **common)
    if listing.kind is ListingKind.PROPERTY:
        prop = listing.property_profile
        assert prop is not None
        return ListingState(
            kind=listing.kind,
            category=category,
            listing_type=prop.listing_type,
            price=prop.price_text,
            bedrooms=prop.bedrooms,
            furnished=prop.furnished,
            **common,
        )
    return ListingState(kind=listing.kind, category=category, **common)


def _base_values(state: ListingState) -> dict[str, Any]:
    """The ``listings`` columns a state defines (everything but status / revision / timestamps)."""
    location = state.location
    return {
        "title": state.title,
        "description": state.description,
        "area": state.area,
        "tags": list(state.tags),
        "image_url": state.image,
        "block": location.block,
        "address": location.address,
        "landmark": location.landmark,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "location_visibility": location.visibility,
    }


def _menu_rows(menu: tuple[MenuItemState, ...]) -> list[dict[str, Any]]:
    return [
        {
            "name": item.name,
            "section": item.section,
            "description": item.description,
            "price_text": item.price,
        }
        for item in menu
    ]


def _category_field(state: ListingState) -> str:
    if state.kind is ListingKind.PROPERTY:
        return "propertyType"
    return "food.categories" if state.vertical is BusinessVertical.FOOD else "category"


def category_structure_problems(
    state: ListingState, stored: list[tuple[int, CategoryModule]]
) -> list[str]:
    """The cross-row category rules PostgreSQL cannot express, for ANY kind, on the stored rows:
    Food 1..3 / every other kind exactly 1; positions exactly 1..n (a primary exists); the right
    module."""
    problems: list[str] = []
    count = len(stored)
    is_food = state.vertical is BusinessVertical.FOOD
    if is_food and not 1 <= count <= MAX_FOOD_CATEGORIES:
        problems.append(f"a Food listing needs 1 to {MAX_FOOD_CATEGORIES} categories, has {count}")
    if not is_food and count != 1:
        problems.append(f"a {state.kind.value} listing needs exactly 1 category, has {count}")
    if [position for position, _ in stored] != list(range(1, count + 1)):
        problems.append("category positions must be exactly 1..n so that a primary exists")
    expected = module_for(state)
    if any(module is not expected for _, module in stored):
        problems.append(f"every category must belong to the {expected.value!r} module")
    return problems


# ------------------------------------------------------------------------------ the service


class ListingWriteService:
    def __init__(
        self,
        session: Session,
        *,
        localities: list[str],
        clock: Clock,
        limiter: RateLimiter,
    ) -> None:
        self._session = session
        self._localities = localities
        self._clock = clock
        self._limiter = limiter
        self._listings = OwnerListingRepository(session)
        self._profiles = ProfessionalProfileRepository(session)
        self._categories = CategoryRepository(session)
        self._search_index = SearchIndexer(session)

    # -- create ----------------------------------------------------------------------------------

    def create(self, owner_id: uuid.UUID, payload: ListingCreate) -> Listing:
        """A new ``pending`` listing owned by ``owner_id`` (the session's user — never the body)."""
        decision = self._limiter.blocked(str(owner_id), LISTING_CREATE)
        if not decision.allowed:
            raise AppError(
                ErrorCode.RATE_LIMITED,
                status_code=429,
                headers={"Retry-After": str(decision.retry_after_seconds)},
            )
        state, problems = state_from_create(payload, self._localities)
        assert state is not None
        location_reported = any(item.field.startswith("location") for item in problems)
        problems.extend(validate_state(state, check_location=not location_reported))
        if problems:
            raise validation_error(problems)

        with transaction(self._session):
            plan = self._profiles.lock(owner_id)  # lock order: profile first
            if plan is None:
                raise AppError(ErrorCode.PROFESSIONAL_PROFILE_REQUIRED, status_code=403)
            self._check_quota(owner_id, plan)
            category_ids, category_problems = self._resolve_categories(state, retained=set())
            if category_problems:
                raise validation_error(category_problems)
            listing = self._listings.add(self._new_listing(owner_id, state, category_ids))
            self._verify_category_structure(listing.id, state)
            self._search_index.refresh(listing)
        self._limiter.hit(str(owner_id), LISTING_CREATE)
        return self._reload(listing.id, owner_id)

    def _new_listing(
        self, owner_id: uuid.UUID, state: ListingState, category_ids: list[uuid.UUID]
    ) -> Listing:
        listing = Listing(
            kind=state.kind,
            owner_id=owner_id,
            status=ListingStatus.PENDING,
            revision=1,
            submitted_at=self._clock(),
            **_base_values(state),
        )
        if state.kind is ListingKind.BUSINESS:
            assert state.vertical is not None
            listing.business = BusinessProfile(vertical=state.vertical)
            if state.vertical is BusinessVertical.FOOD and state.food is not None:
                listing.business.food = FoodProfile(
                    service_options=list(state.food.service_options),
                    hours_note=state.food.hours_note,
                    menu_image_url=state.food.menu_image,
                    menu_items=[
                        FoodMenuItem(
                            position=position,
                            name=item.name,
                            section=item.section,
                            description=item.description,
                            price_text=item.price,
                        )
                        for position, item in enumerate(state.food.menu, start=1)
                    ],
                )
        elif state.kind is ListingKind.TUTOR:
            assert state.grade is not None
            listing.tutor_profile = TutorProfile(grade=state.grade)
        elif state.kind is ListingKind.PROPERTY:
            assert state.listing_type is not None and state.price is not None
            listing.property_profile = PropertyProfile(
                listing_type=state.listing_type,
                price_text=state.price,
                bedrooms=state.bedrooms,
                furnished=state.furnished,
            )
        listing.categories = [
            ListingCategory(position=position, category_id=category_id)
            for position, category_id in enumerate(category_ids, start=1)
        ]
        listing.status_history.append(
            ListingStatusHistory(
                from_status=None,
                to_status=ListingStatus.PENDING,
                action=HistoryAction.SUBMITTED,
                revision=1,
                actor_user_id=owner_id,
                actor_role=ActorRole.OWNER,
            )
        )
        return listing

    # -- edit / resubmit -------------------------------------------------------------------------

    def edit(self, owner_id: uuid.UUID, raw_id: str, patch: ListingPatch) -> Listing:
        listing_id = parse_listing_id(raw_id)
        try:
            return self._edit(owner_id, listing_id, patch, lock_profile=False)
        except _NeedsProfileLock:
            return self._edit(owner_id, listing_id, patch, lock_profile=True)

    def _edit(
        self, owner_id: uuid.UUID, listing_id: uuid.UUID, patch: ListingPatch, *, lock_profile: bool
    ) -> Listing:
        with transaction(self._session):
            plan = self._profiles.lock(owner_id) if lock_profile else None
            if lock_profile and plan is None:
                raise AppError(ErrorCode.PROFESSIONAL_PROFILE_REQUIRED, status_code=403)
            listing = self._listings.get_owned(listing_id, owner_id, lock=True)
            if listing is None:
                raise not_found()
            if listing.status is ListingStatus.ARCHIVED:
                raise _invalid_transition()
            if listing.revision != patch.revision:
                raise _stale_revision(listing.revision)

            old = state_of(listing)
            new, problems = apply_patch(old, patch, self._localities)
            if problems:
                raise validation_error(problems)
            change = classify_change(old, new)

            if change is Change.NONE:
                if listing.status is ListingStatus.REJECTED:
                    raise validation_error(
                        [
                            problem(
                                "request",
                                "no_changes",
                                "Change something before resubmitting this listing.",
                            )
                        ]
                    )
                return listing  # nothing is written: no revision, no timestamp, no history

            new_problems = validate_state(new)
            retained = set(old.category_slugs()) if old.vertical == new.vertical else set()
            category_ids: list[uuid.UUID] | None = None
            if old.category_slugs() != new.category_slugs() or old.vertical != new.vertical:
                category_ids, category_problems = self._resolve_categories(new, retained)
                new_problems.extend(category_problems)
            if new_problems:
                raise validation_error(new_problems)

            previous_status = listing.status
            values = _base_values(new)
            material = change is Change.MATERIAL
            if material:
                if previous_status is ListingStatus.REJECTED:
                    # A rejected listing re-enters the quota (API_CONTRACT §10.9); the profile
                    # must have been locked BEFORE the listing row.
                    if plan is None:
                        raise _NeedsProfileLock
                    self._check_quota(owner_id, plan, excluding=listing.id)
                values["status"] = ListingStatus.PENDING
                values["submitted_at"] = self._clock()

            if not self._listings.guarded_update(listing.id, owner_id, patch.revision, values):
                raise _stale_revision(listing.revision)  # defensive: the row lock prevents this
            self._write_children(listing.id, old, new, category_ids)
            new_revision = patch.revision + 1
            if material:
                self._listings.record_history(
                    ListingStatusHistory(
                        listing_id=listing.id,
                        from_status=previous_status,
                        to_status=ListingStatus.PENDING,
                        action=HistoryAction.RESUBMITTED,
                        revision=new_revision,
                        actor_user_id=owner_id,
                        actor_role=ActorRole.OWNER,
                    )
                )
            self._listings.expire_all()
            self._verify_category_structure(listing.id, new)
            reloaded = self._reload(listing.id, owner_id)
            self._search_index.refresh(reloaded)
        return self._reload(listing_id, owner_id)

    def _write_children(
        self,
        listing_id: uuid.UUID,
        old: ListingState,
        new: ListingState,
        category_ids: list[uuid.UUID] | None,
    ) -> None:
        repo = self._listings
        if category_ids is not None:
            repo.replace_categories(listing_id, category_ids)
        if new.kind is ListingKind.PROPERTY:
            repo.update_property(
                listing_id,
                listing_type=new.listing_type,
                price_text=new.price,
                bedrooms=new.bedrooms,
                furnished=new.furnished,
            )
        elif new.kind is ListingKind.TUTOR and new.grade is not None:
            repo.update_tutor(listing_id, new.grade)
        elif new.kind is ListingKind.BUSINESS:
            self._write_business(listing_id, old, new)

    def _write_business(self, listing_id: uuid.UUID, old: ListingState, new: ListingState) -> None:
        repo = self._listings
        assert new.vertical is not None
        if old.vertical is not new.vertical:
            if new.vertical is BusinessVertical.GENERAL:
                # Food -> General: the Food profile, its menu and Food categories go away together.
                repo.delete_food(listing_id)
                repo.set_vertical(listing_id, BusinessVertical.GENERAL)
                return
            repo.set_vertical(listing_id, BusinessVertical.FOOD)
            assert new.food is not None
            repo.insert_food(
                listing_id,
                service_options=new.food.service_options,
                hours_note=new.food.hours_note,
                menu_image_url=new.food.menu_image,
            )
            repo.replace_menu(listing_id, _menu_rows(new.food.menu))
            return
        if new.vertical is BusinessVertical.FOOD and new.food is not None:
            repo.update_food(
                listing_id,
                service_options=new.food.service_options,
                hours_note=new.food.hours_note,
                menu_image_url=new.food.menu_image,
            )
            if old.food is None or old.food.menu != new.food.menu:
                repo.replace_menu(listing_id, _menu_rows(new.food.menu))

    # -- archive ---------------------------------------------------------------------------------

    def archive(self, owner_id: uuid.UUID, raw_id: str, revision: int) -> Listing:
        listing_id = parse_listing_id(raw_id)
        with transaction(self._session):
            listing = self._listings.get_owned(listing_id, owner_id, lock=True)
            if listing is None:
                raise not_found()
            if listing.status is ListingStatus.ARCHIVED:
                raise _invalid_transition()
            if listing.revision != revision:
                raise _stale_revision(listing.revision)
            previous_status = listing.status
            if not self._listings.guarded_update(
                listing.id, owner_id, revision, {"status": ListingStatus.ARCHIVED}
            ):
                raise _stale_revision(listing.revision)  # defensive
            self._listings.record_history(
                ListingStatusHistory(
                    listing_id=listing.id,
                    from_status=previous_status,
                    to_status=ListingStatus.ARCHIVED,
                    action=HistoryAction.ARCHIVED,
                    revision=revision + 1,
                    actor_user_id=owner_id,
                    actor_role=ActorRole.OWNER,
                )
            )
            self._listings.expire_all()
        return self._reload(listing_id, owner_id)

    # -- shared ----------------------------------------------------------------------------------

    def _reload(self, listing_id: uuid.UUID, owner_id: uuid.UUID) -> Listing:
        listing = self._listings.get_owned(listing_id, owner_id)
        if listing is None:  # pragma: no cover - the row was just written by this transaction
            raise not_found()
        return listing

    def _check_quota(
        self, owner_id: uuid.UUID, plan: PlanCode, excluding: uuid.UUID | None = None
    ) -> None:
        limit = max_active_listings(plan)
        if (
            limit is not None
            and self._listings.count_active(owner_id, excluding=excluding) >= limit
        ):
            raise AppError(ErrorCode.PLAN_LIMIT_REACHED, status_code=403)

    def _resolve_categories(
        self, state: ListingState, retained: set[str]
    ) -> tuple[list[uuid.UUID], list[ErrorDetail]]:
        """Slugs -> category ids, in order. A slug must exist in the listing's module and be
        active — except one the listing already carries (deactivating a category never breaks the
        listings in it, DATA_MODEL §8)."""
        module = module_for(state)
        slugs = state.category_slugs()
        field = _category_field(state)
        found = self._categories.list_by_slugs(module, slugs) if slugs else {}
        ids: list[uuid.UUID] = []
        problems: list[ErrorDetail] = []
        for slug in slugs:
            category = found.get(slug)
            if category is None or (not category.is_active and slug not in retained):
                problems.append(problem(field, "unknown_category", f"Unknown category '{slug}'."))
            else:
                ids.append(category.id)
        return ids, problems

    def _verify_category_structure(self, listing_id: uuid.UUID, state: ListingState) -> None:
        """Read the stored category rows back, INSIDE the transaction, and enforce the cross-row
        rules; a violation rolls the whole write back (``ListingCreationService`` does the same)."""
        problems = category_structure_problems(state, self._categories.list_for_listing(listing_id))
        if problems:
            raise ListingInvariantError("; ".join(problems))
