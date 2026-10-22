"""Listings: one base table plus shared-primary-key subtype tables (DATA_MODEL.md §4).

``listings`` owns everything every kind shares and everything the lifecycle needs. A subtype
table's primary key *is* its ``listing_id``. There is deliberately no table for ``provider``
listings: a Provider has nothing beyond the base row and its category.

Database vs service (docs/backend/DATA_MODEL.md §11):

* The database guarantees row-local integrity and uniqueness, and the composite foreign keys
  below: a subtype row can only exist for a listing of the *matching kind*, and a Food profile can
  only exist for a business whose vertical is ``food``.
* Services own what needs a cross-row, transactional view: the status state machine, quota,
  "a Food business must have a food profile and 1..3 Food categories", category/module matching,
  and incrementing ``revision`` on every content edit.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, query_expression, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import (
    MAX_FOOD_MENU_ITEMS,
    MIN_REJECTION_REASON_LENGTH,
    ActorRole,
    BusinessVertical,
    FoodServiceOption,
    Furnishing,
    HistoryAction,
    ListingKind,
    ListingStatus,
    LocationVisibility,
    PropertyListingType,
)

if TYPE_CHECKING:
    from app.models.taxonomy import ListingCategory

_EMPTY_ARRAY = text("'{}'::text[]")

# The public point is DERIVED BY THE DATABASE from the stored point and the visibility mode
# (docs/backend/LOCATION_MAP.md §3, §7.2). ``exact`` -> the point, ``approximate`` -> the nearest
# point of a 0.01-degree grid (``round(x, 2)``, half away from zero), ``area_only`` -> NULL.
# Application code never writes these columns. Migration 0005 repeats this SQL verbatim.
PUBLIC_LATITUDE_SQL = (
    "CASE location_visibility WHEN 'exact'::text THEN latitude "
    "WHEN 'approximate'::text THEN round(latitude, 2) ELSE NULL::numeric END"
)
PUBLIC_LONGITUDE_SQL = (
    "CASE location_visibility WHEN 'exact'::text THEN longitude "
    "WHEN 'approximate'::text THEN round(longitude, 2) ELSE NULL::numeric END"
)


class Listing(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "listings"

    kind: Mapped[ListingKind] = mapped_column(str_enum(ListingKind), nullable=False)
    #: NULL = admin-curated / unclaimed content. RESTRICT: ownership history must survive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    #: Backend-owned. Clients never write it; services move it through the state machine.
    status: Mapped[ListingStatus] = mapped_column(
        str_enum(ListingStatus),
        nullable=False,
        default=ListingStatus.PENDING,
        server_default="pending",
    )
    #: ``name`` for provider/business/tutor, ``title`` for property (the API keeps those names).
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    area: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=_EMPTY_ARRAY
    )
    #: Interim public URL/path. A browser ``blob:`` URL is never stored (MEDIA_STORAGE.md).
    image_url: Mapped[str | None] = mapped_column(Text)
    #: Admin-owned curation flag; only meaningful for provider/business listings.
    is_featured: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    #: Integer concurrency/version counter — NOT content-version history (deferred). Services
    #: increment it on every content edit; guarded moderation updates compare it.
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: Lower-cased public text the search matches against (Phase 10D). APPLICATION-MAINTAINED by
    #: ``app.services.search_index`` — every code path that writes listing content must refresh it
    #: in the same transaction; ``find_stale`` / ``python -m app.db.search_index check`` audit it.
    #: Composition: ``app.services.search_document``. ``''`` means "not indexed yet".
    search_document: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )

    # -- location (Phase 12B; docs/backend/LOCATION_MAP.md). Shared by every kind. ----------------
    #: Public in every mode. Free text (no block taxonomy is invented).
    block: Mapped[str | None] = mapped_column(String(40))
    #: PRIVATE-CAPABLE: public only for ``exact`` listings. ``deferred_raiseload``: no query loads
    #: it unless it says so explicitly, and a stray attribute access raises instead of silently
    #: lazy-loading — public repositories read ``public_address`` instead.
    address: Mapped[str | None] = mapped_column(String(200), deferred=True, deferred_raiseload=True)
    landmark: Mapped[str | None] = mapped_column(
        String(100), deferred=True, deferred_raiseload=True
    )
    #: PRIVATE: the exact stored point. Never read by a public path; the public API reads the
    #: database-generated ``public_*`` columns. ``area_only`` stores no point (CHECK).
    latitude: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 6), deferred=True, deferred_raiseload=True
    )
    longitude: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 6), deferred=True, deferred_raiseload=True
    )
    #: ``area_only`` is the safe default for legacy rows (no point, area-level only).
    location_visibility: Mapped[LocationVisibility] = mapped_column(
        str_enum(LocationVisibility),
        nullable=False,
        default=LocationVisibility.AREA_ONLY,
        server_default="area_only",
    )
    #: GENERATED ALWAYS ... STORED by PostgreSQL — read-only for the application.
    public_latitude: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 6), Computed(PUBLIC_LATITUDE_SQL, persisted=True)
    )
    public_longitude: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 6), Computed(PUBLIC_LONGITUDE_SQL, persisted=True)
    )
    #: Not a column: populated by public queries with ``with_expression`` as
    #: ``CASE WHEN visibility = 'exact' THEN address END`` — so the address of a non-exact listing
    #: is never even selected on a public path.
    public_address: Mapped[str | None] = query_expression()
    public_landmark: Mapped[str | None] = query_expression()

    business: Mapped["BusinessProfile | None"] = relationship(
        back_populates="listing", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    property_profile: Mapped["PropertyProfile | None"] = relationship(
        back_populates="listing", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    tutor_profile: Mapped["TutorProfile | None"] = relationship(
        back_populates="listing", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    categories: Mapped[list["ListingCategory"]] = relationship(
        back_populates="listing",
        order_by="ListingCategory.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    status_history: Mapped[list["ListingStatusHistory"]] = relationship(
        back_populates="listing",
        order_by="ListingStatusHistory.created_at",
        cascade="save-update, merge",
        passive_deletes=True,
    )

    __table_args__ = (
        in_values("kind", ListingKind, name="kind_valid"),
        in_values("status", ListingStatus, name="status_valid"),
        CheckConstraint("char_length(btrim(title)) > 0", name="title_not_blank"),
        CheckConstraint("char_length(btrim(area)) > 0", name="area_not_blank"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint(
            "NOT is_featured OR kind IN ('provider', 'business')", name="featured_kinds"
        ),
        # -- location (docs/backend/LOCATION_MAP.md §3): row-local rules only. Per-kind
        # requiredness (e.g. a Property needs a point) is a WRITE-SERVICE rule, because legacy
        # rows legitimately have none (§3.1).
        in_values("location_visibility", LocationVisibility, name="location_visibility_valid"),
        CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name="coordinates_pair"),
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="latitude_range"),
        CheckConstraint(
            "longitude IS NULL OR longitude BETWEEN -180 AND 180", name="longitude_range"
        ),
        # area_only <=> no stored point: narrowing to area_only erases the pin.
        CheckConstraint(
            "(location_visibility = 'area_only') = (latitude IS NULL)",
            name="visibility_matches_point",
        ),
        CheckConstraint("block IS NULL OR char_length(btrim(block)) > 0", name="block_not_blank"),
        CheckConstraint(
            "address IS NULL OR char_length(btrim(address)) > 0", name="address_not_blank"
        ),
        CheckConstraint(
            "landmark IS NULL OR char_length(btrim(landmark)) > 0", name="landmark_not_blank"
        ),
        # Target of the subtype tables' composite foreign keys (subtype <-> matching kind).
        UniqueConstraint("id", "kind", name="uq_listings_id_kind"),
        Index("ix_listings_status_kind_created_at", "status", "kind", "created_at"),
        Index("ix_listings_owner_id_status", "owner_id", "status"),
        # Substring search (`search_document LIKE '%q%'`) is served by a trigram GIN index.
        Index(
            "ix_listings_search_document_trgm",
            "search_document",
            postgresql_using="gin",
            postgresql_ops={"search_document": "gin_trgm_ops"},
        ),
        # The public `area=` filter only ever looks at approved listings.
        Index("ix_listings_approved_area", "area", postgresql_where=text("status = 'approved'")),
    )


class BusinessProfile(Base):
    __tablename__ = "business_profiles"

    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    kind: Mapped[ListingKind] = mapped_column(
        str_enum(ListingKind),
        nullable=False,
        default=ListingKind.BUSINESS,
        server_default="business",
    )
    #: Food stays a vertical of Business: ``vertical = 'food'`` + a ``food_profiles`` row.
    vertical: Mapped[BusinessVertical] = mapped_column(
        str_enum(BusinessVertical),
        nullable=False,
        default=BusinessVertical.GENERAL,
        server_default="general",
    )

    listing: Mapped[Listing] = relationship(back_populates="business")
    food: Mapped["FoodProfile | None"] = relationship(
        back_populates="business", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["listing_id", "kind"],
            ["listings.id", "listings.kind"],
            ondelete="CASCADE",
            name="fk_business_profiles_listing_id_kind_listings",
        ),
        CheckConstraint("kind = 'business'", name="kind_is_business"),
        in_values("vertical", BusinessVertical, name="vertical_valid"),
        # Target of food_profiles' composite foreign key.
        UniqueConstraint("listing_id", "vertical", name="uq_business_profiles_listing_id_vertical"),
    )


_SERVICE_OPTIONS_SQL = ", ".join(f"'{option.value}'" for option in FoodServiceOption)


class FoodProfile(Base):
    __tablename__ = "food_profiles"

    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    #: Always ``'food'`` (CHECK). Together with the composite foreign key below this makes it
    #: impossible, in the database, to attach a Food profile to a General business.
    vertical: Mapped[BusinessVertical] = mapped_column(
        str_enum(BusinessVertical),
        nullable=False,
        default=BusinessVertical.FOOD,
        server_default="food",
    )
    #: Canonical order is a presentation concern of the API; the database stores the set.
    service_options: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    hours_note: Mapped[str | None] = mapped_column(String(80))
    menu_image_url: Mapped[str | None] = mapped_column(Text)

    business: Mapped[BusinessProfile] = relationship(back_populates="food")
    menu_items: Mapped[list["FoodMenuItem"]] = relationship(
        back_populates="food",
        order_by="FoodMenuItem.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["listing_id", "vertical"],
            ["business_profiles.listing_id", "business_profiles.vertical"],
            ondelete="CASCADE",
            name="fk_food_profiles_listing_id_vertical_business_profiles",
        ),
        CheckConstraint("vertical = 'food'", name="vertical_is_food"),
        CheckConstraint("cardinality(service_options) >= 1", name="service_options_not_empty"),
        CheckConstraint(
            f"service_options <@ ARRAY[{_SERVICE_OPTIONS_SQL}]::text[]",
            name="service_options_valid",
        ),
        Index("ix_food_profiles_service_options", "service_options", postgresql_using="gin"),
    )


class FoodMenuItem(UUIDPrimaryKeyMixin, Base):
    """One informational menu highlight (no price parsing, no cart/ordering fields)."""

    __tablename__ = "food_menu_items"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("food_profiles.listing_id", ondelete="CASCADE"), nullable=False
    )
    #: 1..8: the range CHECK caps the count, the unique constraint prevents duplicates.
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    section: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(String(120))
    #: A display string ("PKR 1,800"); never parsed.
    price_text: Mapped[str | None] = mapped_column(String(24))

    food: Mapped[FoodProfile] = relationship(back_populates="menu_items")

    __table_args__ = (
        CheckConstraint(f"position BETWEEN 1 AND {MAX_FOOD_MENU_ITEMS}", name="position_range"),
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        UniqueConstraint("listing_id", "position", name="uq_food_menu_items_listing_id_position"),
    )


class PropertyProfile(Base):
    __tablename__ = "property_profiles"

    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    kind: Mapped[ListingKind] = mapped_column(
        str_enum(ListingKind),
        nullable=False,
        default=ListingKind.PROPERTY,
        server_default="property",
    )
    listing_type: Mapped[PropertyListingType] = mapped_column(
        str_enum(PropertyListingType), nullable=False
    )
    #: A display string ("PKR 4.5 Cr", "not a real offer"); a numeric amount is reserved only.
    price_text: Mapped[str] = mapped_column(String, nullable=False)
    bedrooms: Mapped[int | None] = mapped_column(SmallInteger)
    furnished: Mapped[Furnishing | None] = mapped_column(str_enum(Furnishing))

    listing: Mapped[Listing] = relationship(back_populates="property_profile")

    __table_args__ = (
        ForeignKeyConstraint(
            ["listing_id", "kind"],
            ["listings.id", "listings.kind"],
            ondelete="CASCADE",
            name="fk_property_profiles_listing_id_kind_listings",
        ),
        CheckConstraint("kind = 'property'", name="kind_is_property"),
        in_values("listing_type", PropertyListingType, name="listing_type_valid"),
        in_values("furnished", Furnishing, name="furnished_valid", nullable=True),
        CheckConstraint("char_length(btrim(price_text)) > 0", name="price_text_not_blank"),
        CheckConstraint("bedrooms IS NULL OR bedrooms >= 0", name="bedrooms_non_negative"),
        Index("ix_property_profiles_listing_type", "listing_type"),
    )


class TutorProfile(Base):
    """Seed-only today (no tutor onboarding in the frontend); subject = primary category."""

    __tablename__ = "tutor_profiles"

    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    kind: Mapped[ListingKind] = mapped_column(
        str_enum(ListingKind), nullable=False, default=ListingKind.TUTOR, server_default="tutor"
    )
    grade: Mapped[str] = mapped_column(Text, nullable=False)

    listing: Mapped[Listing] = relationship(back_populates="tutor_profile")

    __table_args__ = (
        ForeignKeyConstraint(
            ["listing_id", "kind"],
            ["listings.id", "listings.kind"],
            ondelete="CASCADE",
            name="fk_tutor_profiles_listing_id_kind_listings",
        ),
        CheckConstraint("kind = 'tutor'", name="kind_is_tutor"),
        CheckConstraint("char_length(btrim(grade)) > 0", name="grade_not_blank"),
    )


class ListingStatusHistory(UUIDPrimaryKeyMixin, Base):
    """Append-only audit of every lifecycle event (DATA_MODEL.md §7).

    Written in the same transaction as the status change and never updated or deleted by the
    application (the repository exposes no update/delete). Creation is recorded (``from_status`` is
    NULL) and so is a ``pending -> pending`` resubmission — hence ``action`` as well as from/to.
    The *current* rejection reason is derived from the latest ``rejected`` row, so there is no
    second copy on ``listings`` to drift. There is no ``updated_at`` on purpose.
    """

    __tablename__ = "listing_status_history"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[ListingStatus | None] = mapped_column(str_enum(ListingStatus))
    to_status: Mapped[ListingStatus] = mapped_column(str_enum(ListingStatus), nullable=False)
    action: Mapped[HistoryAction] = mapped_column(str_enum(HistoryAction), nullable=False)
    #: The listing ``revision`` this event applied to.
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    # RESTRICT: users are tombstoned, so the audit trail always keeps a valid actor.
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    actor_role: Mapped[ActorRole] = mapped_column(str_enum(ActorRole), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    # The ORM ``default`` is applied by every INSERT the application makes: ``clock_timestamp()`` is
    # the wall clock at THIS write. ``now()`` (kept as the schema ``server_default``, so no
    # migration) is the transaction's START — within one transaction every event would share a
    # timestamp, and under contention an event could be stamped earlier than the one it follows.
    # Same rule as ``service_request_status_history`` (Phase 12F).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        default=func.clock_timestamp(),
    )

    listing: Mapped[Listing] = relationship(back_populates="status_history")

    __table_args__ = (
        in_values("from_status", ListingStatus, name="from_status_valid", nullable=True),
        in_values("to_status", ListingStatus, name="to_status_valid"),
        in_values("action", HistoryAction, name="action_valid"),
        in_values("actor_role", ActorRole, name="actor_role_valid"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        # Creation has no previous status — and only creation does.
        CheckConstraint(
            "(from_status IS NULL) = (action = 'submitted')", name="from_status_iff_submitted"
        ),
        # The action determines where the listing ended up (row-local; the allowed *sources* of
        # each transition are the service's state machine, not a trigger).
        CheckConstraint(
            "to_status = CASE action WHEN 'submitted' THEN 'pending' "
            "WHEN 'resubmitted' THEN 'pending' WHEN 'approved' THEN 'approved' "
            "WHEN 'rejected' THEN 'rejected' WHEN 'archived' THEN 'archived' END",
            name="action_matches_to_status",
        ),
        CheckConstraint(
            "to_status <> 'rejected' OR (reason IS NOT NULL "
            f"AND char_length(btrim(reason)) >= {MIN_REJECTION_REASON_LENGTH})",
            name="rejection_reason_required",
        ),
        Index("ix_listing_status_history_listing_id_created_at", "listing_id", "created_at"),
    )
