"""Listing WRITE schemas (Phase 12D; docs/backend/API_CONTRACT.md §10, LOCATION_MAP.md §8).

Request models describe SHAPE and TYPE only (lengths, enums, finite numbers). Everything that needs
the stored listing, the database or the lifecycle — ownership, per-kind completeness, categories,
location requiredness, moderation, revisions — is the service's job (``listing_writes.py``).

Strictness (API_CONTRACT §10.1): a key the model does not declare — ``ownerId``, ``status``,
``revision`` on create, ``featured``, ``roles``, ``publicLatitude``, ``kind`` on PATCH, … — is a
``422`` with ``details[].code = "not_allowed"``, whether its value is set, ``null`` or empty.
Only the camelCase names are accepted. Responses are explicit models too: owner shapes carry the
private location and the moderation state, and never password / session / token data.
"""

import datetime
import uuid
from typing import Annotated, Any, Literal, get_args

from pydantic import (
    AfterValidator,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)
from pydantic_core import InitErrorDetails, PydanticCustomError
from pydantic_core.core_schema import ErrorType

from app.models.enums import (
    BusinessVertical,
    FoodServiceOption,
    Furnishing,
    ListingKind,
    ListingStatus,
    LocationVisibility,
    PropertyListingType,
)
from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.read import CategoryRef, FoodRead, LocationRead

MAX_REVISION = 2_147_483_647  # the column is a 32-bit integer
MAX_TAGS = 20
MAX_TAG_LENGTH = 40


def _printable(allow_newlines: bool) -> AfterValidator:
    def check(value: str) -> str:
        for character in value:
            if allow_newlines and character in "\n\r\t":
                continue
            if not character.isprintable():
                raise PydanticCustomError(
                    "invalid_characters", "Use printable characters only (no control characters)."
                )
        return value

    return AfterValidator(check)


printable = _printable  # shared with the admin schemas
_one_line = _printable(False)
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80), _one_line
]
Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100), _one_line
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=20, max_length=400), _printable(True)
]
AreaText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Slug = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_TAG_LENGTH), _one_line]
Grade = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60), _one_line
]
PriceText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40), _one_line
]
MediaReference = Annotated[str, Field(max_length=2048)]  # validated as a reference by the service
Revision = Annotated[int, Field(strict=True, ge=1, le=MAX_REVISION)]
#: A JSON NUMBER (strings and booleans are rejected), finite. Rounded/range-checked by the service.
Coordinate = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class StrictRequest(ApiModel):
    """camelCase only; an undeclared key is ``not_allowed`` (never silently ignored)."""

    model_config = ConfigDict(extra="ignore", populate_by_name=False)

    @model_validator(mode="wrap")
    @classmethod
    def _reject_undeclared_keys(cls, data: Any, handler: Any) -> Any:
        unknown: list[str] = []
        if isinstance(data, dict):
            known = {field.alias or name for name, field in cls.model_fields.items()}
            unknown = [str(key) for key in data if key not in known]
        try:
            result = handler(data)
        except ValidationError as error:
            if not unknown:
                raise
            raise ValidationError.from_exception_data(
                cls.__name__, [*_replay(error), *_not_allowed(unknown)]
            ) from None
        if unknown:
            raise ValidationError.from_exception_data(cls.__name__, _not_allowed(unknown))
        return result


_KNOWN_ERROR_TYPES = frozenset(get_args(ErrorType))


def _not_allowed(keys: list[str]) -> list[InitErrorDetails]:
    return [
        InitErrorDetails(
            type=PydanticCustomError("not_allowed", "This field cannot be set by the client."),
            loc=(key,),
            input=None,  # never echo a value
        )
        for key in keys
    ]


def _replay(error: ValidationError) -> list[InitErrorDetails]:
    """The errors Pydantic already found, so they are reported together with ``not_allowed``."""
    replayed: list[InitErrorDetails] = []
    for item in error.errors(include_url=False):
        kind = item["type"]
        if kind in _KNOWN_ERROR_TYPES:
            detail = InitErrorDetails(type=kind, loc=item["loc"], input=item.get("input"))
            if "ctx" in item:
                detail["ctx"] = item["ctx"]
        else:
            detail = InitErrorDetails(
                type=PydanticCustomError(kind, item["msg"]), loc=item["loc"], input=None
            )
        replayed.append(detail)
    return replayed


# ------------------------------------------------------------------------------ requests


class LocationInput(StrictRequest):
    """The WHOLE location block (on PATCH it replaces the stored one; omitted sub-fields clear)."""

    visibility: LocationVisibility | None = None
    block: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=40), _one_line] | None
    ) = None
    address: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=200), _one_line] | None
    ) = None
    landmark: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100), _one_line] | None
    ) = None
    latitude: Coordinate | None = None
    longitude: Coordinate | None = None


class MenuItemInput(StrictRequest):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60), _one_line
    ]
    section: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=40), _one_line] | None
    ) = None
    description: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=120), _one_line] | None
    ) = None
    #: A display string ("PKR 1,800"); never parsed.
    price: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=24), _one_line] | None
    ) = None


class FoodInput(StrictRequest):
    #: ``food``-module category slugs, first = primary (1-3 enforced by the service).
    categories: list[Slug] = Field(max_length=20)
    service_options: list[FoodServiceOption] = Field(max_length=10)
    hours_note: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=80), _one_line] | None
    ) = None
    menu_highlights: list[MenuItemInput] = Field(default_factory=list, max_length=50)
    menu_image: MediaReference | None = None


