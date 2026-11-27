"""Admin moderation decisions: approve, reject, and the approved -> rejected takedown.

Phase 12E introduced the lifecycle guards (``docs/backend/API_CONTRACT.md §10.3-§10.4``,
``BACKEND_ARCHITECTURE.md §5.1``); RBAC-B (``docs/backend/AUTH_RBAC.md §27.4, §27.8, §28``) layered
the staff-authority rule on top of them.

One transaction per decision. **Authority is read and LOCKED inside it, and stays locked until it
ends**, so a concurrent revoke or demotion either committed before the decision looked (the decision
fails) or has to wait until the decision is over (the decision linearises first). The request-start
``Principal`` is only the front door (``require_staff``); it is never the authority for a decision.

Sequence (``BEGIN`` … ``COMMIT``):

1. ``SELECT ... FOR UPDATE`` the listing row.
2. ``FOR SHARE`` the actor's ``users`` row and then the ACTING SESSION
   (``hold_acting_session``; see the lock order below for why they are here).
3. ``FOR SHARE`` the actor's CURRENT staff role row in ``user_roles`` (``admin`` / ``moderator``).
   No staff role at all (revoked since the request began) → ``403 forbidden``, whatever the id —
   the same answer for an existing and a missing listing, so it reveals nothing. Then the
   session: revoked, expired or its account no longer active → ``401 session_expired``,
   likewise whatever the id.
4. Derive the listing's scope from the LOCKED row (``listing_scope``): a Business that its owner
   just moved General -> Food is Food now. A Moderator then ``FOR SHARE``-locks the ONE
   ``staff_scope_assignments`` row that proves they hold that scope; no row → ``404``, the same
   answer as a listing that does not exist (an out-of-scope id is never confirmed).
5. Self-moderation (``AUTH_RBAC.md §27.8``): nobody - Moderator or Super Admin - decides on a
   listing they personally OWN (``owner_id`` equals the actor): ``403 self_moderation_forbidden``.
   There is no override. (RBAC-D removed the temporary Super Admin exception for an own Service /
   Professional listing: a Provider is portal-managed and has no owner, so there is nothing to
   override and nothing to exempt. A Provider's author is recorded in the staff audit and in
   ``listing_status_history``, not in ``owner_id``.)
6. Lifecycle as in Phase 12E: ``target_status(action, status)``, stale-revision check, guarded
   ``UPDATE ... WHERE revision = :reviewed AND status = :from``.
7. History row (``actor_role = admin`` for a Super Admin, ``moderator`` for a Moderator).
   ``COMMIT`` releases every lock.

Order of refusal: CSRF / Origin → ``require_staff`` / ``require_super_admin`` (``401`` / ``403``) →
no staff role now (``403``) → session ended
(``401``) → listing missing or out of scope (``404``) → self-moderation (``403
self_moderation_forbidden``) → wrong status (``409 invalid_state_transition``) → stale revision
(``409 listing_conflict``).

LOCK ORDER (the only one — a future staff mutation must follow it too)::

    listings (row)  →  users (actor, SHARE)  →  auth_sessions (acting session, SHARE)
                    →  user_roles (actor's staff row, SHARE)
                    →  staff_scope_assignments (actor's one scope row, SHARE)

* A staff mutation (``StaffAuthorityService``, RBAC-C) takes the staff-authority advisory lock,
  then locks ``users`` (``FOR UPDATE``) → ``user_roles`` → ``staff_scope_assignments`` and
  **never locks a listing**. Both sides therefore walk ``users → user_roles → scopes`` in the same
  direction and neither holds, while waiting, a lock the other needs: no cycle is possible.
* The ``users`` lock is taken early on purpose. The history row's foreign key to ``users`` would
  lock that row anyway (late), and a role change holding ``users FOR UPDATE`` while waiting for the
  ``user_roles`` row this decision already holds would deadlock. Taken first, the role change waits
  before the decision holds any authority row, or the decision waits before it holds one.
* Moderation takes no ``professional_profiles`` or taxonomy lock (owner writes take profile →
  listing), so it cannot cycle with an owner write either.
* Many decisions run in parallel: ``FOR SHARE`` locks are compatible with each other and with
  the foreign-key checks of unrelated writes.

Moderation never edits content and never changes ``revision``, so the search document is
unaffected: public visibility is decided by ``status`` in the public queries, and the status flips
atomically with this commit.
"""

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode, ErrorDetail
from app.db.session import transaction
from app.models import Listing, ListingStatusHistory
from app.models.enums import ActorRole, RoleName
from app.repositories.admin_listings import AdminListingRepository
from app.repositories.staff import StaffAuthorityRepository
from app.services.auth_sessions import Principal, hold_acting_session
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
from app.services.staff_scopes import ScopeFilter, listing_scope


