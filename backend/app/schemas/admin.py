"""Admin schemas (Phase 12E; docs/backend/API_CONTRACT.md §10.2, §10.3, §10.7).

Requests are strict like every write (an undeclared key — ``status``, ``ownerId``, ``module`` or
``slug`` on a category PATCH — is ``422 not_allowed``). Responses are explicit models: the queue
is a lightweight SUMMARY; the detail is the owner shape (private location included) plus the
submitter's display name and the moderation history. Nothing carries e-mail, password, session,
token, OAuth or auth-event data.
"""

import datetime
import uuid
from typing import Annotated

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import (
    ActorRole,
    BusinessVertical,
    CategoryModule,
    HistoryAction,
    ListingKind,
    ListingStatus,
    LocationVisibility,
)
from app.schemas.envelope import ApiModel, PageMeta
from app.schemas.write import (
    OwnerBusiness,
    OwnerProperty,
    OwnerProvider,
    OwnerTutor,
    Revision,
    StatusCounts,
    StrictRequest,
    printable,
)
from app.services.moderation_rules import MAX_REJECTION_REASON_LENGTH
from app.services.taxonomy_rules import (
    MAX_DISPLAY_ORDER,
    MAX_NAME_LENGTH,
    MAX_SLUG_LENGTH,
    MIN_NAME_LENGTH,
)

# ------------------------------------------------------------------------------ requests


class AdminListingsQuery(ApiModel):
    status: ListingStatus | None = None
    kind: ListingKind | None = None
    limit: int = Field(default=12, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="before")
    @classmethod
    def _blank_is_absent(cls, values: object) -> object:
        if isinstance(values, dict):
            return {key: (None if value == "" else value) for key, value in values.items()}
        return values


class ApproveRequest(StrictRequest):
    """``revision`` is the value the admin reviewed."""

    revision: Revision


class RejectRequest(StrictRequest):
    revision: Revision
    #: Shown to the owner. The service re-checks the NORMALISED text (>= 10 characters).
    reason: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=MAX_REJECTION_REASON_LENGTH * 2
        ),
        printable(True),
    ]


class CategoriesQuery(ApiModel):
    module: CategoryModule | None = None

    @model_validator(mode="before")
    @classmethod
    def _blank_is_absent(cls, values: object) -> object:
        if isinstance(values, dict):
            return {key: (None if value == "" else value) for key, value in values.items()}
        return values


_Name = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=MIN_NAME_LENGTH, max_length=MAX_NAME_LENGTH
    ),
    printable(False),
]
_Slug = Annotated[str, StringConstraints(max_length=MAX_SLUG_LENGTH)]
_Order = Annotated[int, Field(strict=True, ge=0, le=MAX_DISPLAY_ORDER)]


class CategoryCreate(StrictRequest):
    #: A code-defined module; an admin can never create one (a value outside the enum is ``422``).
    module: CategoryModule
    name: _Name
    #: Lowercase ``[a-z0-9-]``; derived from ``name`` when omitted. Immutable afterwards.
    slug: _Slug | None = None
    parent_id: uuid.UUID | None = None
    #: Omitted = appended after the existing siblings.
    display_order: _Order | None = None


class CategoryPatch(StrictRequest):
    """Omitted = unchanged. ``parentId: null`` moves to the top level; ``name`` / ``isActive`` /
    ``displayOrder`` are not clearable. ``module`` and ``slug`` are immutable (undeclared keys)."""

    name: _Name | None = None
    parent_id: uuid.UUID | None = None
    is_active: bool | None = None
    display_order: _Order | None = None


class CategoryReorder(StrictRequest):
    module: CategoryModule
    #: ``null`` = the top level. Required (a missing key is a 422, not "the top level").
    parent_id: uuid.UUID | None
    #: EXACTLY the group's category ids, in the new order.
    ordered_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


# ------------------------------------------------------------------------------ responses


class AdminSubmitter(ApiModel):
    """The listing owner as the moderator sees them: the display name only."""

    display_name: str


class AdminActor(ApiModel):
    display_name: str
    role: ActorRole


class AdminHistoryEntry(ApiModel):
    action: HistoryAction
    #: ``None`` for the creation row.
    from_status: ListingStatus | None = None
    to_status: ListingStatus
    #: The listing revision the event applied to.
    revision: int
    reason: str | None = None
    actor: AdminActor
    created_at: datetime.datetime


class AdminListingSummary(ApiModel):
    """One queue row. Deliberately light: no description, subtype, categories list or private
    location — the detail endpoint carries those."""

    id: uuid.UUID
    kind: ListingKind
    vertical: BusinessVertical | None = None
    title: str
    area: str
    block: str | None = None
    location_visibility: LocationVisibility
    category_label: str
    status: ListingStatus
    revision: int
    featured: bool | None = None
    submitted_at: datetime.datetime
    updated_at: datetime.datetime
    submitter: AdminSubmitter | None = None


class AdminListingsMeta(PageMeta):
    counts: StatusCounts


class AdminListingsEnvelope(ApiModel):
    data: list[AdminListingSummary]
    meta: AdminListingsMeta


class _AdminExtras(ApiModel):
    #: ``None`` for admin-curated / unclaimed content (no owner).
    submitter: AdminSubmitter | None = None
    history: list[AdminHistoryEntry]


class AdminProvider(OwnerProvider, _AdminExtras):
    """The owner shape plus the submitter and the moderation history."""


class AdminBusiness(OwnerBusiness, _AdminExtras):
    """The owner shape plus the submitter and the moderation history."""


class AdminTutor(OwnerTutor, _AdminExtras):
    """The owner shape plus the submitter and the moderation history."""


class AdminProperty(OwnerProperty, _AdminExtras):
    """The owner shape plus the submitter and the moderation history."""


AdminListing = Annotated[
    AdminProvider | AdminBusiness | AdminTutor | AdminProperty, Field(discriminator="kind")
]


class AdminListingEnvelope(ApiModel):
    data: AdminListing


class AdminCategory(ApiModel):
    id: uuid.UUID
    module: CategoryModule
    slug: str
    name: str
    parent_id: uuid.UUID | None = None
    display_order: int
    is_active: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime


class AdminCategoryEnvelope(ApiModel):
    data: AdminCategory


class AdminCategoriesEnvelope(ApiModel):
    data: list[AdminCategory]
