"""The owner's own listings: list and detail, with the private location (Phase 12D).

Every query is scoped by ``owner_id = :principal`` in the repository, so another user's listing is
indistinguishable from a missing one (``404``, never ``403``). No transaction beyond the session
default; nothing is written.
"""

import uuid

from sqlalchemy.orm import Session

from app.models import Listing
from app.models.enums import ListingStatus
from app.repositories.owner_listings import OwnerListingRepository
from app.schemas.write import (
    OwnerListing,
    OwnerListingsMeta,
    OwnerListingsQuery,
    StatusCounts,
)
from app.services.listing_writes import not_found, parse_listing_id
from app.services.owner_mappers import map_owner_listing


class OwnerListingService:
    def __init__(self, session: Session) -> None:
        self._listings = OwnerListingRepository(session)

    def get(self, owner_id: uuid.UUID, raw_id: str) -> OwnerListing:
        listing = self._listings.get_owned(parse_listing_id(raw_id), owner_id)
        if listing is None:
            raise not_found()
        return self.present(listing)

    def present(self, listing: Listing) -> OwnerListing:
        return self.present_all([listing])[0]

    def present_all(self, listings: list[Listing]) -> list[OwnerListing]:
        """Map a page; the rejection reasons of its rejected listings come from ONE query."""
        rejected = [item.id for item in listings if item.status is ListingStatus.REJECTED]
        reasons = self._listings.current_rejection_reasons(rejected)
        return [map_owner_listing(item, rejection_reason=reasons.get(item.id)) for item in listings]

    def list(
        self, owner_id: uuid.UUID, query: OwnerListingsQuery
    ) -> tuple[list[OwnerListing], OwnerListingsMeta]:
        rows, total = self._listings.list_owned(
            owner_id,
            status=query.status,
            kind=query.kind,
            limit=query.limit,
            offset=query.offset,
        )
        counts = self._listings.counts_by_status(owner_id)
        meta = OwnerListingsMeta(
            total=total,
            limit=query.limit,
            offset=query.offset,
            counts=StatusCounts(
                pending=counts[ListingStatus.PENDING],
                approved=counts[ListingStatus.APPROVED],
                rejected=counts[ListingStatus.REJECTED],
                archived=counts[ListingStatus.ARCHIVED],
            ),
        )
        return self.present_all(rows), meta
