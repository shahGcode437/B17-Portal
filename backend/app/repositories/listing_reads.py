"""Read-side access to listings: public detail, search-result hydration and indexing loads.

Queries only — no commits. Eager loading is explicit per use, so a read never triggers lazy
loads while it is being mapped (no N+1): detail loads everything a profile page needs; a search
page loads only what a result card needs (no Food menu items).
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.orm.interfaces import LoaderOption

from app.models import BusinessProfile, FoodProfile, Listing, ListingCategory
from app.models.enums import ListingStatus

#: The only status the public can see.
PUBLIC_STATUS = ListingStatus.APPROVED


def _base_options() -> list[LoaderOption]:
    return [
        selectinload(Listing.categories).joinedload(ListingCategory.category),
        joinedload(Listing.property_profile),
        joinedload(Listing.tutor_profile),
    ]


def detail_options() -> list[LoaderOption]:
    """Everything a public detail page (and the search document) needs."""
    return [
        *_base_options(),
        joinedload(Listing.business)
        .joinedload(BusinessProfile.food)
        .selectinload(FoodProfile.menu_items),
    ]


def card_options() -> list[LoaderOption]:
    """What a search-result card needs: the Food profile, but not its menu items."""
    return [*_base_options(), joinedload(Listing.business).joinedload(BusinessProfile.food)]


class ListingReadRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_public(self, listing_id: uuid.UUID) -> Listing | None:
        """An APPROVED listing with its detail relations, or ``None`` (unknown or not public)."""
        return self._session.scalars(
            select(Listing)
            .where(Listing.id == listing_id, Listing.status == PUBLIC_STATUS)
            .options(*detail_options())
        ).one_or_none()

    def get_public_cards(self, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Listing]:
        """Approved listings by id with card-level relations (used to hydrate a search page)."""
        if not ids:
            return {}
        rows = self._session.scalars(
            select(Listing)
            .where(Listing.id.in_(ids), Listing.status == PUBLIC_STATUS)
            .options(*card_options())
        )
        return {listing.id: listing for listing in rows}

    # -- indexing (every status: a listing is indexed before it is ever approved) -----------------

    def get_for_indexing(self, ids: Sequence[uuid.UUID]) -> list[Listing]:
        if not ids:
            return []
        return list(
            self._session.scalars(
                select(Listing).where(Listing.id.in_(ids)).options(*detail_options())
            )
        )

    def all_ids(self) -> list[uuid.UUID]:
        return list(self._session.scalars(select(Listing.id).order_by(Listing.id)))

    def ids_in_category(self, category_id: uuid.UUID) -> list[uuid.UUID]:
        return list(
            self._session.scalars(
                select(ListingCategory.listing_id).where(ListingCategory.category_id == category_id)
            )
        )
