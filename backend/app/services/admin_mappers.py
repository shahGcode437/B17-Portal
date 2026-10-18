"""ORM -> ADMIN schemas (Phase 12E): the third mapper beside the public and the owner ones.

The admin detail is the owner shape (the private location included — a moderator may see exactly
where the pin is) plus the submitter's display name and the moderation history. It is built FROM the
owner mapper so the two can never disagree about the content; the public mapper is untouched and the
public repository still never loads a private column. Nothing here reads an e-mail, a password hash,
a session or a token.
"""

from app.models import Listing, ListingStatusHistory
from app.models.enums import BusinessVertical, ListingKind
from app.schemas.admin import (
    AdminActor,
    AdminBusiness,
    AdminHistoryEntry,
    AdminListing,
    AdminListingSummary,
    AdminProperty,
    AdminProvider,
    AdminSubmitter,
    AdminTutor,
)
from app.services.owner_mappers import map_owner_listing

_ADMIN_CLASS = {
    ListingKind.PROVIDER: AdminProvider,
    ListingKind.BUSINESS: AdminBusiness,
    ListingKind.TUTOR: AdminTutor,
    ListingKind.PROPERTY: AdminProperty,
}


def map_submitter(display_name: str | None) -> AdminSubmitter | None:
    return AdminSubmitter(display_name=display_name) if display_name else None


def map_history(rows: list[tuple[ListingStatusHistory, str]]) -> list[AdminHistoryEntry]:
    return [
        AdminHistoryEntry(
            action=entry.action,
            from_status=entry.from_status,
            to_status=entry.to_status,
            revision=entry.revision,
            reason=entry.reason,
            actor=AdminActor(display_name=actor_name, role=entry.actor_role),
            created_at=entry.created_at,
        )
        for entry, actor_name in rows
    ]


def map_admin_listing(
    listing: Listing,
    *,
    submitter_name: str | None,
    history: list[tuple[ListingStatusHistory, str]],
    rejection_reason: str | None,
) -> AdminListing:
    """The full review shape of one listing, in any status."""
    owner = map_owner_listing(listing, rejection_reason=rejection_reason)
    admin_class = _ADMIN_CLASS[listing.kind]
    return admin_class(  # type: ignore[no-any-return]
        **owner.model_dump(),
        submitter=map_submitter(submitter_name),
        history=map_history(history),
    )


def map_admin_summary(listing: Listing, submitter_name: str | None) -> AdminListingSummary:
    """One queue row. Reads only columns that are loaded on the light queue path (never the private
    point, address or landmark)."""
    vertical: BusinessVertical | None = None
    if listing.kind is ListingKind.BUSINESS and listing.business is not None:
        vertical = listing.business.vertical
    primary = listing.categories[0].category if listing.categories else None
    return AdminListingSummary(
        id=listing.id,
        kind=listing.kind,
        vertical=vertical,
        title=listing.title,
        area=listing.area,
        block=listing.block,
        location_visibility=listing.location_visibility,
        category_label=primary.name if primary else "",
        status=listing.status,
        revision=listing.revision,
        featured=True if listing.is_featured else None,
        submitted_at=listing.submitted_at,
        updated_at=listing.updated_at,
        submitter=map_submitter(submitter_name),
    )
