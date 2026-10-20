"""Saved items: the user's bookmarks (Phase 12F; docs/backend/API_CONTRACT.md §13).

Query / add / delete only — the service owns the transaction. ``saved_items`` has
``PRIMARY KEY (user_id, listing_id)``, so a duplicate is impossible at the database level; the
insert is ``ON CONFLICT DO NOTHING`` so two concurrent saves never raise.
"""

import datetime
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Listing, SavedItem
from app.models.enums import ListingStatus

PUBLIC_STATUS = ListingStatus.APPROVED


class SavedRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def is_public(self, listing_id: uuid.UUID) -> bool:
        """Is there an APPROVED listing with this id (the only thing that may newly be saved)?"""
        return (
            self._session.scalar(
                select(Listing.id).where(Listing.id == listing_id, Listing.status == PUBLIC_STATUS)
            )
            is not None
        )

    def insert_if_absent(self, user_id: uuid.UUID, listing_id: uuid.UUID) -> bool:
        """``True`` iff THIS call created the row; a repeat or concurrent twin changes nothing."""
        created = self._session.execute(
            pg_insert(SavedItem)
            .values(user_id=user_id, listing_id=listing_id)
            .on_conflict_do_nothing(index_elements=[SavedItem.user_id, SavedItem.listing_id])
            .returning(SavedItem.listing_id)
        ).first()
        return created is not None

    def delete(self, user_id: uuid.UUID, listing_id: uuid.UUID) -> bool:
        """``True`` iff a row existed. Works whatever the listing's status now is."""
        result = self._session.execute(
            delete(SavedItem)
            .where(SavedItem.user_id == user_id, SavedItem.listing_id == listing_id)
            .returning(SavedItem.listing_id)
        )
        return result.first() is not None

    def page(
        self, user_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[int, list[tuple[uuid.UUID, datetime.datetime]]]:
        """One page of the user's saved items whose listing is STILL APPROVED, newest save first,
        and the total of such items. A saved listing that is no longer public stays in the table
        (it reappears if re-approved) but is simply not selected here."""
        visible = (
            SavedItem.user_id == user_id,
            Listing.status == PUBLIC_STATUS,
        )
        total = self._session.scalar(
            select(func.count())
            .select_from(SavedItem)
            .join(Listing, Listing.id == SavedItem.listing_id)
            .where(*visible)
        )
        rows = self._session.execute(
            select(SavedItem.listing_id, SavedItem.created_at)
            .join(Listing, Listing.id == SavedItem.listing_id)
            .where(*visible)
            .order_by(SavedItem.created_at.desc(), SavedItem.listing_id)
            .limit(limit)
            .offset(offset)
        ).all()
        return int(total or 0), [(row[0], row[1]) for row in rows]

    def count_rows(self, user_id: uuid.UUID, listing_id: uuid.UUID) -> int:
        """How many rows exist for this pair (0 or 1) — for tests and diagnostics."""
        return int(
            self._session.scalar(
                select(func.count())
                .select_from(SavedItem)
                .where(SavedItem.user_id == user_id, SavedItem.listing_id == listing_id)
            )
            or 0
        )
