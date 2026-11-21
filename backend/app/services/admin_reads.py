"""The moderation queue and the review detail (Phase 12E; RBAC-B adds scope + Moderator privacy).

Read-only; staff routes only. No transaction beyond the session default and nothing is written.

The queue, the counts and the detail are all driven by **one** :class:`ScopeFilter`, derived from
the live Principal — there is no separate unscoped read path a future route could stumble into. A
Moderator's queue, counts and direct-id detail all answer only for listings in their effective
scope; a listing outside their scope is indistinguishable from a missing one (same ``404`` body).

The detail shape depends on authority:
  * **Super Admin** gets the full admin shape (the private exact location, address and landmark),
    exactly as Phase 12E delivered.
  * **Moderator** gets the same shape with the location projected down to what the public sees
    (``AUTH_RBAC.md §27.10``) — no raw latitude / longitude, no private address or landmark for
    approximate / area-only listings. The Moderator's projection is produced by a controlled
    serializer, not a second schema, so the two views can never drift.
"""

import uuid

from sqlalchemy.orm import Session

from app.models import Listing
from app.models.enums import ListingStatus, RoleName
from app.repositories.admin_listings import AdminListingRepository
from app.repositories.owner_listings import LatestRejection, OwnerListingRepository
from app.schemas.admin import (
    AdminListing,
    AdminListingsMeta,
    AdminListingsQuery,
    AdminListingSummary,
)
from app.schemas.read import LocationRead
from app.schemas.write import OwnerLocation, StatusCounts
from app.services.admin_mappers import map_admin_listing, map_admin_summary
from app.services.auth_sessions import Principal
from app.services.listing_writes import not_found, parse_listing_id
from app.services.staff_scopes import ScopeFilter, scope_filter_for


class AdminListingReadService:
    def __init__(self, session: Session, principal: Principal) -> None:
        self._listings = AdminListingRepository(session)
        self._owner_listings = OwnerListingRepository(session)
        self._principal = principal
        self._scope: ScopeFilter = scope_filter_for(principal)

    @property
    def is_super_admin(self) -> bool:
        return RoleName.ADMIN in self._principal.roles

    def queue(
        self, query: AdminListingsQuery
    ) -> tuple[list[AdminListingSummary], AdminListingsMeta]:
        """One page of the staff's queue, plus the per-status counts WITHIN the same scope. A
        client-supplied ``kind`` narrows the page without widening authority."""
        rows, total = self._listings.page(
            self._scope,
            status=query.status,
            kind=query.kind,
            limit=query.limit,
            offset=query.offset,
        )
        counts = self._listings.counts_by_status(self._scope)
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
        """The detail of one listing visible in the actor's scope. Out-of-scope is ``404``."""
        listing = self._listings.get(parse_listing_id(raw_id), self._scope)
        if listing is None:
            raise not_found()
        return self.present(listing)

    def present(self, listing: Listing) -> AdminListing:
        rejection = self._rejection(listing.id, listing.status)
        detail = map_admin_listing(
            listing,
            submitter_name=self._listings.submitter_name(listing.owner_id),
            history=self._listings.history(listing.id),
            rejection_reason=rejection.reason if rejection else None,
            taken_down=bool(rejection and rejection.taken_down),
        )
        if not self.is_super_admin:
            detail = detail.model_copy(
                update={"location": _public_only_location(detail.public_location)}
            )
        return detail

    def _rejection(self, listing_id: uuid.UUID, status: ListingStatus) -> LatestRejection | None:
        if status is not ListingStatus.REJECTED:
            return None
        return self._owner_listings.latest_rejections([listing_id]).get(listing_id)


def _public_only_location(public: LocationRead) -> OwnerLocation:
    """A Moderator sees no precision beyond the public projection (``AUTH_RBAC.md §27.10``).

    The ONLY input is ``public`` — the listing's ``publicLocation``, which ``map_location`` (the
    function the public API itself uses) already produced — so this cannot read a stored private
    column: not the raw point, not ``address``, not ``landmark``. What the public would see for the
    listing is exactly what the Moderator's ``location`` carries (an ``exact`` listing's public
    point, address and landmark; an ``approximate`` one's rounded point and nothing else; an
    ``area_only`` one's block and nothing else). A Super Admin bypasses this projection.
    """
    point = public.coordinates
    return OwnerLocation(
        visibility=public.visibility,
        block=public.block,
        address=public.address,
        landmark=public.landmark,
        latitude=point.latitude if point is not None else None,
        longitude=point.longitude if point is not None else None,
    )
