"""The text a listing is found by: ``listings.search_document`` (Phase 10D).

Search is a case-insensitive SUBSTRING match, exactly like the frontend's ``searchableText``: one
lower-cased string per listing, matched with ``LIKE '%q%'`` and served by a trigram GIN index.

Composition (public, approved-content text ONLY — in this order, single-space separated):

* the title (``name`` for provider/business/tutor, ``title`` for property);
* the NAMES of its categories, in position order (so "bakeries" finds a Food business and "house"
  finds a property: the frontend matches the category label as part of the subtitle);
* the description (the tutor's bio is its description);
* the area, and the tags;
* **Food**: the names of its menu items (the frontend searches menu-highlight names too);
* **Property**: the price text, "N bed", the furnishing, and "for sale" / "for rent";
* **Tutor**: the grade.

Never included: owner or any account data, e-mail, phone, moderation reasons, history, ids, status.
Food hours and the service-option labels are not searched (the frontend does not either).

Deliberate differences from the frontend (see docs/backend/READ_API_PARITY.md): a property's long
description is searched here (the frontend only searches its price line), and whitespace runs are
collapsed to a single space.
"""

from app.models import Listing
from app.models.enums import ListingKind, PropertyListingType


def build_search_document(listing: Listing) -> str:
    """Build the document from a listing with its relations loaded (``ListingReadRepository``)."""
    parts: list[str] = [listing.title]
    parts.extend(link.category.name for link in listing.categories)
    if listing.description:
        parts.append(listing.description)
    parts.append(listing.area)
    parts.extend(listing.tags)

    if listing.kind is ListingKind.BUSINESS and listing.business and listing.business.food:
        parts.extend(item.name for item in listing.business.food.menu_items)

    if listing.kind is ListingKind.PROPERTY and listing.property_profile:
        profile = listing.property_profile
        parts.append(profile.price_text)
        if profile.bedrooms:
            parts.append(f"{profile.bedrooms} bed")
        if profile.furnished:
            parts.append(profile.furnished.value)
        parts.append("for sale" if profile.listing_type is PropertyListingType.SALE else "for rent")

    if listing.kind is ListingKind.TUTOR and listing.tutor_profile:
        parts.append(listing.tutor_profile.grade)

    return " ".join(" ".join(parts).split()).lower()