class FoodPatch(StrictRequest):
    """Partial Food block: omitted = unchanged; ``null`` clears only hoursNote / menuImage."""

    categories: list[Slug] | None = Field(default=None, max_length=20)
    service_options: list[FoodServiceOption] | None = Field(default=None, max_length=10)
    hours_note: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=80), _one_line] | None
    ) = None
    menu_highlights: list[MenuItemInput] | None = Field(default=None, max_length=50)
    menu_image: MediaReference | None = None


class _CommonCreate(StrictRequest):
    area: AreaText
    description: Description
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_TAGS)
    image: MediaReference | None = None
    location: LocationInput | None = None


class ProviderCreate(_CommonCreate):
    kind: Literal["provider"]
    name: Name
    #: A ``services`` category slug.
    category: Slug


class BusinessCreate(_CommonCreate):
    kind: Literal["business"]
    name: Name
    vertical: BusinessVertical
    #: General: a ``directory`` slug (a Food business never sends one — it is derived).
    category: Slug | None = None
    #: Food: the Food block (a General business never sends one).
    food: FoodInput | None = None


class TutorCreate(_CommonCreate):
    kind: Literal["tutor"]
    name: Name
    #: An ``education`` slug (the subject).
    category: Slug
    grade: Grade


class PropertyCreate(_CommonCreate):
    kind: Literal["property"]
    title: Title
    listing_type: PropertyListingType
    #: A ``property`` category slug (house / flat / plot ...).
    property_type: Slug
    #: A display string ("PKR 4.5 Cr"), never parsed.
    price: PriceText
    bedrooms: Annotated[int, Field(strict=True, ge=0, le=30)] | None = None
    furnished: Furnishing | None = None


ListingCreate = Annotated[
    ProviderCreate | BusinessCreate | TutorCreate | PropertyCreate, Field(discriminator="kind")
]


class ListingPatch(StrictRequest):
    """``revision`` is the expected concurrency token. Every other field: omitted = unchanged,
    ``null`` = clear (only ``image``, ``bedrooms``, ``furnished`` and the Food ``hoursNote`` /
    ``menuImage`` are clearable — anything else is ``not_nullable``), arrays are replaced whole,
    ``location`` replaces the whole block. ``kind`` is immutable (and not accepted)."""

    revision: Revision
    name: Name | None = None
    title: Title | None = None
    description: Description | None = None
    area: AreaText | None = None
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS)
    image: MediaReference | None = None
    location: LocationInput | None = None
    category: Slug | None = None
    vertical: BusinessVertical | None = None
    food: FoodPatch | None = None
    grade: Grade | None = None
    listing_type: PropertyListingType | None = None
    property_type: Slug | None = None
    price: PriceText | None = None
    bedrooms: Annotated[int, Field(strict=True, ge=0, le=30)] | None = None
    furnished: Furnishing | None = None


class ArchiveRequest(StrictRequest):
    revision: Revision


class ProfessionalProfileRequest(StrictRequest):
    """The body is ``{}``: the plan is server-owned, so there is nothing a client may set."""


class OwnerListingsQuery(ApiModel):
    status: ListingStatus | None = None
    kind: ListingKind | None = None
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="before")
    @classmethod
    def _blank_is_absent(cls, values: Any) -> Any:
        if isinstance(values, dict):
            return {key: (None if value == "" else value) for key, value in values.items()}
        return values


# ------------------------------------------------------------------------------ responses


class OwnerLocation(ApiModel):
    """The owner's full stored location (the private point included) — owner/admin only."""

    visibility: LocationVisibility
    block: str | None = None
    address: str | None = None
    landmark: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class _OwnerBase(ApiModel):
    id: uuid.UUID
    status: ListingStatus
    #: The concurrency token the next PATCH / archive must send back.
    revision: int
    area: str
    location: OwnerLocation
    #: Exactly what an anonymous visitor would see once the listing is approved.
    public_location: LocationRead
    description: str | None = None
    image: str | None = None
    tags: list[str]
    categories: list[CategoryRef]
    #: The category label of the primary category (the request vocabulary uses the slug).
    category_label: str
    #: Present while the listing is ``rejected``: the moderator's current reason.
    rejection_reason: str | None = None
    featured: bool | None = None
    submitted_at: datetime.datetime
    created_at: datetime.datetime
    updated_at: datetime.datetime


class OwnerProvider(_OwnerBase):
    kind: Literal["provider"]
    name: str
    category: str


class OwnerBusiness(_OwnerBase):
    kind: Literal["business"]
    name: str
    vertical: BusinessVertical
    #: The General business category slug; absent for Food (its categories are in ``food``).
    category: str | None = None
    food: FoodRead | None = None


class OwnerTutor(_OwnerBase):
    kind: Literal["tutor"]
    name: str
    category: str
    grade: str


class OwnerProperty(_OwnerBase):
    kind: Literal["property"]
    title: str
    listing_type: PropertyListingType
    property_type: str
    price: str
    bedrooms: int | None = None
    furnished: Furnishing | None = None


OwnerListing = Annotated[
    OwnerProvider | OwnerBusiness | OwnerTutor | OwnerProperty, Field(discriminator="kind")
]


class StatusCounts(ApiModel):
    pending: int
    approved: int
    rejected: int
    archived: int


class OwnerListingsMeta(PageMeta):
    counts: StatusCounts


class OwnerListingEnvelope(ApiModel):
    data: OwnerListing


class OwnerListingsEnvelope(ApiModel):
    data: list[OwnerListing]
    meta: OwnerListingsMeta
