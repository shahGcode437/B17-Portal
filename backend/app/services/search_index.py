"""Keeping ``listings.search_document`` correct (Phase 10D decision).

Why application-maintained rather than a generated column or a trigger: the document draws on
several tables (the listing, its subtype, its categories, Food menu items), which PostgreSQL cannot
express as a generated column, and Phase 10C chose services + constraints over trigger meshes. The
price is a rule — **every code path that changes a listing's content (title, description, area,
tags, image-free text, subtype fields, categories, menu items) or a category's name must call this
indexer in the same transaction.** Three things keep that honest:

* one builder (``build_search_document``) and one entry point (this class);
* ``find_stale`` recomputes every document and reports any that differ — run by the test suite and
  by ``python -m app.db.search_index check`` (suitable for CI / a cron);
* ``rebuild_all`` repairs everything (also the post-migration step for pre-existing rows).

Callers own the transaction; this class only flushes.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.models import Listing
from app.repositories.listing_reads import ListingReadRepository
from app.services.search_document import build_search_document

_BATCH = 200


class SearchIndexer:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._listings = ListingReadRepository(session)

    def refresh(self, listing: Listing) -> None:
        """Recompute one listing's document. Its relations are loaded on demand."""
        listing.search_document = build_search_document(listing)
        self._session.flush()

    def refresh_ids(self, ids: Sequence[uuid.UUID]) -> int:
        """Recompute the given listings' documents (batched, eager-loaded); returns the count."""
        done = 0
        for start in range(0, len(ids), _BATCH):
            for listing in self._listings.get_for_indexing(list(ids[start : start + _BATCH])):
                listing.search_document = build_search_document(listing)
                done += 1
            self._session.flush()
        return done

    def reindex_category(self, category_id: uuid.UUID) -> int:
        """Call after renaming a category: its name is part of every member listing's document."""
        return self.refresh_ids(self._listings.ids_in_category(category_id))

    def rebuild_all(self) -> int:
        return self.refresh_ids(self._listings.all_ids())

    def find_stale(self) -> list[uuid.UUID]:
        """Ids of listings whose stored document differs from a fresh computation."""
        stale: list[uuid.UUID] = []
        ids = self._listings.all_ids()
        for start in range(0, len(ids), _BATCH):
            for listing in self._listings.get_for_indexing(ids[start : start + _BATCH]):
                if listing.search_document != build_search_document(listing):
                    stale.append(listing.id)
        return stale
