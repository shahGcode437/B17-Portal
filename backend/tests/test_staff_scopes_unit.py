"""RBAC-A, DB-free: the canonical scope vocabulary, the deny-by-default resource -> scope mapping and
the ``Principal`` authority properties (docs/backend/AUTH_RBAC.md §27.2-§27.4).

The exhaustiveness tests are tripwires: adding a ``ListingKind``, a ``BusinessVertical``, a
``StaffScope`` or a ``CategoryModule`` without making an explicit scope decision fails them, so a
new kind can never silently become (or silently fail to become) Moderator-reachable.

GROCERY-1a (AUTH_RBAC.md §32): staff scopes (``StaffScope``) are separate from the listing taxonomy
(``CategoryModule``), and ``grocery`` confers nothing over listings.
"""

import uuid
from datetime import UTC, datetime
from itertools import chain, combinations

import pytest

from app.models.enums import (
    BusinessVertical,
    CategoryModule,
    ListingKind,
    LocationVisibility,
    RoleName,
    StaffScope,
)
from app.services.auth_sessions import Principal
from app.services.listing_state import ListingState, LocationState
from app.services.listing_writes import module_for
from app.services.staff_scopes import (
    ASSIGNABLE_STAFF_SCOPES,
    GROCERY_SCOPE,
    LISTING_STAFF_SCOPES,
    RESERVED_STAFF_SCOPES,
    ScopeFilter,
    ScopeFilterKind,
    effective_staff_scopes,
    listing_scope,
    listing_scope_sql,
    scope_filter_for,
)

# -- the exact truth table ------------------------------------------------------------------------

TRUTH_TABLE = [
    (ListingKind.PROVIDER, None, StaffScope.SERVICES),
    (ListingKind.BUSINESS, BusinessVertical.GENERAL, StaffScope.DIRECTORY),
    (ListingKind.BUSINESS, BusinessVertical.FOOD, StaffScope.FOOD),
    (ListingKind.TUTOR, None, StaffScope.EDUCATION),
    (ListingKind.PROPERTY, None, StaffScope.PROPERTY),
    # a Business with no business profile is structurally corrupt: unmapped, never guessed
    (ListingKind.BUSINESS, None, None),
]


@pytest.mark.parametrize(("kind", "vertical", "scope"), TRUTH_TABLE)
def test_the_scope_of_a_listing_is_exactly_this(
    kind: ListingKind, vertical: BusinessVertical | None, scope: StaffScope | None
) -> None:
    assert listing_scope(kind, vertical) is scope


@pytest.mark.parametrize("vertical", [None, *BusinessVertical])
def test_only_a_business_reads_its_vertical(vertical: BusinessVertical | None) -> None:
    """A stray vertical on a provider / tutor / property never changes its scope."""
    assert listing_scope(ListingKind.PROVIDER, vertical) is StaffScope.SERVICES
    assert listing_scope(ListingKind.TUTOR, vertical) is StaffScope.EDUCATION
    assert listing_scope(ListingKind.PROPERTY, vertical) is StaffScope.PROPERTY


def test_an_unknown_kind_or_vertical_is_unmapped_not_guessed() -> None:
    """Defensive: a value that is not in today's enums (a future kind nobody mapped) -> no scope."""
    assert listing_scope("newkind", None) is None  # type: ignore[arg-type]
    assert listing_scope(ListingKind.BUSINESS, "newvertical") is None  # type: ignore[arg-type]


# -- exhaustiveness tripwires ----------------------------------------------------------------------


def test_every_current_listing_kind_has_an_explicit_scope_decision() -> None:
    assert set(ListingKind) == {
        ListingKind.PROVIDER,
        ListingKind.BUSINESS,
        ListingKind.TUTOR,
        ListingKind.PROPERTY,
    }, "a new ListingKind needs an explicit scope decision in staff_scopes.py and this table"
    for kind in ListingKind:
        verticals = list(BusinessVertical) if kind is ListingKind.BUSINESS else [None]
        for vertical in verticals:
            assert listing_scope(kind, vertical) is not None, (kind, vertical)


def test_every_current_business_vertical_has_an_explicit_scope_decision() -> None:
    assert set(BusinessVertical) == {BusinessVertical.GENERAL, BusinessVertical.FOOD}, (
        "a new BusinessVertical needs an explicit scope decision"
    )
    for vertical in BusinessVertical:
        assert listing_scope(ListingKind.BUSINESS, vertical) is not None


