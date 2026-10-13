"""Persistence for listings. Queries and ``add``/flush only — never commits.

Deliberately small: only what the Phase 10C data-layer tests and services need. Read/search
repositories arrive with Phase 10D. There is intentionally **no** update or delete for
``ListingStatusHistory``: it is append-only.
"""

import uuid

from sqlalchemy.orm import Session

from app.models import Listing, ListingStatusHistory


class ListingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, listing: Listing) -> Listing:
        """Stage the listing and everything cascaded from it, and flush so constraint violations
        surface here (inside the caller's transaction) rather than at commit time."""
        self._session.add(listing)
        self._session.flush()
        return listing

    def get(self, listing_id: uuid.UUID) -> Listing | None:
        return self._session.get(Listing, listing_id)

    def record_history(self, entry: ListingStatusHistory) -> ListingStatusHistory:
        """Append one audit row. The only write the repository offers for history."""
        self._session.add(entry)
        self._session.flush()
        return entry
