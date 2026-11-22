"""Portal Service requests: the PROVIDER side of a request, handled by staff (RBAC-D;
docs/backend/AUTH_RBAC.md §31, API_CONTRACT.md §16).

A Service / Professional listing is portal-managed and has no owner, so a Service request to it is a
PORTAL request: it is addressed to B-17 Portal, not to whoever authored the Provider, and nothing
about it depends on that person (or on anyone's ownership of anything). It is handled by

* a Super Admin, and
* a Moderator who holds the ``services`` scope RIGHT NOW,

and by nobody else — not another-scope Moderator, not a Professional, not the resident who sent it
(who keeps the requester's own API: read, list, cancel). The lifecycle is exactly the existing one
(``request_rules``): ``submitted -> accepted -> in-progress -> completed``, and the provider-side
cancel (the "decline" of a request nobody wants to take) from any non-terminal status. The staff
member acts in the PROVIDER capacity: the history row carries their real user id as the actor and
``provider`` as the role, so the requester's view of the story is unchanged and the audit says who.

Authority for a write is read AND LOCKED inside the transaction and stays locked until it ends, like
a moderation decision and a Provider write: the request-start ``Principal`` is only the front door
(``require_services_staff``) and is never the authority. Sequence (``BEGIN`` … ``COMMIT``):

1. ``SELECT … FOR UPDATE`` the REQUEST row (the same single row lock the requester's cancel takes);
2. ``users`` of the actor ``FOR KEY SHARE``, then their staff role in ``user_roles`` ``FOR SHARE`` —
   no staff role now: ``403`` whatever the id (an existing and a missing request are
   indistinguishable to someone who just lost authority);
3. a missing request, and a Moderator without the ``services`` scope — the ONE ``staff_scope_
   assignments`` row locked ``FOR SHARE`` — are the same ``404`` (an out-of-scope id is never
   confirmed). The scope is derived from the request's own target listing (``listing_scope`` of its
   KIND: ``services`` for a Provider); a request whose listing is gone is unmapped and is Super
   Admin only;
4. the existing lifecycle: ``403`` for an action the provider side never has, ``409
   invalid_state_transition``, then a guarded ``UPDATE … WHERE status = :from`` and ONE history row.

LOCK ORDER: ``service_requests`` (row) → ``users`` (KEY SHARE) → ``user_roles`` (SHARE) →
``staff_scope_assignments`` (one row, SHARE). Nothing here takes a listing or taxonomy lock. An
RBAC-B decision and a Provider write take ``listings`` (not request rows) and then ``users`` →
``user_roles`` → scopes; a staff-management mutation takes the staff-authority advisory lock →
``users`` (``FOR UPDATE``) → ``user_roles`` → scopes and never a request or a listing; a request
create takes the requester's advisory lock → the listing ``FOR SHARE`` and then INSERTS a new
request row. So no pair of them can wait on each other in a cycle, and a revoke that commits first
fails the action while one that arrives later waits for it (tested deterministically in both
orders).

Reads (the queue, the detail) use the request-start principal: a read is stale for at most its own
duration and changes nothing. The queue is a COLLECTION that exists only for services authority:
``403`` for any other staff member. A direct id a Moderator holds no ``services`` scope for is the
same ``404`` as a missing one.
"""

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.db.session import transaction
from app.models.enums import CategoryModule, RequestActorRole, RoleName
from app.repositories.service_requests import RequestRow, ServiceRequestRepository
from app.repositories.staff import StaffAuthorityRepository
from app.schemas.envelope import PageMeta
from app.schemas.requests import LeadSummary, RequestsQuery, ServiceRequestDetail
from app.services.auth_sessions import Principal
from app.services.request_mappers import map_detail, map_lead
from app.services.request_rules import (
    RequestAction,
    can_transition,
    has_authority,
    target_status,
)
from app.services.service_requests import invalid_transition, not_found, parse_id
from app.services.staff_scopes import effective_staff_scopes, listing_scope

#: The role a staff member acts in on a request: the provider side. Their user id is the actor.
STAFF_ROLE = RequestActorRole.PROVIDER


