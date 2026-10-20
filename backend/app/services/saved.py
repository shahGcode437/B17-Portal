"""Saved items (Phase 12F; docs/backend/API_CONTRACT.md §10.8, §13).

Rules: any signed-in user may save (e-mail verification is not required — AUTH_RBAC.md §22.1); only
an APPROVED listing may newly be saved (anything else is the same ``404`` the public detail gives);
``PUT`` and ``DELETE`` are idempotent; the list shows only the caller's own items whose listing is
STILL approved, using the public card mapping. A saved listing that stops being approved keeps its
row — it is merely not selected — and reappears if re-approved; un-saving it always works.
Saving changes nothing about the listing (no ranking, no counter) and grants no access to it.
"""

import datetime
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import transaction
from app.repositories.listing_reads import ListingReadRepository
from app.repositories.saved import SavedRepository
from app.schemas.envelope import PageMeta
from app.schemas.read import BusinessRead, ListingDetail, ProviderRead, TutorRead
from app.schemas.saved import (
    SavedBusiness,
    SavedHit,
    SavedProperty,
    SavedProvider,
    SavedQuery,
    SavedTutor,
)
from app.services.read_mappers import map_listing
from app.services.service_requests import not_found, parse_id


class SavedService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._saved = SavedRepository(session)
        self._listings = ListingReadRepository(session)

    def save(self, user_id: uuid.UUID, raw_id: str) -> None:
        """Idempotent: a repeat (or a concurrent twin) leaves exactly one row."""
        listing_id = parse_id(raw_id)
        try:
            with transaction(self._session):
                if not self._saved.is_public(listing_id):
                    raise not_found()
                self._saved.insert_if_absent(user_id, listing_id)
        except IntegrityError:  # the listing vanished between the check and the insert
            raise not_found() from None

    def unsave(self, user_id: uuid.UUID, raw_id: str) -> None:
        """Idempotent: nothing saved is not an error, and the listing's status does not matter."""
        listing_id = parse_id(raw_id)
        with transaction(self._session):
            self._saved.delete(user_id, listing_id)

    def list(self, user_id: uuid.UUID, query: SavedQuery) -> tuple[list[SavedHit], PageMeta]:
        total, page = self._saved.page(user_id, query.limit, query.offset)
        # A fixed number of queries however many items: one for the page, one to hydrate cards.
        cards = self._listings.get_public_cards([listing_id for listing_id, _ in page])
        hits: list[SavedHit] = []
        for listing_id, saved_at in page:
            listing = cards.get(listing_id)
            if listing is None:  # changed visibility between the two queries: just skip it
                continue
            hits.append(_hit(map_listing(listing, include_menu=False), saved_at))
        return hits, PageMeta(total=total, limit=query.limit, offset=query.offset)


def _hit(item: ListingDetail, saved_at: datetime.datetime) -> SavedHit:
    if isinstance(item, ProviderRead):
        return SavedProvider(kind="provider", item=item, saved_at=saved_at)
    if isinstance(item, BusinessRead):
        return SavedBusiness(kind="business", item=item, saved_at=saved_at)
    if isinstance(item, TutorRead):
        return SavedTutor(kind="tutor", item=item, saved_at=saved_at)
    return SavedProperty(kind="property", item=item, saved_at=saved_at)
