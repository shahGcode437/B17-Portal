"""Staff Provider authoring: create, edit, archive (RBAC-D; docs/backend/AUTH_RBAC.md §31).

**A Service / Professional ("provider") listing is a PORTAL-MANAGED resource, not a personally owned
one.** It has no owner (``listings.owner_id IS NULL``, enforced by the CHECK
``ck_listings_provider_has_no_owner``), no Professional Profile stands behind it and no plan quota
counts it. Who may author one is a question about the actor's LIVE staff authority and nothing else:

* a Super Admin may create and manage any Provider;
* a Moderator may create and manage Providers while they hold the ``services`` scope;
* nobody else may — not another-scope Moderator, a Moderator with no scope, a Professional, a
  Resident, an unverified or anonymous caller.

This is the ONLY service that writes a Provider. The owner write API (``ListingWriteService``)
refuses a Provider for everyone, so there is no second path: a future endpoint that wants to
author a Provider must call this class. Demoting, pausing or removing the staff member who created
a Provider changes nothing about the Provider — it was never attached to them — and their
authorship stays in the append-only ``staff_audit_events`` (``provider_created`` /
``provider_updated`` / ``provider_archived``) and, for lifecycle moves, in
``listing_status_history`` with the ``admin`` / ``moderator`` actor role. Moderation decisions are
NOT duplicated into the staff audit: they stay in ``listing_status_history``
(``ModerationService``).

Authority is read AND LOCKED inside the transaction and stays locked until it ends, exactly like a
moderation decision (``app/services/moderation.py``): the request-start ``Principal`` is the front
door only and is never the authority, so a revoke or demotion either committed before the write
looked (the write fails) or waits until the write is over (the write linearises first). Nothing is
taken from the request body, the URL, a header or a stale ``Principal`` scope: the kind is the
LOCKED row's, the scope is always ``services`` (a Provider's scope — ``staff_scopes.listing_scope``)
and the actor is always the session's user.

Sequence of every operation (``BEGIN`` … ``COMMIT``):

* **create** — taxonomy advisory lock (SHARED) → ``users`` → the acting session → ``user_roles``
  (all ``FOR SHARE``) → for a Moderator, the one ``staff_scope_assignments`` row for ``services``
  (``FOR SHARE``) → validate → ``INSERT`` listing + categories + history → search document → staff
  audit. No staff role → ``403``; a Moderator without ``services`` → ``403``.
* **edit / archive** — (edit only: taxonomy advisory lock, SHARED) → ``listings`` row ``FOR UPDATE``
  (restricted to ``kind = 'provider'`` in the locking query) → ``users`` → acting session →
  ``user_roles`` → scope row, then the lifecycle exactly as for any listing. No staff role → ``403``
  whatever the id (so an existing and a missing id are indistinguishable to someone who lost
  authority); a missing id, a non-Provider id and an id a Moderator has no ``services`` scope for
  are all the same ``404``.

LOCK ORDER (one global order, ``AUTH_RBAC.md §31``)::

    taxonomy advisory (shared)  →  listings (row)  →  users (SHARE)  →  auth_sessions (SHARE)
                                →  user_roles (SHARE)
                                →  staff_scope_assignments (one row, SHARE)

* RBAC-B moderation takes ``listings → users → user_roles → scopes`` (no taxonomy lock): the same
  relative order, so the two cannot wait on each other in a cycle.
* RBAC-C staff management takes the staff-authority advisory lock → ``users`` (``FOR UPDATE``) →
  ``user_roles`` → scopes and NEVER a listing nor the taxonomy lock, so it cannot hold anything an
  authoring transaction needs while it waits.
* Taxonomy administration takes the taxonomy lock EXCLUSIVELY first and every listing writer takes
  it SHARED first, so a rename / reindex never interleaves with a write that read the old name.
* There is deliberately NO global lock around ordinary Provider authoring: two staff members
  authoring different Providers run in parallel; only writes to the SAME row serialise.

The staff audit row is written in the same transaction as the change (``flush`` only): a failure at
any later step — including the audit write itself — rolls back the whole operation.

Lifecycle (unchanged from every listing): a new Provider is ``pending`` at ``revision 1``; an
effective MATERIAL edit returns it to ``pending`` (``resubmitted`` history row, ``submitted_at``
reset) so it is moderated again, a pure visibility NARROWING keeps its status, a no-op writes
nothing; ``archived`` is terminal (no restore exists). Approval is a separate act by staff with the
``services`` scope.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError, ErrorCode
from app.db.session import transaction
from app.models import Listing, ListingCategory, ListingStatusHistory
from app.models.enums import (
    ActorRole,
    HistoryAction,
    ListingKind,
    ListingStatus,
    RoleName,
    StaffAuditAction,
    StaffAuditResource,
    StaffAuditSource,
    StaffScope,
)
from app.repositories.admin_listings import AdminListingRepository
from app.repositories.owner_listings import OwnerListingRepository
from app.repositories.staff import StaffAuthorityRepository
from app.repositories.taxonomy import CategoryRepository
from app.schemas.provider_admin import ProviderCreateRequest, ProviderPatchRequest
from app.schemas.write import ListingPatch, ProviderCreate
from app.services.auth_sessions import Principal, hold_acting_session
from app.services.listing_state import (
    Change,
    ListingState,
    apply_patch,
    classify_change,
    problem,
    state_from_create,
    validate_state,
)
from app.services.listing_writes import (
    ListingInvariantError,
    base_values,
    category_structure_problems,
    invalid_transition,
    not_found,
    parse_listing_id,
    resolve_category_ids,
    stale_revision,
    state_of,
    validation_error,
)
from app.services.search_index import SearchIndexer
from app.services.staff_audit import StaffAuditService
from app.services.staff_scopes import ScopeFilter

#: The one scope that confers Provider authority (``staff_scopes.listing_scope(PROVIDER) ==
#: SERVICES``). A constant, never derived from a request.
PROVIDER_SCOPE = StaffScope.SERVICES

#: The fields a Provider edit can change, in the API's vocabulary (what the audit's
#: ``changed_fields`` lists — never the values, which may include a private location).
_CHANGEABLE_FIELDS = ("name", "category", "area", "description", "tags", "image", "location")


def _forbidden() -> AppError:
    return AppError(ErrorCode.FORBIDDEN, status_code=403)


@dataclass(frozen=True)
class _Authority:
    """What the LOCKED rows say the actor is, for the length of one transaction."""

    is_super_admin: bool

    @property
    def history_role(self) -> ActorRole:
        return ActorRole.ADMIN if self.is_super_admin else ActorRole.MODERATOR


def changed_fields(old: ListingState, new: ListingState) -> list[str]:
    """The API names of the content fields that differ between two Provider states."""
    differing = {
        "name": old.title != new.title,
        "category": old.category != new.category,
        "area": old.area != new.area,
        "description": old.description != new.description,
        "tags": old.tags != new.tags,
        "image": old.image != new.image,
        "location": old.location != new.location,
    }
    return [name for name in _CHANGEABLE_FIELDS if differing[name]]


def _as_create(payload: ProviderCreateRequest) -> ProviderCreate:
    """The (already validated) staff body as the shared create shape. The ``kind`` is fixed HERE, by
    the route's purpose — there is no ``kind`` field in the staff body to forge."""
    return ProviderCreate.model_construct(
        kind="provider",
        name=payload.name,
        category=payload.category,
        area=payload.area,
        description=payload.description,
        tags=payload.tags,
        image=payload.image,
        location=payload.location,
    )


