"""Owner-side persistence for listings (Phase 12D): reads WITH the private location, row locking,
the guarded update, and replacement of child rows. Queries and flushes only — never commits.

Separate from ``ListingReadRepository`` on purpose: the public repository keeps the private columns
``deferred_raiseload`` and never loads them. The owner path is the explicit, narrow exception
(``undefer``), reachable only through an ownership predicate (``owner_id = :principal``) — a
non-owner and a missing row are indistinguishable (``None``).

Child rows (categories, Food profile and menu, subtype columns) are written with SQL statements and
the session is then expired, so no stale ORM state survives a replacement; callers re-read through
:meth:`OwnerListingRepository.get_owned`.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, undefer

from app.models import (
    BusinessProfile,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    ListingStatusHistory,
    ProfessionalProfile,
    PropertyProfile,
    TutorProfile,
)
from app.models.enums import (
    BusinessVertical,
    HistoryAction,
    ListingKind,
    ListingStatus,
    PlanCode,
)
from app.repositories.listing_reads import detail_options


def owner_options() -> list[Any]:
    """The public detail relations plus the PRIVATE location columns (owner/admin only)."""
    return [
        *detail_options(),
        undefer(Listing.address),
        undefer(Listing.landmark),
        undefer(Listing.latitude),
        undefer(Listing.longitude),
    ]


class OwnerListingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # -- reads -----------------------------------------------------------------------------------

    def get_owned(
        self, listing_id: uuid.UUID, owner_id: uuid.UUID, *, lock: bool = False
    ) -> Listing | None:
        """The listing if ``owner_id`` owns it, in ANY status; else ``None`` (never a 403).

        ``populate_existing`` makes the result reflect the database (after our own SQL writes, and
        after waiting for a lock); ``lock`` takes ``FOR UPDATE OF listings`` so concurrent writers
        of one listing are serialised. The lock is on the listing row only, not on joined subtypes.
        """
        statement = (
            select(Listing)
            .where(Listing.id == listing_id, Listing.owner_id == owner_id)
            .options(*owner_options())
            .execution_options(populate_existing=True)
        )
        if lock:
            statement = statement.with_for_update(of=Listing)
        return self._session.scalars(statement).one_or_none()

    def list_owned(
        self,
        owner_id: uuid.UUID,
        *,
        status: ListingStatus | None,
        kind: ListingKind | None,
        limit: int,
        offset: int,
    ) -> tuple[list[Listing], int]:
        """One page of the owner's listings, newest first, and the total matching the filters."""
        conditions = [Listing.owner_id == owner_id]
        if status is not None:
            conditions.append(Listing.status == status)
        if kind is not None:
            conditions.append(Listing.kind == kind)
        total = int(
            self._session.scalar(select(func.count()).select_from(Listing).where(*conditions)) or 0
        )
        rows = self._session.scalars(
            select(Listing)
            .where(*conditions)
            .options(*owner_options())
            .order_by(Listing.created_at.desc(), Listing.id)
            .limit(limit)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
        return list(rows.unique()), total

    def counts_by_status(self, owner_id: uuid.UUID) -> dict[ListingStatus, int]:
        rows = self._session.execute(
            select(Listing.status, func.count())
            .where(Listing.owner_id == owner_id)
            .group_by(Listing.status)
        ).all()
        counts = dict.fromkeys(ListingStatus, 0)
        for status, count in rows:
            counts[status] = int(count)
        return counts

    def current_rejection_reasons(self, listing_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, str]:
        """The latest ``rejected`` history reason per listing (the single source of truth for the
        reason; callers only show it while the listing is still ``rejected``)."""
        if not listing_ids:
            return {}
        rows = self._session.execute(
            select(ListingStatusHistory.listing_id, ListingStatusHistory.reason)
            .where(
                ListingStatusHistory.listing_id.in_(listing_ids),
                ListingStatusHistory.action == HistoryAction.REJECTED,
            )
            .ext(distinct_on(ListingStatusHistory.listing_id))
            .order_by(
                ListingStatusHistory.listing_id,
                ListingStatusHistory.created_at.desc(),
                # A listing cannot be rejected twice at one revision (leaving ``rejected`` takes a
                # resubmission, which bumps it), so this orders any timestamp tie deterministically.
                ListingStatusHistory.revision.desc(),
                ListingStatusHistory.id.desc(),
            )
        ).all()
        return {listing_id: reason for listing_id, reason in rows if reason}

    def count_active(self, owner_id: uuid.UUID, *, excluding: uuid.UUID | None = None) -> int:
        """Listings that count against the plan quota: ``pending`` + ``approved``."""
        conditions = [
            Listing.owner_id == owner_id,
            Listing.status.in_((ListingStatus.PENDING, ListingStatus.APPROVED)),
        ]
        if excluding is not None:
            conditions.append(Listing.id != excluding)
        return int(
            self._session.scalar(select(func.count()).select_from(Listing).where(*conditions)) or 0
        )

    # -- writes ----------------------------------------------------------------------------------

    def add(self, listing: Listing) -> Listing:
        self._session.add(listing)
        self._session.flush()
        return listing

    def guarded_update(
        self,
        listing_id: uuid.UUID,
        owner_id: uuid.UUID,
        expected_revision: int,
        values: dict[str, Any],
    ) -> bool:
        """``UPDATE listings SET …, revision = revision + 1 WHERE id AND owner_id AND revision =
        :expected AND status <> 'archived'`` (API_CONTRACT §10.4). ``False`` = zero rows matched."""
        result = self._session.execute(
            update(Listing)
            .where(
                Listing.id == listing_id,
                Listing.owner_id == owner_id,
                Listing.revision == expected_revision,
                Listing.status != ListingStatus.ARCHIVED,
            )
            .values(**values, revision=Listing.revision + 1)
            .execution_options(synchronize_session=False)
        )
        matched: int = result.rowcount  # type: ignore[attr-defined]
        return matched == 1

    def record_history(self, entry: ListingStatusHistory) -> None:
        self._session.add(entry)
        self._session.flush()

    def replace_categories(self, listing_id: uuid.UUID, category_ids: Sequence[uuid.UUID]) -> None:
        self._session.execute(
            delete(ListingCategory).where(ListingCategory.listing_id == listing_id)
        )
        if category_ids:
            self._session.execute(
                insert(ListingCategory),
                [
                    {"listing_id": listing_id, "category_id": category_id, "position": position}
                    for position, category_id in enumerate(category_ids, start=1)
                ],
            )

    def update_property(self, listing_id: uuid.UUID, **values: Any) -> None:
        self._session.execute(
            update(PropertyProfile).where(PropertyProfile.listing_id == listing_id).values(**values)
        )

    def update_tutor(self, listing_id: uuid.UUID, grade: str) -> None:
        self._session.execute(
            update(TutorProfile).where(TutorProfile.listing_id == listing_id).values(grade=grade)
        )

    def set_vertical(self, listing_id: uuid.UUID, vertical: BusinessVertical) -> None:
        self._session.execute(
            update(BusinessProfile)
            .where(BusinessProfile.listing_id == listing_id)
            .values(vertical=vertical)
        )

    def delete_food(self, listing_id: uuid.UUID) -> None:
        """Remove the Food profile (its menu items go with it by ``ON DELETE CASCADE``)."""
        self._session.execute(delete(FoodProfile).where(FoodProfile.listing_id == listing_id))

    def insert_food(
        self,
        listing_id: uuid.UUID,
        *,
        service_options: Sequence[str],
        hours_note: str | None,
        menu_image_url: str | None,
    ) -> None:
        self._session.execute(
            insert(FoodProfile).values(
                listing_id=listing_id,
                service_options=list(service_options),
                hours_note=hours_note,
                menu_image_url=menu_image_url,
            )
        )

    def update_food(
        self,
        listing_id: uuid.UUID,
        *,
        service_options: Sequence[str],
        hours_note: str | None,
        menu_image_url: str | None,
    ) -> None:
        self._session.execute(
            update(FoodProfile)
            .where(FoodProfile.listing_id == listing_id)
            .values(
                service_options=list(service_options),
                hours_note=hours_note,
                menu_image_url=menu_image_url,
            )
        )

    def replace_menu(self, listing_id: uuid.UUID, items: Sequence[dict[str, Any]]) -> None:
        self._session.execute(delete(FoodMenuItem).where(FoodMenuItem.listing_id == listing_id))
        if items:
            self._session.execute(
                insert(FoodMenuItem),
                [
                    {"id": uuid.uuid4(), "listing_id": listing_id, "position": position, **item}
                    for position, item in enumerate(items, start=1)
                ],
            )

    def expire_all(self) -> None:
        """Drop ORM state after SQL-level child writes, so the next read is fresh."""
        self._session.expire_all()


class ProfessionalProfileRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def insert_if_absent(self, user_id: uuid.UUID) -> bool:
        """``INSERT … ON CONFLICT DO NOTHING``: ``True`` iff THIS call created the row. Atomic, so
        concurrent first calls leave exactly one profile and exactly one of them sees ``True``."""
        created = self._session.execute(
            pg_insert(ProfessionalProfile)
            .values(user_id=user_id, plan_code=PlanCode.FREE)
            .on_conflict_do_nothing(index_elements=[ProfessionalProfile.user_id])
            .returning(ProfessionalProfile.user_id)
        ).first()
        return created is not None

    def plan_of(self, user_id: uuid.UUID) -> PlanCode | None:
        return self._session.scalar(
            select(ProfessionalProfile.plan_code).where(ProfessionalProfile.user_id == user_id)
        )

    def lock(self, user_id: uuid.UUID) -> PlanCode | None:
        """``SELECT … FOR UPDATE`` the user's profile row; its plan, or ``None`` when absent.
        Serialises quota-checked writes of one owner (BACKEND_ARCHITECTURE §6)."""
        return self._session.scalar(
            select(ProfessionalProfile.plan_code)
            .where(ProfessionalProfile.user_id == user_id)
            .with_for_update()
        )
