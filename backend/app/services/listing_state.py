"""The pure rules of a listing write: complete state, normalisation, validation, change class.

No database, no HTTP, no session. A write is modelled as ``old state -> new state``:

* :func:`state_from_create` / :func:`apply_patch` build the NEW state from a request (PATCH starts
  from the stored state, so omitted fields stay exactly as stored);
* :func:`validate_state` checks the COMPLETE resulting state (per-kind completeness, Food rules,
  location requiredness — ``LOCATION_MAP.md`` §6, media references);
* :func:`classify_change` decides what the edit means for moderation — nothing, a *pure
  visibility narrowing* (``LOCATION_MAP.md`` §7.4) or an ordinary (material) edit
  (``API_CONTRACT.md`` §10.3).

Equality of two normalised states IS the definition of "no effective change": whitespace-only and
case-only differences that normalise to the stored value are no-ops. There is deliberately no
"non-material field" list (frozen: the only copy of the content is the live one, so every effective
change goes back to moderation) — the single exception is the narrowing below.

Everything database-shaped (does this category exist, is it active, in the right module) is the
service's job; this module only knows slugs.
"""

from dataclasses import dataclass, replace
from decimal import ROUND_HALF_EVEN, Decimal
from enum import StrEnum
from typing import Any
from urllib.parse import urlsplit

from app.core.errors import ErrorDetail
from app.models.enums import (
    MAX_FOOD_CATEGORIES,
    MAX_FOOD_MENU_ITEMS,
    BusinessVertical,
    FoodServiceOption,
    Furnishing,
    ListingKind,
    LocationVisibility,
    PropertyListingType,
)
from app.schemas.write import (
    ListingCreate,
    ListingPatch,
    LocationInput,
    MenuItemInput,
)

_SIX_PLACES = Decimal("0.000001")
_NARROWINGS = frozenset(
    {
        (LocationVisibility.EXACT, LocationVisibility.APPROXIMATE),
        (LocationVisibility.EXACT, LocationVisibility.AREA_ONLY),
        (LocationVisibility.APPROXIMATE, LocationVisibility.AREA_ONLY),
    }
)
_BLOCK_EXTRA = frozenset(" -/.")


# ------------------------------------------------------------------------------ state


@dataclass(frozen=True)
class MenuItemState:
    name: str
    section: str | None = None
    description: str | None = None
    price: str | None = None


@dataclass(frozen=True)
class FoodState:
    #: ``food``-module slugs in order; the first is the primary category.
    categories: tuple[str, ...] = ()
    #: A set in canonical (enum) order, so ordering differences are not changes.
    service_options: tuple[str, ...] = ()
    hours_note: str | None = None
    menu_image: str | None = None
    menu: tuple[MenuItemState, ...] = ()


@dataclass(frozen=True)
class LocationState:
    visibility: LocationVisibility
    block: str | None = None
    address: str | None = None
    landmark: str | None = None
    latitude: Decimal | None = None
    longitude: Decimal | None = None


@dataclass(frozen=True)
class ListingState:
    """Every moderated value of a listing. Frozen, so ``==`` means "nothing changed"."""

    kind: ListingKind
    title: str
    description: str | None
    area: str
    tags: tuple[str, ...]
    image: str | None
    location: LocationState
    #: The single category slug of a provider / General business / tutor / property (its type).
    #: ``None`` for a Food business, whose categories live in ``food``.
    category: str | None = None
    vertical: BusinessVertical | None = None
    food: FoodState | None = None
    listing_type: PropertyListingType | None = None
    price: str | None = None
    bedrooms: int | None = None
    furnished: Furnishing | None = None
    grade: str | None = None

    def category_slugs(self) -> tuple[str, ...]:
        """The ordered category slugs this state would store (position 1 is the primary)."""
        if self.food is not None and self.vertical is BusinessVertical.FOOD:
            return self.food.categories
        return (self.category,) if self.category else ()


class Change(StrEnum):
    NONE = "none"
    NARROWING = "narrowing"
    MATERIAL = "material"


# ------------------------------------------------------------------------------ normalisation


def problem(field: str, code: str, message: str) -> ErrorDetail:
    return ErrorDetail(field=field, code=code, message=message)


