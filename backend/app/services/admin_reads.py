"""The moderation queue and the review detail (Phase 12E). Read-only; Admin routes only.

No transaction beyond the session default and nothing is written. The queue is three statements
however many rows a page holds (page + categories, the status counts, the total); the detail is the
owner-shape load plus two small lookups (submitter, history) and the current rejection reason.
A page that holds rejected rows costs one more statement (which were takedowns), whatever its size.
"""

import uuid

from sqlalchemy.orm import Session

from app.models import Listing
from app.models.enums import ListingStatus
from app.repositories.admin_listings import AdminListingRepository
from app.repositories.owner_listings import LatestRejection, OwnerListingRepository
from app.schemas.admin import (
    AdminListing,
    AdminListingsMeta,
    AdminListingsQuery,
    AdminListingSummary,
)
from app.schemas.write import StatusCounts
from app.services.admin_mappers import map_admin_listing, map_admin_summary
from app.services.listing_writes import not_found, parse_listing_id


class AdminListingReadService:
    def __init__(self, session: Session) -> None:
        self._listings = AdminListingRepository(session)
        self._owner_listings = OwnerListingRepository(session)

    def queue(
        self, query: AdminListingsQuery
    ) -> tuple[list[AdminListingSummary], AdminListingsMeta]:
        rows, total = self._listings.page(
            status=query.status, kind=query.kind, limit=query.limit, offset=query.offset
        )
        counts = self._listings.counts_by_status()
        meta = AdminListingsMeta(
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
        # One extra statement for the whole page, and only when it holds a rejected row: which of
        # them were TAKEDOWNS (a live listing a moderator removed) rather than plain rejections.
        rejected = [listing.id for listing, _ in rows if listing.status is ListingStatus.REJECTED]
        rejections = self._owner_listings.latest_rejections(rejected)
        summaries = [
            map_admin_summary(
                listing,
                name,
                taken_down=listing.id in rejections and rejections[listing.id].taken_down,
            )
            for listing, name in rows
        ]
        return summaries, meta

    def get(self, raw_id: str) -> AdminListing:
        listing = self._listings.get(parse_listing_id(raw_id))
        if listing is None:
            raise not_found()
        return self.present(listing)

    def present(self, listing: Listing) -> AdminListing:
        """The review shape of a listing already loaded through the admin repository."""
        rejection = self._rejection(listing.id, listing.status)
        return map_admin_listing(
            listing,
            submitter_name=self._listings.submitter_name(listing.owner_id),
            history=self._listings.history(listing.id),
            rejection_reason=rejection.reason if rejection else None,
            taken_down=bool(rejection and rejection.taken_down),
        )

    def _rejection(self, listing_id: uuid.UUID, status: ListingStatus) -> LatestRejection | None:
        if status is not ListingStatus.REJECTED:
            return None
        return self._owner_listings.latest_rejections([listing_id]).get(listing_id)
