"""Admin moderation decisions: approve, reject, and the approved -> rejected takedown (Phase 12E;
docs/backend/API_CONTRACT.md §10.3-§10.4, BACKEND_ARCHITECTURE.md §5.1).

One transaction per decision: the listing row is locked ``FOR UPDATE``, the status and revision are
checked, the status is moved by a ``UPDATE … WHERE revision = :reviewed AND status = :from`` (so a
stale decision is refused even if the lock were bypassed), and the history row is appended — all or
nothing. Order of refusal: unknown listing (``404``) → wrong status (``409
invalid_state_transition``, from ``moderation_rules``) → stale revision (``409 listing_conflict``).

Moderation never edits content and never changes ``revision`` (it acts on the reviewed one), so the
search document is unaffected: public visibility is decided by ``status`` in the public queries, and
the status flips atomically with this commit.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.db.session import transaction
from app.models import Listing, ListingStatusHistory
from app.models.enums import ActorRole
from app.repositories.admin_listings import AdminListingRepository
from app.services.listing_state import problem
from app.services.listing_writes import (
    invalid_transition,
    not_found,
    parse_listing_id,
    stale_revision,
)
from app.services.moderation_rules import (
    HISTORY_ACTION,
    ModerationAction,
    normalize_reason,
    reason_problem,
    target_status,
)


class ModerationService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._listings = AdminListingRepository(session)

    def decide(
        self,
        admin_id: uuid.UUID,
        raw_id: str,
        action: ModerationAction,
        revision: int,
        reason: str | None = None,
    ) -> Listing:
        """Approve or reject the listing the admin reviewed at ``revision``; returns it reloaded."""
        listing_id = parse_listing_id(raw_id)
        clean_reason: str | None = None
        if action is ModerationAction.REJECT:
            clean_reason = normalize_reason(reason or "")
            issue = reason_problem(clean_reason)
            if issue is not None:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    status_code=422,
                    details=[problem("reason", issue[0], issue[1])],
                )

        with transaction(self._session):
            listing = self._listings.get(listing_id, lock=True)
            if listing is None:
                raise not_found()
            new_status = target_status(action, listing.status)
            if new_status is None:
                raise invalid_transition()
            if listing.revision != revision:
                raise stale_revision(listing.revision)
            previous = listing.status
            if not self._listings.guarded_status_update(
                listing_id, expected_revision=revision, from_status=previous, to_status=new_status
            ):
                raise stale_revision(listing.revision)  # defensive: the row lock prevents this
            self._listings.record_history(
                ListingStatusHistory(
                    listing_id=listing_id,
                    from_status=previous,
                    to_status=new_status,
                    action=HISTORY_ACTION[action],
                    revision=revision,
                    actor_user_id=admin_id,
                    actor_role=ActorRole.ADMIN,
                    reason=clean_reason,
                )
            )
            self._listings.expire_all()
        reloaded = self._listings.get(listing_id)
        if reloaded is None:  # pragma: no cover - the row was just written by this transaction
            raise not_found()
        return reloaded
