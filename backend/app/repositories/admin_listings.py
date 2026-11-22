"""Admin-side persistence for listings (Phase 12E): the moderation queue, the review detail with the
PRIVATE location, the moderation history and the guarded status update. Queries and flushes only —
never commits.

A third read path on purpose, beside the public ``ListingReadRepository`` (which keeps the private
columns ``deferred_raiseload`` and never loads them) and the owner one (``owner_id`` predicate). The
admin path is reachable only behind staff authority (``require_staff`` / ``require_super_admin``);
it has NO ownership predicate — staff review any listing within their scope — and it never edits
content. Every method takes an explicit :class:`ScopeFilter` (RBAC-B); there is no default meaning
"all", so a repository caller cannot forget it.

The queue is a deliberately LIGHT query: the listing row, its categories (for the label), the
business profile (for the vertical) and the submitter's display name, in three statements however
many rows the page has. The expensive full shape belongs to the detail.
"""

import uuid
from typing import Any

from sqlalchemy import func, outerjoin, select, update
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import BusinessProfile, Listing, ListingCategory, ListingStatusHistory, User
from app.models.enums import ListingKind, ListingStatus
from app.repositories.owner_listings import owner_options
from app.services.staff_scopes import ScopeFilter, listing_scope_sql


def _scoped_from() -> Any:
    """``listings LEFT OUTER JOIN business_profiles`` — the join the scope predicates need. The
    outer join is deliberate: a Business without a business_profiles row (structurally corrupt)
    has a NULL vertical, so every scope predicate rejects it; it stays Super Admin only."""
    return outerjoin(Listing, BusinessProfile, BusinessProfile.listing_id == Listing.id)


class AdminListingRepository:
    """Admin reads. Every method takes an explicit :class:`ScopeFilter` — there is no default of
    "all". ``ScopeFilter.all()`` is Super Admin, ``of(...)`` is a Moderator's scoped view, and
    ``none()`` returns nothing. A listing outside the filter is indistinguishable from a missing
    one, so a Moderator trying a direct id gets exactly the same answer as for a nonexistent id.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    # -- reads ----------------------------------------------------------------------------------

    def get(self, listing_id: uuid.UUID, scope: ScopeFilter) -> Listing | None:
        """The listing if it is visible through ``scope``, with the full review relations and the
        private location; else ``None`` (a listing outside the scope is indistinguishable from a
        missing one)."""
        if scope.is_empty:
            return None
        where = listing_scope_sql(scope)
        statement = (
            select(Listing)
            .select_from(_scoped_from())
            .where(Listing.id == listing_id)
            .options(*owner_options())
            .execution_options(populate_existing=True)
        )
        if where is not None:
            statement = statement.where(where)
        return self._session.scalars(statement).one_or_none()

    def lock_for_decision(self, listing_id: uuid.UUID) -> Listing | None:
        """``SELECT ... FOR UPDATE OF listings`` WITHOUT a scope filter — and that is deliberate.

        A moderation decision must lock the row FIRST, because the scope it is checked against is
        derived from the row's CURRENT state (a Business can flip General <-> Food), and only then
        read and lock the actor's authority (see ``ModerationService.decide`` and
        ``StaffAuthorityRepository``). So the actor's scope is not yet known here. The caller MUST
        authorise against the returned row before it uses it or lets any part of it leave the
        transaction; ``ModerationService`` is the only caller. Everything else uses :meth:`get`.
        """
        return self._session.scalars(
            select(Listing)
            .select_from(_scoped_from())
            .where(Listing.id == listing_id)
            .options(*owner_options())
            .execution_options(populate_existing=True)
            .with_for_update(of=Listing)
        ).one_or_none()

    def lock_provider_for_write(self, listing_id: uuid.UUID) -> Listing | None:
        """``SELECT ... FOR UPDATE OF listings`` of ONE PROVIDER listing, for staff authoring
        (``ProviderAuthoringService``, RBAC-D); ``None`` when there is no PROVIDER with that id.

        Unscoped like :meth:`lock_for_decision` (the actor's authority is not known yet, and the
        service reads and locks it right after), but restricted to ``kind = 'provider'`` IN the
        locking query: a Business / Tutor / Property id is "not found" here WITHOUT its row being
        locked, so probing a non-provider id through a provider route can neither confirm it exists
        nor stall a moderation decision on it. The caller MUST authorise against the returned row
        before it lets any part of it leave the transaction."""
        return self._session.scalars(
            select(Listing)
            .select_from(_scoped_from())
            .where(Listing.id == listing_id, Listing.kind == ListingKind.PROVIDER)
            .options(*owner_options())
            .execution_options(populate_existing=True)
            .with_for_update(of=Listing)
        ).one_or_none()

    def submitter_name(self, owner_id: uuid.UUID | None) -> str | None:
        if owner_id is None:
            return None
        return self._session.scalar(select(User.display_name).where(User.id == owner_id))

    def page(
        self,
        scope: ScopeFilter,
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
        if scope.is_empty:
            return [], 0
        where: list[Any] = []
        if status is not None:
            where.append(Listing.status == status)
        if kind is not None:
            where.append(Listing.kind == kind)
        scope_sql = listing_scope_sql(scope)
        if scope_sql is not None:
            where.append(scope_sql)
        total = int(
            self._session.scalar(select(func.count()).select_from(_scoped_from()).where(*where))
            or 0
        )
        oldest_first = status is ListingStatus.PENDING
        rows = self._session.execute(
            select(Listing, User.display_name)
            .select_from(_scoped_from())
            .outerjoin(User, User.id == Listing.owner_id)
            .where(*where)
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

    def counts_by_status(self, scope: ScopeFilter) -> dict[ListingStatus, int]:
        """Per-status counts restricted to ``scope``. A ``none()`` filter returns zeros, so a
        Moderator with no effective scope sees empty counts, not a global snapshot."""
        empty = dict.fromkeys(ListingStatus, 0)
        if scope.is_empty:
            return empty
        where: list[Any] = []
        scope_sql = listing_scope_sql(scope)
        if scope_sql is not None:
            where.append(scope_sql)
        rows = self._session.execute(
            select(Listing.status, func.count())
            .select_from(_scoped_from())
            .where(*where)
            .group_by(Listing.status)
        ).all()
        counts = empty
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

    def guarded_provider_update(
        self, listing_id: uuid.UUID, expected_revision: int, values: dict[str, Any]
    ) -> bool:
        """``UPDATE listings SET …, revision = revision + 1 WHERE id AND kind = 'provider' AND
        revision = :expected AND status <> 'archived'`` — the staff counterpart of the owner
        write's guarded update, with NO ownership predicate (a Provider has no owner) and the kind
        pinned so this statement can never touch any other listing. ``False`` = zero rows
        matched."""
        result = self._session.execute(
            update(Listing)
            .where(
                Listing.id == listing_id,
                Listing.kind == ListingKind.PROVIDER,
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

    def expire_all(self) -> None:
        self._session.expire_all()
