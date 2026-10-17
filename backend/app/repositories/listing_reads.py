"""Read-side access to listings: public detail, search-result hydration and indexing loads.

Queries only — no commits. Eager loading is explicit per use, so a read never triggers lazy
loads while it is being mapped (no N+1): detail loads everything a profile page needs; a search
page loads only what a result card needs (no Food menu items).
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import case, null, select
from sqlalchemy.orm import Session, joinedload, selectinload, undefer, with_expression
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.orm.interfaces import LoaderOption
from sqlalchemy.sql.elements import ColumnElement

from app.models import BusinessProfile, FoodProfile, Listing, ListingCategory
from app.models.enums import ListingStatus, LocationVisibility

#: The only status the public can see.
PUBLIC_STATUS = ListingStatus.APPROVED


def _base_options() -> list[LoaderOption]:
    return [
        selectinload(Listing.categories).joinedload(ListingCategory.category),
        joinedload(Listing.property_profile),
        joinedload(Listing.tutor_profile),
    ]


def _exact_only(column: InstrumentedAttribute[str | None]) -> ColumnElement[str | None]:
    """``CASE WHEN visibility = 'exact' THEN column END`` — the address / landmark of an
    approximate or area-only listing is never even selected on a public path."""
    return case((Listing.location_visibility == LocationVisibility.EXACT, column), else_=null())


def detail_options() -> list[LoaderOption]:
    """Everything a PUBLIC detail page needs. The stored point, ``address`` and ``landmark`` stay
    unloaded (``deferred_raiseload``); the public address / landmark come from guarded SQL."""
    return [
        *_base_options(),
        joinedload(Listing.business)
        .joinedload(BusinessProfile.food)
        .selectinload(FoodProfile.menu_items),
        with_expression(Listing.public_address, _exact_only(Listing.address)),
        with_expression(Listing.public_landmark, _exact_only(Listing.landmark)),
    ]


def indexing_options() -> list[LoaderOption]:
    """Everything the SEARCH DOCUMENT needs: the detail relations plus the stored address and
    landmark (the builder includes them only for ``exact`` listings). Never the stored point."""
    return [*detail_options(), undefer(Listing.address), undefer(Listing.landmark)]


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
                select(Listing)
                .where(Listing.id.in_(ids))
                .options(*indexing_options())
                .execution_options(populate_existing=True)
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