def _as_patch(payload: ProviderPatchRequest) -> ListingPatch:
    """The (already validated) staff PATCH as the shared patch shape, carrying exactly the fields
    the client sent (``null`` and omitted stay different)."""
    return ListingPatch.model_construct(
        **{name: getattr(payload, name) for name in payload.model_fields_set}
    )


class ProviderAuthoringService:
    def __init__(self, session: Session, *, localities: list[str], clock: Clock) -> None:
        self._session = session
        self._localities = localities
        self._clock = clock
        self._admin = AdminListingRepository(session)
        self._listings = OwnerListingRepository(session)
        self._authority = StaffAuthorityRepository(session)
        self._categories = CategoryRepository(session)
        self._search_index = SearchIndexer(session)
        self._audit = StaffAuditService(session, clock)

    # -- create ----------------------------------------------------------------------------------

    def create(self, principal: Principal, payload: ProviderCreateRequest) -> Listing:
        """A new ``pending`` Provider with NO owner; the actor is the session's user, never a field.

        Raises ``403`` when the actor holds no staff role now or, as a Moderator, no ``services``
        scope now; ``422`` for an invalid body or category. Atomic: the row, its categories, the
        history row, the search document and the audit row commit together or not at all."""
        actor_id = principal.user_id
        with transaction(self._session):
            self._categories.lock_taxonomy_shared()  # first: see taxonomy_admin.py
            authority = self._lock_authority(principal)
            if not authority.is_super_admin and not self._authority.share_moderator_scope(
                actor_id, PROVIDER_SCOPE
            ):
                raise _forbidden()

            state, problems = state_from_create(_as_create(payload), self._localities)
            assert state is not None
            location_reported = any(item.field.startswith("location") for item in problems)
            problems.extend(validate_state(state, check_location=not location_reported))
            if problems:
                raise validation_error(problems)
            category_ids, category_problems = resolve_category_ids(
                self._categories, state, retained=set()
            )
            if category_problems:
                raise validation_error(category_problems)

            listing = self._listings.add(
                self._new_provider(actor_id, authority, state, category_ids)
            )
            listing_id = listing.id
            self._verify_categories(listing_id, state)
            self._search_index.refresh(listing)
            self._audit.record(
                StaffAuditAction.PROVIDER_CREATED,
                source=StaffAuditSource.WEB,
                actor_user_id=actor_id,
                resource_type=StaffAuditResource.LISTING,
                resource_id=listing_id,
                after={
                    "kind": ListingKind.PROVIDER.value,
                    "status": ListingStatus.PENDING.value,
                    "revision": 1,
                    "name": state.title,
                },
                session_id=principal.session_id,
            )
        return self._reload(listing_id)

    def _new_provider(
        self,
        actor_id: uuid.UUID,
        authority: _Authority,
        state: ListingState,
        category_ids: list[uuid.UUID],
    ) -> Listing:
        listing = Listing(
            kind=ListingKind.PROVIDER,
            owner_id=None,  # portal-managed: the author is recorded in the audit, never here
            status=ListingStatus.PENDING,
            revision=1,
            submitted_at=self._clock(),
            **base_values(state),
        )
        listing.categories = [
            ListingCategory(position=position, category_id=category_id)
            for position, category_id in enumerate(category_ids, start=1)
        ]
        listing.status_history.append(
            ListingStatusHistory(
                from_status=None,
                to_status=ListingStatus.PENDING,
                action=HistoryAction.SUBMITTED,
                revision=1,
                actor_user_id=actor_id,
                actor_role=authority.history_role,
            )
        )
        return listing

    # -- edit ------------------------------------------------------------------------------------

    def edit(self, principal: Principal, raw_id: str, payload: ProviderPatchRequest) -> Listing:
        """Edit (and, if the change is material, return to ``pending``) one Provider at the
        ``revision`` the actor read. ``archived`` is terminal (``409 invalid_state_transition``); a
        stale revision is ``409 listing_conflict``; a no-op writes nothing."""
        listing_id = parse_listing_id(raw_id)
        patch = _as_patch(payload)
        with transaction(self._session):
            self._categories.lock_taxonomy_shared()  # first: see taxonomy_admin.py
            listing = self._admin.lock_provider_for_write(listing_id)
            authority = self._authorise_existing(principal, listing)
            assert listing is not None  # _authorise_existing raised 404 otherwise
            if listing.status is ListingStatus.ARCHIVED:
                raise invalid_transition()
            if listing.revision != payload.revision:
                raise stale_revision(listing.revision)

            old = state_of(listing)
            new, problems = apply_patch(old, patch, self._localities)
            if problems:
                raise validation_error(problems)
            change = classify_change(old, new)

            if change is Change.NONE:
                if listing.status is ListingStatus.REJECTED:
                    raise validation_error(
                        [
                            problem(
                                "request",
                                "no_changes",
                                "Change something before resubmitting this listing.",
                            )
                        ]
                    )
                # Nothing is written: no revision, no timestamp, no history, no audit row.
            else:
                self._apply_edit(principal, authority, listing, old, new, change, payload.revision)
        return self._reload(listing_id)

    def _apply_edit(
        self,
        principal: Principal,
        authority: _Authority,
        listing: Listing,
        old: ListingState,
        new: ListingState,
        change: Change,
        revision: int,
    ) -> None:
        listing_id = listing.id
        previous_status = listing.status
        new_problems = validate_state(new)
        category_ids: list[uuid.UUID] | None = None
        if old.category_slugs() != new.category_slugs():
            # A category the Provider already carries stays valid even if it was deactivated since
            # (DATA_MODEL §8); a NEW one must exist, be active and be in the ``services`` module.
            category_ids, category_problems = resolve_category_ids(
                self._categories, new, retained=set(old.category_slugs())
            )
            new_problems.extend(category_problems)
        if new_problems:
            raise validation_error(new_problems)

        values = base_values(new)
        material = change is Change.MATERIAL
        if material:
            values["status"] = ListingStatus.PENDING
            values["submitted_at"] = self._clock()
        if not self._admin.guarded_provider_update(listing_id, revision, values):
            raise stale_revision(listing.revision)  # defensive: the row lock prevents this
        if category_ids is not None:
            self._listings.replace_categories(listing_id, category_ids)
        new_revision = revision + 1
        new_status = ListingStatus.PENDING if material else previous_status
        if material:
            self._admin.record_history(
                ListingStatusHistory(
                    listing_id=listing_id,
                    from_status=previous_status,
                    to_status=ListingStatus.PENDING,
                    action=HistoryAction.RESUBMITTED,
                    revision=new_revision,
                    actor_user_id=principal.user_id,
                    actor_role=authority.history_role,
                )
            )
        self._audit.record(
            StaffAuditAction.PROVIDER_UPDATED,
            source=StaffAuditSource.WEB,
            actor_user_id=principal.user_id,
            resource_type=StaffAuditResource.LISTING,
            resource_id=listing_id,
            before={"status": previous_status.value, "revision": revision},
            after={
                "status": new_status.value,
                "revision": new_revision,
                "changed_fields": changed_fields(old, new),
            },
            session_id=principal.session_id,
        )
        self._admin.expire_all()
        self._verify_categories(listing_id, new)
        reloaded = self._admin.get(listing_id, ScopeFilter.all())
        if reloaded is None:  # pragma: no cover - the row was just written by this transaction
            raise not_found()
        self._search_index.refresh(reloaded)

    # -- archive ---------------------------------------------------------------------------------

    def archive(self, principal: Principal, raw_id: str, revision: int) -> Listing:
        """Archive one Provider: terminal (no restore), the row is kept and leaves public
        discovery. ``409`` for an already-archived or stale one."""
        listing_id = parse_listing_id(raw_id)
        actor_id = principal.user_id
        with transaction(self._session):
            listing = self._admin.lock_provider_for_write(listing_id)
            authority = self._authorise_existing(principal, listing)
            assert listing is not None  # _authorise_existing raised 404 otherwise
            if listing.status is ListingStatus.ARCHIVED:
                raise invalid_transition()
            if listing.revision != revision:
                raise stale_revision(listing.revision)
            previous_status = listing.status
            if not self._admin.guarded_provider_update(
                listing_id, revision, {"status": ListingStatus.ARCHIVED}
            ):
                raise stale_revision(listing.revision)  # defensive: the row lock prevents this
            self._admin.record_history(
                ListingStatusHistory(
                    listing_id=listing_id,
                    from_status=previous_status,
                    to_status=ListingStatus.ARCHIVED,
                    action=HistoryAction.ARCHIVED,
                    revision=revision + 1,
                    actor_user_id=actor_id,
                    actor_role=authority.history_role,
                )
            )
            self._audit.record(
                StaffAuditAction.PROVIDER_ARCHIVED,
                source=StaffAuditSource.WEB,
                actor_user_id=actor_id,
                resource_type=StaffAuditResource.LISTING,
                resource_id=listing_id,
                before={"status": previous_status.value, "revision": revision},
                after={"status": ListingStatus.ARCHIVED.value, "revision": revision + 1},
                session_id=principal.session_id,
            )
            self._admin.expire_all()
        return self._reload(listing_id)

    # -- authority -------------------------------------------------------------------------------

    def _lock_authority(self, principal: Principal) -> _Authority:
        """The actor's CURRENT staff role and acting session, read and locked (``users`` →
        session → ``user_roles``, all ``SHARE``). No staff role now → ``403``; an ended session
        → ``401``. Held until COMMIT / ROLLBACK, so a revocation, revoke or demotion waits for
        this transaction."""
        acting = hold_acting_session(
            self._authority, principal.user_id, principal.session_id, self._clock
        )
        roles = self._authority.share_staff_roles(principal.user_id)
        if RoleName.ADMIN not in roles and RoleName.MODERATOR not in roles:
            raise _forbidden()
        acting.require()
        return _Authority(is_super_admin=RoleName.ADMIN in roles)

    def _authorise_existing(self, principal: Principal, listing: Listing | None) -> _Authority:
        """Authority over ONE existing Provider, from the LOCKED row. The staff role is checked
        BEFORE the listing is looked at, so a lost role is ``403`` for an existing and a missing id
        alike; then a missing Provider, and a Provider a Moderator holds no ``services`` scope for,
        are the same ``404`` (an out-of-scope id is never confirmed)."""
        authority = self._lock_authority(principal)
        if listing is None:
            raise not_found()
        if not authority.is_super_admin and not self._authority.share_moderator_scope(
            principal.user_id, PROVIDER_SCOPE
        ):
            raise not_found()
        return authority

    # -- shared ----------------------------------------------------------------------------------

    def _verify_categories(self, listing_id: uuid.UUID, state: ListingState) -> None:
        """Read the stored category rows back, INSIDE the transaction, and enforce the cross-row
        rules (exactly one, position 1, the ``services`` module); a violation rolls the write
        back."""
        problems = category_structure_problems(state, self._categories.list_for_listing(listing_id))
        if problems:
            raise ListingInvariantError("; ".join(problems))

    def _reload(self, listing_id: uuid.UUID) -> Listing:
        """The Provider this call just wrote (or, for a no-op, just read), re-read after COMMIT.

        Deliberately NOT filtered by the actor's scope: the actor was authorised under lock at the
        moment of the write, and a scope revoked a moment later must not turn a SUCCESSFUL write
        into a ``404`` the client might retry (a retried create would make a second Provider). What
        a Moderator may SEE of it is decided by the response mapper, not by this read."""
        listing = self._admin.get(listing_id, ScopeFilter.all())
        if listing is None:  # pragma: no cover - the row was just written by this transaction
            raise not_found()
        return listing
