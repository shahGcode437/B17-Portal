"""Staff scopes: what each canonical ``StaffScope`` confers, and the deny-by-default
resource -> scope mapping (docs/backend/AUTH_RBAC.md §27.3, §32). Pure functions — nothing here
touches the database.

``StaffScope`` is the one vocabulary of staff authority. Every value is exactly one of:

* a **listing scope** (``LISTING_STAFF_SCOPES``): authority over listings. These also open the staff
  front door of listing moderation, Provider management and portal Service Requests (the last two
  additionally require ``services``);
* ``grocery`` (``GROCERY_SCOPE``): authority over the Grocery domain ONLY. It confers nothing over
  listings, categories, Providers or Service Requests, and no listing ever maps to it;
* **reserved** (``RESERVED_STAFF_SCOPES``): in the vocabulary, not assignable, confers nothing.

A listing's scope is derived ONLY from the authoritative state of the listing itself — its ``kind``
and, for a Business, the ``vertical`` of its business profile. It is never derived from a category,
a request body, a URL or any frontend claim.

=============  ==================================  ==========
kind           vertical                            scope
=============  ==================================  ==========
``provider``   —                                   ``services``
``business``   ``general``                         ``directory``
``business``   ``food``                            ``food``
``tutor``      —                                   ``education``
``property``   —                                   ``property``
``business``   missing (no business profile)       none (unmapped)
=============  ==================================  ==========

``None`` means *unmapped / corrupt*: a Super Admin may still act on the resource, a Moderator may
not, whatever their scopes. News is a separate resource model (``news_articles``) and is
deliberately not reachable through ``ListingKind``.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import and_, false, or_

from app.models import Listing
from app.models.enums import BusinessVertical, ListingKind, RoleName, StaffScope

if TYPE_CHECKING:
    from sqlalchemy.sql.elements import ColumnElement

    from app.services.auth_sessions import Principal

#: The scopes that confer authority over LISTINGS. Only these open the listing-staff front door
#: and only these can appear in a ``ScopeFilter``.
LISTING_STAFF_SCOPES: frozenset[StaffScope] = frozenset(
    {
        StaffScope.SERVICES,
        StaffScope.DIRECTORY,
        StaffScope.FOOD,
        StaffScope.EDUCATION,
        StaffScope.PROPERTY,
    }
)
#: Authority over the Grocery domain, and nothing else.
GROCERY_SCOPE: StaffScope = StaffScope.GROCERY
#: Scopes a Moderator can hold today.
ASSIGNABLE_STAFF_SCOPES: frozenset[StaffScope] = LISTING_STAFF_SCOPES | {GROCERY_SCOPE}
#: ``news`` is in the canonical vocabulary but reserved: it becomes assignable only once a News
#: administration API exists (AUTH_RBAC.md §27.3, rule 5).
RESERVED_STAFF_SCOPES: frozenset[StaffScope] = frozenset({StaffScope.NEWS})

_KIND_SCOPES: Mapping[ListingKind, StaffScope] = {
    ListingKind.PROVIDER: StaffScope.SERVICES,
    ListingKind.TUTOR: StaffScope.EDUCATION,
    ListingKind.PROPERTY: StaffScope.PROPERTY,
}
_BUSINESS_SCOPES: Mapping[BusinessVertical, StaffScope] = {
    BusinessVertical.GENERAL: StaffScope.DIRECTORY,
    BusinessVertical.FOOD: StaffScope.FOOD,
}


def listing_scope(kind: ListingKind, vertical: BusinessVertical | None) -> StaffScope | None:
    """The scope of a listing, or ``None`` (unmapped: Super Admin only) — deny by default."""
    if kind is ListingKind.BUSINESS:
        return _BUSINESS_SCOPES.get(vertical) if vertical is not None else None
    return _KIND_SCOPES.get(kind)


def effective_staff_scopes(stored: Iterable[StaffScope]) -> frozenset[StaffScope]:
    """The stored scope assignments that actually confer authority: only assignable scopes count,
    so a stray ``news`` row grants nothing until a News administration API exists.

    "Authority" is not one thing: ``grocery`` is effective and still confers nothing over listings.
    A guard must ask for the authority it needs (``Principal.has_listing_authority`` /
    ``has_grocery_authority``), never for "any effective scope"."""
    return frozenset(scope for scope in stored if scope in ASSIGNABLE_STAFF_SCOPES)


class ScopeFilterKind(Enum):
    ALL = "all"
    OF = "of"
    NONE = "none"


@dataclass(frozen=True)
class ScopeFilter:
    """A listing-visibility filter (RBAC-B; docs/backend/AUTH_RBAC.md §27.4):

    * ``all()`` — Super Admin: unrestricted.
    * ``of(scopes)`` — Moderator: only listings whose derived scope is in ``scopes``.
    * ``none()`` — no staff authority: nothing is visible.

    There is NO default of "all"; a repository that forgets to pass a filter cannot compile.

    The filter comes ONLY from the actor's authority. The one client-supplied narrowing the queue
    accepts is ``?status=`` / ``?kind=``, which the repository ANDs with this filter (so it can only
    shrink the result). A ``module`` / ``scope`` query key is not a queue parameter at all: it is
    ignored, never read, and so can neither narrow nor widen anything.
    """

    kind: ScopeFilterKind
    scopes: frozenset[StaffScope] = frozenset()

    @classmethod
    def all(cls) -> "ScopeFilter":
        return cls(ScopeFilterKind.ALL)

    @classmethod
    def of(cls, scopes: Iterable[StaffScope]) -> "ScopeFilter":
        """Only LISTING scopes survive: ``grocery`` and ``news`` alone make an empty filter."""
        allowed = frozenset(scopes) & LISTING_STAFF_SCOPES
        return cls.none() if not allowed else cls(ScopeFilterKind.OF, allowed)

    @classmethod
    def none(cls) -> "ScopeFilter":
        return cls(ScopeFilterKind.NONE)

    @property
    def is_empty(self) -> bool:
        return self.kind is ScopeFilterKind.NONE


def scope_filter_for(principal: "Principal") -> ScopeFilter:
    """The listing scope filter for the READ routes (queue, counts, detail), from the principal
    ``require_staff`` resolved at the start of the request — a read is stale for at most its own
    duration and changes nothing. A DECISION never uses this: ``ModerationService.decide`` reads and
    locks the actor's authority rows inside its transaction instead."""
    if RoleName.ADMIN in principal.roles:
        return ScopeFilter.all()
    if RoleName.MODERATOR in principal.roles:
        return ScopeFilter.of(principal.staff_scopes)  # no listing scope among them -> none()
    return ScopeFilter.none()