def self_moderation_forbidden() -> AppError:
    """A staff member cannot moderate content they own (``AUTH_RBAC.md §27.8``)."""
    return AppError(
        ErrorCode.FORBIDDEN,
        status_code=403,
        details=[
            ErrorDetail(
                field="request",
                code="self_moderation_forbidden",
                message="A moderator or administrator cannot decide on their own listing.",
            )
        ],
    )


class ModerationService:
    def __init__(self, session: Session, *, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._listings = AdminListingRepository(session)
        self._authority = StaffAuthorityRepository(session)

    def decide(
        self,
        principal: Principal,
        raw_id: str,
        action: ModerationAction,
        revision: int,
        *,
        reason: str | None = None,
    ) -> Listing:
        """Decide on the listing the actor reviewed at ``revision``; returns it reloaded.

        ``principal`` identifies WHO is acting (``user_id``, ``session_id``); what they may do is
        read and locked from the database inside the transaction, never taken from it.
        """
        listing_id = parse_listing_id(raw_id)
        actor_id = principal.user_id

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
            # 1. The listing row first: everything below is decided against its CURRENT state.
            listing = self._listings.lock_for_decision(listing_id)

            # 2-3. The actor, their session and authority, read AND locked (users ->
            # auth_sessions -> user_roles). From here until COMMIT / ROLLBACK a revocation,
            # reset, revoke or demotion of this actor waits for this transaction.
            acting = hold_acting_session(
                self._authority, actor_id, principal.session_id, self._clock
            )
            staff_roles = self._authority.share_staff_roles(actor_id)
            is_super_admin = RoleName.ADMIN in staff_roles
            is_moderator = RoleName.MODERATOR in staff_roles
            if not (is_super_admin or is_moderator):
                # Revoked since the request began. Answered BEFORE the listing is looked at, so an
                # existing and a missing id are indistinguishable to someone who lost authority.
                raise AppError(ErrorCode.FORBIDDEN, status_code=403)
            acting.require()
            if listing is None:
                raise not_found()

            # 4. Scope from the LOCKED row, then proof that the actor holds it (one scope row).
            reload_scope = ScopeFilter.all()
            if not is_super_admin:
                vertical = listing.business.vertical if listing.business is not None else None
                derived_scope = listing_scope(listing.kind, vertical)
                if derived_scope is None or not self._authority.share_moderator_scope(
                    actor_id, derived_scope
                ):
                    raise not_found()  # same answer as a listing that does not exist
                reload_scope = ScopeFilter.of({derived_scope})

            # 5. Self-moderation: nobody decides on a listing they personally own. A Provider has
            # no owner (RBAC-D), so this can never apply to one — and there is no override.
            if listing.owner_id is not None and listing.owner_id == actor_id:
                raise self_moderation_forbidden()

            # 6. Lifecycle.
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

            # 7. History, same transaction.
            self._listings.record_history(
                ListingStatusHistory(
                    listing_id=listing_id,
                    from_status=previous,
                    to_status=new_status,
                    action=HISTORY_ACTION[action],
                    revision=revision,
                    actor_user_id=actor_id,
                    actor_role=ActorRole.ADMIN if is_super_admin else ActorRole.MODERATOR,
                    reason=clean_reason,
                )
            )
            self._listings.expire_all()
        reloaded = self._listings.get(listing_id, reload_scope)
        if reloaded is None:  # pragma: no cover - the row was just written by this transaction
            raise not_found()
        return reloaded
