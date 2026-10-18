"""Admin-side persistence for listings (Phase 12E): the moderation queue, the review detail with the
PRIVATE location, the moderation history and the guarded status update. Queries and flushes only —
never commits.

A third read path on purpose, beside the public ``ListingReadRepository`` (which keeps the private
columns ``deferred_raiseload`` and never loads them) and the owner one (``owner_id`` predicate). The
admin path is reachable only behind ``AdminUser``; it has NO ownership predicate — an admin reviews
any listing — and it never edits content.

The queue is a deliberately LIGHT query: the listing row, its categories (for the label), the
business profile (for the vertical) and the submitter's display name, in three statements however
many rows the page has. The expensive full shape belongs to the detail.
"""

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Listing, ListingCategory, ListingStatusHistory, User
from app.models.enums import ListingKind, ListingStatus
from app.repositories.owner_listings import owner_options


class AdminListingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # -- reads ----------------------------------------------------------------------------------

    def get(self, listing_id: uuid.UUID, *, lock: bool = False) -> Listing | None:
        """Any listing, in ANY status, with the full review relations and the private location.
        ``lock`` takes ``FOR UPDATE OF listings`` (the moderation decision's row lock)."""
        statement = (
            select(Listing)
            .where(Listing.id == listing_id)
            .options(*owner_options())
            .execution_options(populate_existing=True)
        )
        if lock:
            statement = statement.with_for_update(of=Listing)
        return self._session.scalars(statement).one_or_none()

    def submitter_name(self, owner_id: uuid.UUID | None) -> str | None:
        if owner_id is None:
            return None
        return self._session.scalar(select(User.display_name).where(User.id == owner_id))

    def page(
        self,
        *,
        status: ListingStatus | None,
        kind: ListingKind | None,
        limit: int,
        offset: int,
    ) -> tuple[list[tuple[Listing, str | None]], int]:
        """One page of summaries ``(listing, submitter display name)`` and the total matching.

        Order: a ``pending`` queue is first-in-first-out (oldest submission first); every other view
        is newest first. Ties break on ``id`` so pagination is stable.
        """
        conditions: list[Any] = []
        if status is not None:
            conditions.append(Listing.status == status)
        if kind is not None:
            conditions.append(Listing.kind == kind)
        total = int(
            self._session.scalar(select(func.count()).select_from(Listing).where(*conditions)) or 0
        )
        oldest_first = status is ListingStatus.PENDING
        rows = self._session.execute(
            select(Listing, User.display_name)
            .outerjoin(User, User.id == Listing.owner_id)
            .where(*conditions)
            .options(
                selectinload(Listing.categories).joinedload(ListingCategory.category),
                joinedload(Listing.business),
            )
            .order_by(
                Listing.submitted_at.asc() if oldest_first else Listing.submitted_at.desc(),
                Listing.id,
            )
            .limit(limit)
            .offset(offset)
        ).unique()
        return [(listing, name) for listing, name in rows], total

    def counts_by_status(self) -> dict[ListingStatus, int]:
        rows = self._session.execute(
            select(Listing.status, func.count()).group_by(Listing.status)
        ).all()
        counts = dict.fromkeys(ListingStatus, 0)
        for status, count in rows:
            counts[status] = int(count)
        return counts

    def history(self, listing_id: uuid.UUID) -> list[tuple[ListingStatusHistory, str]]:
        """The listing's audit trail, oldest first, with each actor's display name (one query)."""
        rows = self._session.execute(
            select(ListingStatusHistory, User.display_name)
            .join(User, User.id == ListingStatusHistory.actor_user_id)
            .where(ListingStatusHistory.listing_id == listing_id)
            .order_by(
                ListingStatusHistory.created_at,
                ListingStatusHistory.revision,
                ListingStatusHistory.id,
            )
        ).all()
        return [(entry, name) for entry, name in rows]

    # -- writes ---------------------------------------------------------------------------------

    def guarded_status_update(
        self,
        listing_id: uuid.UUID,
        *,
        expected_revision: int,
        from_status: ListingStatus,
        to_status: ListingStatus,
    ) -> bool:
        """``UPDATE listings SET status = :to WHERE id AND revision = :expected AND status = :from``

        (one statement).

        Moderation acts ON the reviewed revision and does not change it (API_CONTRACT §10.4).
        ``False`` = zero rows matched (the listing moved on since it was read).
        """
        result = self._session.execute(
            update(Listing)
            .where(
                Listing.id == listing_id,
                Listing.revision == expected_revision,
                Listing.status == from_status,
            )
            .values(status=to_status)
            .execution_options(synchronize_session=False)
        )
        matched: int = result.rowcount  # type: ignore[attr-defined]
        return matched == 1

    def record_history(self, entry: ListingStatusHistory) -> None:
        self._session.add(entry)
        self._session.flush()

    def expire_all(self) -> None:
        self._session.expire_all()
