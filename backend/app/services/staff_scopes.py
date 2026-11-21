"""Staff scopes: the canonical vocabulary and the deny-by-default resource -> scope mapping
(docs/backend/AUTH_RBAC.md §27.3). Pure functions — nothing here touches the database.

The canonical scopes are the ``CategoryModule`` values (one source of truth; there is no second
scope enum). A listing's scope is derived ONLY from the authoritative state of the listing itself —
its ``kind`` and, for a Business, the ``vertical`` of its business profile. It is never derived from
a category, a request body, a URL or any frontend claim.

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
from app.models.enums import BusinessVertical, CategoryModule, ListingKind, RoleName

if TYPE_CHECKING:
    from sqlalchemy.sql.elements import ColumnElement

    from app.services.auth_sessions import Principal

#: Scopes a Moderator can hold today. ``news`` is in the canonical vocabulary but reserved: it
#: becomes assignable only once a News administration API exists (AUTH_RBAC.md §27.3, rule 5).
ASSIGNABLE_STAFF_SCOPES: frozenset[CategoryModule] = frozenset(
    {
        CategoryModule.SERVICES,
        CategoryModule.DIRECTORY,
        CategoryModule.FOOD,
        CategoryModule.EDUCATION,
        CategoryModule.PROPERTY,
    }
)
RESERVED_STAFF_SCOPES: frozenset[CategoryModule] = frozenset({CategoryModule.NEWS})

_KIND_SCOPES: Mapping[ListingKind, CategoryModule] = {
    ListingKind.PROVIDER: CategoryModule.SERVICES,
    ListingKind.TUTOR: CategoryModule.EDUCATION,
    ListingKind.PROPERTY: CategoryModule.PROPERTY,
}
_BUSINESS_SCOPES: Mapping[BusinessVertical, CategoryModule] = {
    BusinessVertical.GENERAL: CategoryModule.DIRECTORY,
    BusinessVertical.FOOD: CategoryModule.FOOD,
}


def listing_scope(kind: ListingKind, vertical: BusinessVertical | None) -> CategoryModule | None:
    """The scope of a listing, or ``None`` (unmapped: Super Admin only) — deny by default."""
    if kind is ListingKind.BUSINESS:
        return _BUSINESS_SCOPES.get(vertical) if vertical is not None else None
    return _KIND_SCOPES.get(kind)


def effective_staff_scopes(stored: Iterable[CategoryModule]) -> frozenset[CategoryModule]:
    """The stored scope assignments that actually confer authority: only assignable scopes count,
    so a stray ``news`` row grants nothing until a News administration API exists."""
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
    scopes: frozenset[CategoryModule] = frozenset()

    @classmethod
    def all(cls) -> "ScopeFilter":
        return cls(ScopeFilterKind.ALL)

    @classmethod
    def of(cls, scopes: Iterable[CategoryModule]) -> "ScopeFilter":
        allowed = frozenset(scopes) & ASSIGNABLE_STAFF_SCOPES
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
        effective = effective_staff_scopes(principal.staff_scopes)
        return ScopeFilter.of(effective) if effective else ScopeFilter.none()
    return ScopeFilter.none()


#: The SQL fragments a scope maps to on ``listings`` joined with ``business_profiles``. Business
#: listings join ``business_profiles`` via an outer join so a (structurally corrupt) business
#: without a profile has a NULL vertical and matches nothing here — it stays Super Admin only.
def _scope_predicate(scope: CategoryModule) -> "ColumnElement[bool]":
    from app.models import BusinessProfile

    if scope is CategoryModule.SERVICES:
        return Listing.kind == ListingKind.PROVIDER
    if scope is CategoryModule.DIRECTORY:
        return and_(
            Listing.kind == ListingKind.BUSINESS,
            BusinessProfile.vertical == BusinessVertical.GENERAL,
        )
    if scope is CategoryModule.FOOD:
        return and_(
            Listing.kind == ListingKind.BUSINESS, BusinessProfile.vertical == BusinessVertical.FOOD
        )
    if scope is CategoryModule.EDUCATION:
        return Listing.kind == ListingKind.TUTOR
    if scope is CategoryModule.PROPERTY:
        return Listing.kind == ListingKind.PROPERTY
    # ``news`` is a separate resource model; no listing ever matches.
    return false()


def listing_scope_sql(filter_: ScopeFilter) -> "ColumnElement[bool] | None":
    """The WHERE fragment this filter applies to a ``Listing`` query (left-joined with
    ``business_profiles``). ``None`` means "no restriction" (Super Admin)."""
    if filter_.kind is ScopeFilterKind.ALL:
        return None
    if filter_.kind is ScopeFilterKind.NONE:
        return false()
    return or_(*(_scope_predicate(scope) for scope in filter_.scopes))