#: The SQL fragments a scope maps to on ``listings`` joined with ``business_profiles``. Business
#: listings join ``business_profiles`` via an outer join so a (structurally corrupt) business
#: without a profile has a NULL vertical and matches nothing here — it stays Super Admin only.
def _scope_predicate(scope: StaffScope) -> "ColumnElement[bool]":
    from app.models import BusinessProfile

    if scope is StaffScope.SERVICES:
        return Listing.kind == ListingKind.PROVIDER
    if scope is StaffScope.DIRECTORY:
        return and_(
            Listing.kind == ListingKind.BUSINESS,
            BusinessProfile.vertical == BusinessVertical.GENERAL,
        )
    if scope is StaffScope.FOOD:
        return and_(
            Listing.kind == ListingKind.BUSINESS, BusinessProfile.vertical == BusinessVertical.FOOD
        )
    if scope is StaffScope.EDUCATION:
        return Listing.kind == ListingKind.TUTOR
    if scope is StaffScope.PROPERTY:
        return Listing.kind == ListingKind.PROPERTY
    # ``grocery`` and ``news`` are not listing scopes: no listing ever matches.
    return false()


def listing_scope_sql(filter_: ScopeFilter) -> "ColumnElement[bool] | None":
    """The WHERE fragment this filter applies to a ``Listing`` query (left-joined with
    ``business_profiles``). ``None`` means "no restriction" (Super Admin)."""
    if filter_.kind is ScopeFilterKind.ALL:
        return None
    if filter_.kind is ScopeFilterKind.NONE:
        return false()
    return or_(*(_scope_predicate(scope) for scope in filter_.scopes))
