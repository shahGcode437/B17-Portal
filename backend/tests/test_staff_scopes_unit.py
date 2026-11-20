"""RBAC-A, DB-free: the canonical scope vocabulary, the deny-by-default resource -> scope mapping and
the ``Principal`` authority properties (docs/backend/AUTH_RBAC.md §27.2-§27.4).

The exhaustiveness tests are tripwires: adding a ``ListingKind``, a ``BusinessVertical`` or a
``CategoryModule`` without making an explicit scope decision fails them, so a new kind can never
silently become (or silently fail to become) Moderator-reachable.
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.models.enums import (
    BusinessVertical,
    CategoryModule,
    ListingKind,
    LocationVisibility,
    RoleName,
)
from app.services.auth_sessions import Principal
from app.services.listing_state import ListingState, LocationState
from app.services.listing_writes import module_for
from app.services.staff_scopes import (
    ASSIGNABLE_STAFF_SCOPES,
    RESERVED_STAFF_SCOPES,
    effective_staff_scopes,
    listing_scope,
)

# -- the exact truth table ------------------------------------------------------------------------

TRUTH_TABLE = [
    (ListingKind.PROVIDER, None, CategoryModule.SERVICES),
    (ListingKind.BUSINESS, BusinessVertical.GENERAL, CategoryModule.DIRECTORY),
    (ListingKind.BUSINESS, BusinessVertical.FOOD, CategoryModule.FOOD),
    (ListingKind.TUTOR, None, CategoryModule.EDUCATION),
    (ListingKind.PROPERTY, None, CategoryModule.PROPERTY),
    # a Business with no business profile is structurally corrupt: unmapped, never guessed
    (ListingKind.BUSINESS, None, None),
]


@pytest.mark.parametrize(("kind", "vertical", "scope"), TRUTH_TABLE)
def test_the_scope_of_a_listing_is_exactly_this(
    kind: ListingKind, vertical: BusinessVertical | None, scope: CategoryModule | None
) -> None:
    assert listing_scope(kind, vertical) is scope


@pytest.mark.parametrize("vertical", [None, *BusinessVertical])
def test_only_a_business_reads_its_vertical(vertical: BusinessVertical | None) -> None:
    """A stray vertical on a provider / tutor / property never changes its scope."""
    assert listing_scope(ListingKind.PROVIDER, vertical) is CategoryModule.SERVICES
    assert listing_scope(ListingKind.TUTOR, vertical) is CategoryModule.EDUCATION
    assert listing_scope(ListingKind.PROPERTY, vertical) is CategoryModule.PROPERTY


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


def test_every_category_module_is_classified_assignable_or_reserved_exactly_once() -> None:
    assert set(CategoryModule) == ASSIGNABLE_STAFF_SCOPES | RESERVED_STAFF_SCOPES, (
        "a new CategoryModule must be classified as assignable or reserved"
    )
    assert not ASSIGNABLE_STAFF_SCOPES & RESERVED_STAFF_SCOPES


def test_the_canonical_scopes_are_the_frozen_six() -> None:
    assert {scope.value for scope in CategoryModule} == {
        "services",
        "directory",
        "food",
        "education",
        "property",
        "news",
    }
    assert {CategoryModule.NEWS} == RESERVED_STAFF_SCOPES


def test_every_listing_scope_is_assignable_and_news_is_not_a_listing_scope() -> None:
    mapped = {scope for kind, vertical, scope in TRUTH_TABLE if scope is not None}

    assert mapped <= ASSIGNABLE_STAFF_SCOPES
    assert CategoryModule.NEWS not in mapped  # News is a separate resource model


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
    """One vocabulary, two derivations: the write path's ``module_for`` and this mapping agree."""
    assert listing_scope(kind, vertical) is module_for(_state(kind, vertical))


# -- effective scopes -----------------------------------------------------------------------------


def test_a_reserved_scope_confers_no_authority() -> None:
    stored = [CategoryModule.NEWS, CategoryModule.FOOD, CategoryModule.FOOD]

    assert effective_staff_scopes(stored) == {CategoryModule.FOOD}
    assert effective_staff_scopes([CategoryModule.NEWS]) == frozenset()
    assert effective_staff_scopes([]) == frozenset()


# -- Principal ------------------------------------------------------------------------------------


def principal(
    *roles: RoleName,
    scopes: frozenset[CategoryModule] = frozenset(),
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

    assert (p.is_super_admin, p.is_admin, p.is_moderator, p.is_staff) == (
        False,
        False,
        False,
        False,
    )
    assert p.staff_scopes == frozenset()


def test_a_super_admin_is_staff_without_any_scope_rows() -> None:
    p = principal(RoleName.ADMIN)

    assert p.is_super_admin and p.is_admin and p.is_staff
    assert not p.is_moderator
    assert p.staff_scopes == frozenset()  # authority is the role, never "all scopes" rows


def test_a_moderator_with_a_scope_is_staff_but_not_a_super_admin() -> None:
    p = principal(RoleName.MODERATOR, scopes=frozenset({CategoryModule.FOOD}))

    assert p.is_moderator and p.is_staff
    assert not p.is_super_admin and not p.is_admin


def test_a_moderator_with_zero_scopes_has_no_staff_authority() -> None:
    p = principal(RoleName.MODERATOR)

    assert p.is_moderator  # the role is held...
    assert not p.is_staff  # ...but a Moderator with zero scopes is not staff


def test_scopes_without_the_moderator_role_confer_nothing() -> None:
    """Defence in depth: scope rows alone (no role) never make someone staff."""
    p = principal(scopes=frozenset({CategoryModule.FOOD}))

    assert not p.is_moderator and not p.is_staff


def test_a_corrupt_admin_plus_moderator_state_is_a_super_admin_and_never_a_moderator() -> None:
    p = principal(RoleName.ADMIN, RoleName.MODERATOR, scopes=frozenset({CategoryModule.FOOD}))

    assert p.is_super_admin and p.is_staff
    assert not p.is_moderator  # the roles are exclusive: admin wins, no Moderator authority