def test_every_staff_scope_is_classified_listing_grocery_or_reserved_exactly_once() -> None:
    classes = [LISTING_STAFF_SCOPES, frozenset({GROCERY_SCOPE}), RESERVED_STAFF_SCOPES]

    assert set(StaffScope) == frozenset().union(*classes), (
        "a new StaffScope needs an explicit decision about what it confers"
    )
    assert sum(len(c) for c in classes) == len(StaffScope), "a scope is in exactly one class"
    assert LISTING_STAFF_SCOPES | {GROCERY_SCOPE} == ASSIGNABLE_STAFF_SCOPES
    assert not ASSIGNABLE_STAFF_SCOPES & RESERVED_STAFF_SCOPES


def test_the_staff_scopes_are_the_frozen_seven() -> None:
    assert [scope.value for scope in StaffScope] == [
        "services",
        "directory",
        "food",
        "education",
        "property",
        "news",
        "grocery",
    ]
    assert GROCERY_SCOPE is StaffScope.GROCERY


def test_grocery_is_a_staff_scope_and_never_taxonomy() -> None:
    """Every taxonomy module has a same-named staff scope; ``grocery`` is the only scope that is
    not a module, so it can never be a category module."""
    modules = {module.value for module in CategoryModule}
    scopes = {scope.value for scope in StaffScope}

    assert modules < scopes
    assert scopes - modules == {"grocery"}
    assert "grocery" not in {kind.value for kind in ListingKind}
    assert "grocery" not in {vertical.value for vertical in BusinessVertical}


def test_the_taxonomy_modules_are_still_the_frozen_six_and_news_is_reserved() -> None:
    assert {module.value for module in CategoryModule} == {
        "services",
        "directory",
        "food",
        "education",
        "property",
        "news",
    }
    assert {StaffScope.NEWS} == RESERVED_STAFF_SCOPES


def test_every_listing_scope_is_assignable_and_news_is_not_a_listing_scope() -> None:
    mapped = {scope for kind, vertical, scope in TRUTH_TABLE if scope is not None}

    assert mapped == LISTING_STAFF_SCOPES
    assert mapped <= ASSIGNABLE_STAFF_SCOPES
    assert StaffScope.NEWS not in mapped  # News is a separate resource model
    assert StaffScope.GROCERY not in mapped  # nothing in the listing model is Grocery


def _state(kind: ListingKind, vertical: BusinessVertical | None) -> ListingState:
    return ListingState(
        kind=kind,
        title="T",
        description=None,
        area="B-17",
        tags=(),
        image=None,
        location=LocationState(visibility=LocationVisibility.AREA_ONLY),
        vertical=vertical,
    )


@pytest.mark.parametrize(
    ("kind", "vertical"), [(k, v) for k, v, scope in TRUTH_TABLE if scope is not None]
)
def test_the_scope_agrees_with_the_taxonomy_module_the_write_path_uses(
    kind: ListingKind, vertical: BusinessVertical | None
) -> None:
    """Two vocabularies, one meaning: a listing's moderation scope is named after the taxonomy
    module the write path's ``module_for`` derives for it."""
    scope = listing_scope(kind, vertical)

    assert scope is not None
    assert scope.value == module_for(_state(kind, vertical)).value


# -- effective scopes -----------------------------------------------------------------------------


def test_a_reserved_scope_confers_no_authority() -> None:
    stored = [StaffScope.NEWS, StaffScope.FOOD, StaffScope.FOOD]

    assert effective_staff_scopes(stored) == {StaffScope.FOOD}
    assert effective_staff_scopes([StaffScope.NEWS]) == frozenset()
    assert effective_staff_scopes([]) == frozenset()
    assert effective_staff_scopes([StaffScope.GROCERY, StaffScope.NEWS]) == {StaffScope.GROCERY}


# -- Principal ------------------------------------------------------------------------------------


def principal(
    *roles: RoleName,
    scopes: frozenset[StaffScope] = frozenset(),
    professional: bool = False,
) -> Principal:
    now = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
    return Principal(
        user_id=uuid.uuid4(),
        display_name="Tester",
        email="t@example.org",
        email_verified=True,
        roles=frozenset(roles),
        plan_code=None,
        session_id=uuid.uuid4(),
        session_created_at=now,
        session_last_seen_at=now,
        session_expires_at=now,
        staff_scopes=scopes,
    )