def _forbidden() -> AppError:
    return AppError(ErrorCode.FORBIDDEN, status_code=403)


def request_scope(row: RequestRow) -> CategoryModule | None:
    """The staff scope that handles ``row``, from its target listing's KIND (never from the request
    or a client): ``services`` for a Provider, ``None`` (unmapped: Super Admin only) when the
    listing no longer exists."""
    if row.provider_kind is None:
        return None
    return listing_scope(row.provider_kind, None)


def may_read(principal: Principal, row: RequestRow) -> bool:
    """Read access from the request-start principal: a Super Admin, or a Moderator whose effective
    scopes include the request's scope."""
    if principal.is_super_admin:
        return True
    scope = request_scope(row)
    return scope is not None and scope in effective_staff_scopes(principal.staff_scopes)


class PortalRequestService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._requests = ServiceRequestRepository(session)
        self._authority = StaffAuthorityRepository(session)

    # -- reads -----------------------------------------------------------------------------------

    def queue(
        self, principal: Principal, query: RequestsQuery
    ) -> tuple[list[LeadSummary], PageMeta]:
        """The portal's Service request queue, newest first. ``403`` unless the actor is a Super
        Admin or holds the ``services`` scope (a collection, so no per-id concealment applies)."""
        if not (
            principal.is_super_admin
            or CategoryModule.SERVICES in effective_staff_scopes(principal.staff_scopes)
        ):
            raise _forbidden()
        total, rows = self._requests.portal_page(query.status, query.limit, query.offset)
        meta = PageMeta(total=total, limit=query.limit, offset=query.offset)
        return [map_lead(request, name) for request, name in rows], meta

    def get(self, principal: Principal, raw_id: str) -> ServiceRequestDetail:
        row = self._requests.get(parse_id(raw_id))
        if row is None or not may_read(principal, row):
            raise not_found()  # missing and out-of-scope are indistinguishable
        return self.present(row)

    def present(self, row: RequestRow) -> ServiceRequestDetail:
        return map_detail(
            row.request, row.requester_name, STAFF_ROLE, self._requests.history(row.request.id)
        )

    # -- the staff side of the lifecycle ---------------------------------------------------------

    def act(self, principal: Principal, raw_id: str, action: RequestAction) -> RequestRow:
        """Apply ``action`` as portal staff and return the request as it now stands. The actor is
        the session's user; what they may do is read and LOCKED here, never taken from the
        principal."""
        request_id = parse_id(raw_id)
        actor_id = principal.user_id
        with transaction(self._session):
            row = self._requests.get(request_id, lock=True)  # 1. the request row

            # 2. the actor's authority, read AND locked (users -> user_roles)
            self._authority.key_share_user(actor_id)
            roles = self._authority.share_staff_roles(actor_id)
            is_super_admin = RoleName.ADMIN in roles
            if not (is_super_admin or RoleName.MODERATOR in roles):
                raise _forbidden()  # revoked since the request began: whatever the id
            if row is None:
                raise not_found()

            # 3. scope, from the LOCKED request's own target; a Moderator proves it with one row
            if not is_super_admin:
                scope = request_scope(row)
                if scope is None or not self._authority.share_moderator_scope(actor_id, scope):
                    raise not_found()  # same answer as a request that does not exist

            # 4. the existing lifecycle, in the provider capacity
            if not has_authority(action, STAFF_ROLE):  # pragma: no cover - no such action exists
                raise _forbidden()
            current = row.request.status
            if not can_transition(action, STAFF_ROLE, current):
                raise invalid_transition()
            target = target_status(action)
            if not self._requests.guarded_status_update(
                request_id, from_status=current, to_status=target
            ):  # pragma: no cover - the row lock makes this unreachable; kept as the safety net
                raise invalid_transition()
            self._requests.record_history(
                request_id,
                from_status=current,
                to_status=target,
                actor_user_id=actor_id,  # the ACTUAL staff member, never an owner or a stand-in
                actor_role=STAFF_ROLE,
            )
        refreshed = self._requests.get(request_id)
        assert refreshed is not None
        return refreshed
