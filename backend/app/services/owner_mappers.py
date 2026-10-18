"""ORM -> OWNER schemas: the one place the stored (private) location leaves the backend, and only
to the listing's owner (docs/backend/LOCATION_MAP.md §7.3).

Callers load the listing through ``OwnerListingRepository`` (private columns undeferred, public
relations loaded), so mapping never lazy-loads. ``public_location`` is produced by the SAME function
the public API uses, so the owner sees exactly the consequence of their privacy choice.
"""

from app.models import Listing
from app.models.enums import BusinessVertical, ListingKind, ListingStatus
from app.schemas.read import CategoryRef
from app.schemas.write import (
    OwnerBusiness,
    OwnerListing,
    OwnerLocation,
    OwnerProperty,
    OwnerProvider,
    OwnerTutor,
)
from app.services.read_mappers import map_food, map_location


def map_owner_location(listing: Listing) -> OwnerLocation:
    return OwnerLocation(
        visibility=listing.location_visibility,
        block=listing.block,
        address=listing.address,
        landmark=listing.landmark,
        latitude=float(listing.latitude) if listing.latitude is not None else None,
        longitude=float(listing.longitude) if listing.longitude is not None else None,
    )


def map_owner_listing(listing: Listing, *, rejection_reason: str | None = None) -> OwnerListing:
    """One of the owner's listings -> its kind-specific owner shape. ``rejection_reason`` is shown
    only while the listing is ``rejected`` (it is derived from the latest rejection)."""
    primary = listing.categories[0].category if listing.categories else None
    common = {
        "id": listing.id,
        "status": listing.status,
        "revision": listing.revision,
        "area": listing.area,
        "location": map_owner_location(listing),
        "public_location": map_location(listing, detail=True),
        "description": listing.description,
        "image": listing.image_url,
        "tags": list(listing.tags),
        "categories": [
            CategoryRef(
                slug=link.category.slug, name=link.category.name, is_primary=link.position == 1
            )
            for link in listing.categories
        ],
        "category_label": primary.name if primary else "",
        "rejection_reason": rejection_reason if listing.status is ListingStatus.REJECTED else None,
        "featured": True if listing.is_featured else None,
        "submitted_at": listing.submitted_at,
        "created_at": listing.created_at,
        "updated_at": listing.updated_at,
    }
    slug = primary.slug if primary else ""

    if listing.kind is ListingKind.PROVIDER:
        return OwnerProvider(kind="provider", name=listing.title, category=slug, **common)

    if listing.kind is ListingKind.BUSINESS:
        business = listing.business
        assert business is not None  # guaranteed by the subtype composite FK + the write rules
        is_food = business.vertical is BusinessVertical.FOOD and business.food is not None
        return OwnerBusiness(
            kind="business",
            name=listing.title,
            vertical=business.vertical,
            category=None if is_food else slug,
            food=map_food(listing, include_menu=True) if is_food else None,
            **common,
        )

    if listing.kind is ListingKind.TUTOR:
        tutor = listing.tutor_profile
        assert tutor is not None
        return OwnerTutor(
            kind="tutor", name=listing.title, category=slug, grade=tutor.grade, **common
        )

    prop = listing.property_profile
    assert prop is not None
    return OwnerProperty(
        kind="property",
        title=listing.title,
        listing_type=prop.listing_type,
        property_type=slug,
        price=prop.price_text,
        bedrooms=prop.bedrooms,
        furnished=prop.furnished,
        **common,
    )