def test_a_resident_is_not_staff() -> None:
    p = principal()

    assert (p.is_super_admin, p.is_admin, p.is_moderator) == (False, False, False)
    assert not p.has_listing_authority and not p.has_grocery_authority
    assert p.staff_scopes == frozenset()


def test_there_is_no_any_staff_shortcut() -> None:
    """``is_staff`` meant "any effective scope", which would have admitted a Grocery-only
    Moderator to listing routes. A guard must name the authority it needs."""
    assert not hasattr(Principal, "is_staff")


def test_a_super_admin_is_staff_without_any_scope_rows() -> None:
    p = principal(RoleName.ADMIN)

    assert p.is_super_admin and p.is_admin
    assert p.has_listing_authority and p.has_grocery_authority
    assert not p.is_moderator
    assert p.staff_scopes == frozenset()  # authority is the role, never "all scopes" rows


def test_a_moderator_with_a_scope_is_staff_but_not_a_super_admin() -> None:
    p = principal(RoleName.MODERATOR, scopes=frozenset({StaffScope.FOOD}))

    assert p.is_moderator and p.has_listing_authority
    assert not p.has_grocery_authority  # no listing scope implies Grocery
    assert not p.is_super_admin and not p.is_admin


def test_a_moderator_with_zero_scopes_has_no_staff_authority() -> None:
    p = principal(RoleName.MODERATOR)

    assert p.is_moderator  # the role is held...
    # ...but a Moderator with zero scopes has no staff authority of either kind
    assert not p.has_listing_authority and not p.has_grocery_authority


def test_scopes_without_the_moderator_role_confer_nothing() -> None:
    """Defence in depth: scope rows alone (no role) never make someone staff."""
    p = principal(scopes=frozenset({StaffScope.FOOD, StaffScope.GROCERY}))

    assert not p.is_moderator
    assert not p.has_listing_authority and not p.has_grocery_authority


def test_a_corrupt_admin_plus_moderator_state_is_a_super_admin_and_never_a_moderator() -> None:
    p = principal(RoleName.ADMIN, RoleName.MODERATOR, scopes=frozenset({StaffScope.FOOD}))

    assert p.is_super_admin and p.has_listing_authority and p.has_grocery_authority
    assert not p.is_moderator  # the roles are exclusive: admin wins, no Moderator authority


# -- GROCERY-1a: every combination of storable scopes ----------------------------------------------

EVERY_SCOPE_SET = [
    frozenset(chosen)
    for chosen in chain.from_iterable(
        combinations(sorted(StaffScope), size) for size in range(len(StaffScope) + 1)
    )
]


def test_authority_over_every_combination_of_scopes() -> None:
    """All 128 sets: listing authority needs a listing scope, Grocery authority needs
    ``grocery``, and neither is ever implied by the other or by ``news``."""
    assert len(EVERY_SCOPE_SET) == 2 ** len(StaffScope)
    for scopes in EVERY_SCOPE_SET:
        p = principal(RoleName.MODERATOR, scopes=effective_staff_scopes(scopes))

        assert p.has_listing_authority is bool(scopes & LISTING_STAFF_SCOPES), scopes
        assert p.has_grocery_authority is (StaffScope.GROCERY in scopes), scopes


def test_adding_grocery_never_changes_what_listings_a_moderator_can_see() -> None:
    for scopes in EVERY_SCOPE_SET:
        without = scope_filter_for(
            principal(RoleName.MODERATOR, scopes=scopes - {StaffScope.GROCERY})
        )
        with_grocery = scope_filter_for(
            principal(RoleName.MODERATOR, scopes=scopes | {StaffScope.GROCERY})
        )

        assert with_grocery == without, scopes
        assert with_grocery.scopes <= LISTING_STAFF_SCOPES


@pytest.mark.parametrize(
    "scopes", [[StaffScope.GROCERY], [StaffScope.NEWS], [StaffScope.GROCERY, StaffScope.NEWS], []]
)
def test_a_filter_without_a_listing_scope_is_empty_and_matches_no_row(
    scopes: list[StaffScope],
) -> None:
    built = ScopeFilter.of(scopes)

    assert built.kind is ScopeFilterKind.NONE and built.is_empty
    assert str(listing_scope_sql(built)) == "false"
    assert scope_filter_for(principal(RoleName.MODERATOR, scopes=frozenset(scopes))) == built