def clean_text(value: str | None) -> str | None:
    """Trim; blank means absent (the database rejects blank text)."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def normalize_tags(tags: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    """Trim, lower-case, drop blanks and repeats, keep first-seen order."""
    seen: dict[str, None] = {}
    for tag in tags:
        cleaned = tag.strip().lower()
        if cleaned:
            seen.setdefault(cleaned, None)
    return tuple(seen)


def canonical_service_options(options: list[FoodServiceOption]) -> tuple[str, ...]:
    chosen = set(options)
    return tuple(option.value for option in FoodServiceOption if option in chosen)


def canonical_locality(area: str, localities: list[str]) -> str | None:
    """The configured spelling of ``area`` (trimmed, whitespace-collapsed, case-insensitive)."""
    wanted = " ".join(area.split()).casefold()
    for locality in localities:
        if locality.casefold() == wanted:
            return locality
    return None


def quantize_coordinate(value: float) -> Decimal:
    """A JSON number as the stored ``numeric(9,6)`` value: rounded half-even to 6 places."""
    return Decimal(repr(float(value))).quantize(_SIX_PLACES, rounding=ROUND_HALF_EVEN)


def is_valid_media_reference(value: str) -> bool:
    """A public ``https://`` URL or a site-relative asset path (API_CONTRACT §10.1). ``blob:``,
    ``data:``, ``http:``, ``javascript:`` and anything with whitespace or control characters are
    refused; there is no upload yet, so nothing else can be a real reference."""
    if not value or not value.isprintable() or any(c.isspace() for c in value):
        return False
    if value.startswith("/"):
        return not value.startswith("//") and "\\" not in value and ".." not in value.split("/")
    parts = urlsplit(value)
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and "@" not in parts.netloc
        and "\\" not in value
    )


def _valid_block(value: str) -> bool:
    return all(c.isalnum() or c in _BLOCK_EXTRA for c in value) and value[:1].isalnum()


# ------------------------------------------------------------------------------ requests -> state


def _menu_state(items: list[MenuItemInput]) -> tuple[MenuItemState, ...]:
    return tuple(
        MenuItemState(
            name=item.name.strip(),
            section=clean_text(item.section),
            description=clean_text(item.description),
            price=clean_text(item.price),
        )
        for item in items
    )


def location_state(
    kind: ListingKind, data: LocationInput | None, field: str = "location"
) -> tuple[LocationState | None, list[ErrorDetail]]:
    """Normalise a location block. A missing block (or visibility) takes the kind's default —
    ``area_only`` for provider / tutor — and is otherwise a ``required`` error (LOCATION_MAP §6)."""
    problems: list[ErrorDetail] = []
    default = (
        LocationVisibility.AREA_ONLY if kind in (ListingKind.PROVIDER, ListingKind.TUTOR) else None
    )
    if data is None:
        if default is None:
            problems.append(
                problem(field, "required", "Choose how this listing's location is shown.")
            )
            return None, problems
        return LocationState(visibility=default), problems

    visibility = data.visibility or default
    if visibility is None:
        problems.append(
            problem(f"{field}.visibility", "required", "Choose how this location is shown.")
        )
        return None, problems

    latitude = quantize_coordinate(data.latitude) if data.latitude is not None else None
    longitude = quantize_coordinate(data.longitude) if data.longitude is not None else None
    return (
        LocationState(
            visibility=visibility,
            block=clean_text(data.block),
            address=clean_text(data.address),
            landmark=clean_text(data.landmark),
            latitude=latitude,
            longitude=longitude,
        ),
        problems,
    )


def state_from_create(
    payload: ListingCreate, localities: list[str]
) -> tuple[ListingState | None, list[ErrorDetail]]:
    """The state a ``POST /listings`` body asks for (not yet validated as a whole)."""
    problems: list[ErrorDetail] = []
    area = canonical_locality(payload.area, localities)
    if area is None:
        problems.append(_unknown_locality(localities))
        area = payload.area.strip()
    location, location_problems = location_state(ListingKind(payload.kind), payload.location)
    problems.extend(location_problems)
    if location is None:
        location = LocationState(visibility=LocationVisibility.AREA_ONLY)  # placeholder; invalid

    common: dict[str, Any] = {
        "description": clean_text(payload.description),
        "area": area,
        "tags": normalize_tags(payload.tags),
        "image": clean_text(payload.image),
        "location": location,
    }
    if payload.kind == "provider":
        state = ListingState(
            kind=ListingKind.PROVIDER,
            title=payload.name.strip(),
            category=payload.category,
            **common,
        )
    elif payload.kind == "business":
        food = None
        if payload.food is not None:
            food = FoodState(
                categories=tuple(payload.food.categories),
                service_options=canonical_service_options(payload.food.service_options),
                hours_note=clean_text(payload.food.hours_note),
                menu_image=clean_text(payload.food.menu_image),
                menu=_menu_state(payload.food.menu_highlights),
            )
        state = ListingState(
            kind=ListingKind.BUSINESS,
            title=payload.name.strip(),
            vertical=payload.vertical,
            category=payload.category,
            food=food,
            **common,
        )
    elif payload.kind == "tutor":
        state = ListingState(
            kind=ListingKind.TUTOR,
            title=payload.name.strip(),
            category=payload.category,
            grade=payload.grade.strip(),
            **common,
        )
    else:
        state = ListingState(
            kind=ListingKind.PROPERTY,
            title=payload.title.strip(),
            category=payload.property_type,
            listing_type=payload.listing_type,
            price=payload.price.strip(),
            bedrooms=payload.bedrooms,
            furnished=payload.furnished,
            **common,
        )
    return state, problems


def _unknown_locality(localities: list[str]) -> ErrorDetail:
    return problem("area", "unknown_locality", f"Choose one of: {', '.join(localities)}.")


#: Which PATCH fields each kind accepts (the camelCase names are derived from the schema).
_COMMON_PATCH = frozenset({"description", "area", "tags", "image", "location"})
_PATCHABLE: dict[ListingKind, frozenset[str]] = {
    ListingKind.PROVIDER: _COMMON_PATCH | {"name", "category"},
    ListingKind.BUSINESS: _COMMON_PATCH | {"name", "category", "vertical", "food"},
    ListingKind.TUTOR: _COMMON_PATCH | {"name", "category", "grade"},
    ListingKind.PROPERTY: _COMMON_PATCH
    | {"title", "listing_type", "property_type", "price", "bedrooms", "furnished"},
}
#: Fields an explicit ``null`` may clear. Everything else answers ``not_nullable``.
_CLEARABLE = frozenset({"image", "bedrooms", "furnished"})


def _alias(name: str) -> str:
    return ListingPatch.model_fields[name].alias or name


def apply_patch(
    current: ListingState, patch: ListingPatch, localities: list[str]
) -> tuple[ListingState, list[ErrorDetail]]:
    """The state ``current`` becomes under ``patch`` (omitted = unchanged, ``null`` = clear only
    where declared clearable, arrays and the location block replace whole)."""
    problems: list[ErrorDetail] = []
    provided = set(patch.model_fields_set) - {"revision"}
    allowed = _PATCHABLE[current.kind]

    for name in sorted(provided - allowed):
        problems.append(
            problem(
                _alias(name), "not_allowed", f"A {current.kind.value} listing has no such field."
            )
        )
    effective = provided & allowed
    for name in sorted(effective - _CLEARABLE):
        if getattr(patch, name) is None:
            problems.append(problem(_alias(name), "not_nullable", "This field cannot be cleared."))
    usable = {name for name in effective if getattr(patch, name) is not None or name in _CLEARABLE}

    state = current
    if "name" in usable or "title" in usable:
        raw = patch.name if "name" in usable else patch.title
        state = replace(state, title=(raw or "").strip())
    if "description" in usable and patch.description is not None:
        state = replace(state, description=clean_text(patch.description))
    if "area" in usable and patch.area is not None:
        canonical = canonical_locality(patch.area, localities)
        if canonical is None:
            problems.append(_unknown_locality(localities))
        else:
            state = replace(state, area=canonical)
    if "tags" in usable and patch.tags is not None:
        state = replace(state, tags=normalize_tags(patch.tags))
    if "image" in usable:
        state = replace(state, image=clean_text(patch.image))
    if "location" in usable:
        location, location_problems = location_state(current.kind, patch.location)
        problems.extend(location_problems)
        if location is not None:
            state = replace(state, location=location)
    if "grade" in usable and patch.grade is not None:
        state = replace(state, grade=patch.grade.strip())
    if "listing_type" in usable:
        state = replace(state, listing_type=patch.listing_type)
    if "price" in usable and patch.price is not None:
        state = replace(state, price=patch.price.strip())
    if "bedrooms" in usable:
        state = replace(state, bedrooms=patch.bedrooms)
    if "furnished" in usable:
        state = replace(state, furnished=patch.furnished)
    if "property_type" in usable and patch.property_type is not None:
        state = replace(state, category=patch.property_type)

    if current.kind is ListingKind.BUSINESS:
        state, business_problems = _apply_business_patch(state, patch, usable)
        problems.extend(business_problems)
    elif "category" in usable and patch.category is not None:
        state = replace(state, category=patch.category)
    return state, problems


def _apply_business_patch(
    state: ListingState, patch: ListingPatch, usable: set[str]
) -> tuple[ListingState, list[ErrorDetail]]:
    problems: list[ErrorDetail] = []
    vertical = patch.vertical if "vertical" in usable and patch.vertical else state.vertical
    is_food = vertical is BusinessVertical.FOOD

    if "category" in usable and is_food:
        problems.append(
            problem("category", "not_allowed", "A Food business has no typed category.")
        )
    if "food" in usable and not is_food:
        problems.append(
            problem("food", "not_allowed", "Only a Food business has Food & Dining data.")
        )

    category = state.category
    food = state.food
    if vertical is not state.vertical:
        # Switching vertical: the other side's data goes away (DATA_MODEL §5); the new side starts
        # empty.
        category = None
        food = FoodState() if is_food else None
    if "category" in usable and patch.category is not None and not is_food:
        category = patch.category
    if is_food and "food" in usable and patch.food is not None:
        food = _apply_food_patch(food or FoodState(), patch, problems)
    return replace(
        state, vertical=vertical, category=None if is_food else category, food=food
    ), problems


def _apply_food_patch(
    base: FoodState, patch: ListingPatch, problems: list[ErrorDetail]
) -> FoodState:
    assert patch.food is not None
    given = patch.food.model_fields_set
    food = base
    for name in ("categories", "service_options", "menu_highlights"):
        if name in given and getattr(patch.food, name) is None:
            alias = patch.food.__class__.model_fields[name].alias or name
            problems.append(
                problem(f"food.{alias}", "not_nullable", "This field cannot be cleared.")
            )
    if "categories" in given and patch.food.categories is not None:
        food = replace(food, categories=tuple(patch.food.categories))
    if "service_options" in given and patch.food.service_options is not None:
        food = replace(food, service_options=canonical_service_options(patch.food.service_options))
    if "hours_note" in given:
        food = replace(food, hours_note=clean_text(patch.food.hours_note))
    if "menu_highlights" in given and patch.food.menu_highlights is not None:
        food = replace(food, menu=_menu_state(patch.food.menu_highlights))
    if "menu_image" in given:
        food = replace(food, menu_image=clean_text(patch.food.menu_image))
    return food


# ------------------------------------------------------------------------------ validation


def _category_field(state: ListingState) -> str:
    return "propertyType" if state.kind is ListingKind.PROPERTY else "category"


def validate_location(kind: ListingKind, location: LocationState) -> list[ErrorDetail]:
    """LOCATION_MAP.md §4 and §6, on the RESULTING state."""
    problems: list[ErrorDetail] = []
    visibility = location.visibility
    has_point = location.latitude is not None or location.longitude is not None

    if kind is ListingKind.PROPERTY and visibility is LocationVisibility.AREA_ONLY:
        problems.append(
            problem(
                "location.visibility",
                "not_allowed",
                "A property needs a map pin; choose exact or approximate.",
            )
        )
    if location.block is not None and (
        len(location.block) > 40 or not _valid_block(location.block)
    ):
        problems.append(
            problem(
                "location.block",
                "invalid_format",
                "Use letters, numbers, spaces, '-', '/' or '.' (up to 40 characters).",
            )
        )

    if visibility is LocationVisibility.AREA_ONLY:
        if has_point:
            problems.append(
                problem(
                    "location.latitude",
                    "not_allowed",
                    "An area-only listing stores no map pin.",
                )
            )
    else:
        if location.latitude is None:
            problems.append(problem("location.latitude", "required", "Place the pin on the map."))
        if location.longitude is None:
            problems.append(problem("location.longitude", "required", "Place the pin on the map."))
        for name, value, limit in (
            ("latitude", location.latitude, 90),
            ("longitude", location.longitude, 180),
        ):
            if value is not None and not Decimal(-limit) <= value <= Decimal(limit):
                problems.append(
                    problem(
                        f"location.{name}", "out_of_range", f"Use a value from -{limit} to {limit}."
                    )
                )
    if visibility is LocationVisibility.EXACT and location.address is None:
        problems.append(
            problem("location.address", "required", "An exact location needs a street address.")
        )
    return problems


def validate_state(state: ListingState, *, check_location: bool = True) -> list[ErrorDetail]:
    """Completeness and consistency of the whole resulting state (everything not database-shaped).

    ``check_location=False`` is for a request whose location block was itself unusable (already
    reported), so one mistake is not echoed as several."""
    problems: list[ErrorDetail] = []
    if check_location:
        problems.extend(validate_location(state.kind, state.location))
    if state.image is not None and not is_valid_media_reference(state.image):
        problems.append(_bad_media("image"))

    if state.kind is ListingKind.BUSINESS:
        problems.extend(_validate_business(state))
    else:
        if state.category is None:
            problems.append(problem(_category_field(state), "required", "Choose a category."))
        if state.food is not None or state.vertical is not None:
            problems.append(problem("food", "not_allowed", "Only a business has these fields."))
    if state.kind is ListingKind.TUTOR and not state.grade:
        problems.append(problem("grade", "required", "Enter the grade level."))
    if state.kind is ListingKind.PROPERTY:
        if state.listing_type is None:
            problems.append(problem("listingType", "required", "Choose sale or rent."))
        if not state.price:
            problems.append(problem("price", "required", "Enter a price."))
    elif state.listing_type or state.price or state.bedrooms is not None or state.furnished:
        problems.append(problem("price", "not_allowed", "Only a property has these fields."))
    return problems


def _bad_media(field: str) -> ErrorDetail:
    return problem(
        field,
        "invalid_media_reference",
        "Use a public https:// address or a site path; uploads are not available yet.",
    )


def _validate_business(state: ListingState) -> list[ErrorDetail]:
    problems: list[ErrorDetail] = []
    if state.vertical is BusinessVertical.GENERAL or state.vertical is None:
        if state.category is None:
            problems.append(problem("category", "required", "Choose a category."))
        if state.food is not None:
            problems.append(problem("food", "not_allowed", "Only a Food business has this data."))
        return problems

    # Food & Dining (docs/product/FOOD_DINING.md): a vertical of Business, never a kind.
    if state.category is not None:
        problems.append(
            problem("category", "not_allowed", "A Food business has no typed category.")
        )
    food = state.food
    if food is None:
        problems.append(problem("food", "required", "A Food business needs its Food details."))
        return problems
    count = len(food.categories)
    if count == 0:
        problems.append(problem("food.categories", "required", "Choose at least one category."))
    elif count > MAX_FOOD_CATEGORIES:
        problems.append(
            problem(
                "food.categories", "too_many", f"Choose up to {MAX_FOOD_CATEGORIES} categories."
            )
        )
    if len(set(food.categories)) != count:
        problems.append(problem("food.categories", "duplicate", "Each category only once."))
    if not food.service_options:
        problems.append(problem("food.serviceOptions", "required", "Choose a service option."))
    if len(food.menu) > MAX_FOOD_MENU_ITEMS:
        problems.append(
            problem("food.menuHighlights", "too_many", f"At most {MAX_FOOD_MENU_ITEMS} items.")
        )
    if food.menu_image is not None and not is_valid_media_reference(food.menu_image):
        problems.append(_bad_media("food.menuImage"))
    return problems


# ------------------------------------------------------------------------------ change class


def is_pure_narrowing(old: ListingState, new: ListingState) -> bool:
    """LOCATION_MAP.md §7.4: exactly one of the three narrowings, EVERYTHING else moderated equal,
    and no consequence beyond the technical clearing of the point for ``area_only``."""
    transition = (old.location.visibility, new.location.visibility)
    if transition not in _NARROWINGS:
        return False
    before, after = old.location, new.location
    if (before.block, before.address, before.landmark) != (
        after.block,
        after.address,
        after.landmark,
    ):
        return False
    if after.visibility is LocationVisibility.AREA_ONLY:
        if after.latitude is not None or after.longitude is not None:
            return False
    elif (before.latitude, before.longitude) != (after.latitude, after.longitude):
        return False
    # Everything outside the location block must be identical.
    return replace(old, location=_NEUTRAL) == replace(new, location=_NEUTRAL)


_NEUTRAL = LocationState(visibility=LocationVisibility.AREA_ONLY)


def classify_change(old: ListingState, new: ListingState) -> Change:
    if old == new:
        return Change.NONE
    return Change.NARROWING if is_pure_narrowing(old, new) else Change.MATERIAL
