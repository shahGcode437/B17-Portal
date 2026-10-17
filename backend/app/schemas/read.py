"""Public READ schemas (Phase 10D): the shapes clients receive. Explicit, never ORM objects.

Compatible with the frontend's TypeScript domain types (``Provider``, ``Business``, ``Tutor``,
``Property``, ``NewsArticle`` in src/types) — same field names, camelCase on the wire, optional
fields omitted when absent — plus additive normalized data (``categories``). Differences are
deliberate and listed in docs/backend/READ_API_PARITY.md.

Union members are discriminated by ``kind`` so OpenAPI documents (and a generated client can
narrow) each shape. Nothing here carries owner/account data, moderation state or history.
"""

import datetime
import uuid
from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import (
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    Furnishing,
    LocationVisibility,
    NewsKind,
    PropertyListingType,
)
from app.schemas.envelope import ApiModel

# ------------------------------------------------------------------------------ categories


class CategoryRead(ApiModel):
    id: uuid.UUID
    module: CategoryModule
    slug: str
    name: str
    parent_id: uuid.UUID | None = None
    display_order: int


class CategoryRef(ApiModel):
    """A listing's category; the primary one (position 1) is flagged."""

    slug: str
    name: str
    is_primary: bool


# ------------------------------------------------------------------------------ listings


class MenuHighlightRead(ApiModel):
    id: uuid.UUID
    name: str
    section: str | None = None
    description: str | None = None
    #: A display string ("PKR 1,800"); never parsed.
    price: str | None = None


class FoodRead(ApiModel):
    """Food & Dining data of a Business whose vertical is ``food``."""

    categories: list[str]
    service_options: list[FoodServiceOption]
    hours_note: str | None = None
    #: Present on listing detail; omitted from search-result cards.
    menu_highlights: list[MenuHighlightRead] | None = None
    menu_image: str | None = None


class CoordinatesRead(ApiModel):
    """A PUBLIC point. ``exact`` listings expose the stored point; ``approximate`` ones expose only
    the database-generated 2-decimal point. There is no field that could carry the private point."""

    latitude: float
    longitude: float
    precision: Literal["exact", "approximate"]


class LocationRead(ApiModel):
    """What the public may know about where a listing is (docs/backend/LOCATION_MAP.md §7, §8).

    ``area`` stays a top-level field of the listing. ``address`` / ``landmark`` appear only on the
    detail of an ``exact`` listing; ``coordinates`` is omitted for ``area_only`` (and for every
    legacy row). Nothing here is ever the owner's stored (private) point.
    """

    visibility: LocationVisibility
    block: str | None = None
    address: str | None = None
    landmark: str | None = None
    coordinates: CoordinatesRead | None = None


class _ListingBase(ApiModel):
    id: uuid.UUID
    area: str
    location: LocationRead
    image: str | None = None
    tags: list[str]
    categories: list[CategoryRef]


class ProviderRead(_ListingBase):
    kind: Literal["provider"]
    name: str
    #: The primary category's slug (the frontend's ``Provider.category``) and its label.
    category: str
    category_label: str
    description: str | None = None
    featured: bool | None = None


class BusinessRead(_ListingBase):
    kind: Literal["business"]
    name: str
    vertical: BusinessVertical
    #: The PRIMARY category's name — derived, never stored separately (the frontend's rule).
    category: str
    description: str | None = None
    featured: bool | None = None
    #: Present only when ``vertical`` is ``food``.
    food: FoodRead | None = None


class TutorRead(_ListingBase):
    kind: Literal["tutor"]
    name: str
    #: The primary (education) category's name.
    subject: str
    grade: str
    bio: str | None = None


class PropertyRead(_ListingBase):
    kind: Literal["property"]
    title: str
    listing_type: PropertyListingType
    #: The primary (property) category's name, e.g. "House".
    property_type: str
    #: A display string ("PKR 2.2 Cr"), never parsed.
    price: str
    description: str | None = None
    bedrooms: int | None = None
    furnished: Furnishing | None = None


ListingDetail = Annotated[
    ProviderRead | BusinessRead | TutorRead | PropertyRead, Field(discriminator="kind")
]

# ------------------------------------------------------------------------------ news


class NewsRead(ApiModel):
    id: uuid.UUID
    #: ``news`` (editorial) or ``update`` (daily update) — the frontend's ``NewsArticle.kind``.
    kind: NewsKind
    status: Literal["published"]
    title: str
    #: The category's name (frontend ``category``) and its stable slug.
    category: str
    category_slug: str
    summary: str
    image: str | None = None
    published_at: datetime.date
    tags: list[str]


# ------------------------------------------------------------------------------ search


class ProviderHit(ApiModel):
    kind: Literal["provider"]
    item: ProviderRead


class BusinessHit(ApiModel):
    kind: Literal["business"]
    item: BusinessRead


class TutorHit(ApiModel):
    kind: Literal["tutor"]
    item: TutorRead


class PropertyHit(ApiModel):
    kind: Literal["property"]
    item: PropertyRead


class NewsHit(ApiModel):
    kind: Literal["news"]
    item: NewsRead


#: The frontend's ``SearchHit``: ``{kind, item}`` with the per-kind item.
SearchHit = Annotated[
    ProviderHit | BusinessHit | TutorHit | PropertyHit | NewsHit, Field(discriminator="kind")
]


class SuggestionRead(ApiModel):
    """The frontend's flat ``SearchSuggestion``: nothing UI-specific, nothing private."""

    id: str
    label: str
    secondary_label: str
    type: Literal["provider", "business", "tutor", "property", "news"]
    value: str


# ------------------------------------------------------------------------------ query inputs

_Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
_Slug = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]


def _blank_to_none(values: Any) -> Any:
    """A parameter present but empty (``?area=``) means "not provided", as in the frontend URL."""
    if isinstance(values, dict):
        return {key: (None if value == "" else value) for key, value in values.items()}
    return values


class SearchQuery(ApiModel):
    """``GET /search`` parameters. Names are the frontend's Search URL keys (camelCase)."""

    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    type: Literal["all", "provider", "business", "tutor", "property", "news"] = "all"
    area: _Text | None = None
    category: _Slug | None = None
    subject: _Slug | None = None
    grade: _Text | None = None
    bedrooms: int | None = Field(default=None, ge=1, le=20)
    furnished: Furnishing | None = None
    listing_type: PropertyListingType | None = None
    property_type: _Slug | None = None
    # Closed value sets are validated: absent = no filter, known = filter, unknown = 422 (an
    # unrecognised value must never silently broaden the results). ``foodCategory`` is open data
    # (admin-managed taxonomy), so an unknown slug is a normal filter that matches nothing.
    vertical: BusinessVertical | None = None
    food_category: _Slug | None = None
    service: FoodServiceOption | None = None
    sort: Literal["default", "newest"] = "default"
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)

    _normalize = model_validator(mode="before")(_blank_to_none)


class SuggestionQuery(ApiModel):
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    type: Literal["all", "provider", "business", "tutor", "property", "news"] = "all"
    limit: int = Field(default=8, ge=1, le=20)

    _normalize = model_validator(mode="before")(_blank_to_none)


class CategoryQuery(ApiModel):
    module: CategoryModule | None = None

    _normalize = model_validator(mode="before")(_blank_to_none)


class NewsQuery(ApiModel):
    kind: NewsKind | None = None
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)

    _normalize = model_validator(mode="before")(_blank_to_none)
