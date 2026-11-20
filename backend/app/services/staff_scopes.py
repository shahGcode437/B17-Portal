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

from app.models.enums import BusinessVertical, CategoryModule, ListingKind

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
