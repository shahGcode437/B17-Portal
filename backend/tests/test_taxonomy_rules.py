"""The pure taxonomy rules (Phase 12E; docs/backend/API_CONTRACT.md §10.7). No database."""

import uuid

import pytest

from app.models.enums import CategoryModule
from app.services.taxonomy_rules import (
    CategoryState,
    derive_slug,
    duplicate_name_problem,
    name_key,
    normalize_name,
    parent_problems,
    renumber,
    reorder_problems,
    search_impact,
    slug_problem,
    slugify,
)

FOOD = CategoryModule.FOOD
SERVICES = CategoryModule.SERVICES


def cat(
    module: CategoryModule = FOOD, parent: uuid.UUID | None = None, name: str = "Cafes"
) -> CategoryState:
    return CategoryState(
        id=uuid.uuid4(),
        module=module,
        parent_id=parent,
        name=name,
        slug=slugify(name),
        is_active=True,
        display_order=1,
    )


# -- names and slugs ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("  Fast   Food ", "Fast Food"), ("Cafes", "Cafes"), ("a\tb", "a b")],
)
def test_names_are_trimmed_and_collapsed(raw: str, expected: str) -> None:
    assert normalize_name(raw) == expected


def test_name_identity_is_case_insensitive_and_whitespace_insensitive() -> None:
    assert name_key("  FAST   food ") == name_key("fast food")
    assert name_key("Cafes") != name_key("Cafe")


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("Fast Food", "fast-food"),
        ("Biryani / Rice", "biryani-rice"),
        ("  Tea & Snacks!! ", "tea-snacks"),
        ("Pizza / Burgers", "pizza-burgers"),
        ("Café Crème", "cafe-creme"),  # accents fold to ASCII
        ("Used  Mobiles 2", "used-mobiles-2"),
        ("a" * 80, "a" * 60),
    ],
)
def test_a_slug_is_derived_from_the_name(name: str, slug: str) -> None:
    derived, problem = derive_slug(name)

    assert (derived, problem) == (slug, None)


@pytest.mark.parametrize("name", ["!!", "---", "ÿ", "x", "اردو"])
def test_a_name_without_usable_letters_needs_an_explicit_slug(name: str) -> None:
    _, problem = derive_slug(name)

    assert problem is not None and (problem.field, problem.code) == ("slug", "required")


@pytest.mark.parametrize("slug", ["ab", "fast-food", "a1", "x" * 60, "a-b-c", "11"])
def test_valid_slugs(slug: str) -> None:
    assert slug_problem(slug) is None


@pytest.mark.parametrize(
    "slug", ["a", "", "Fast-Food", "fast food", "-a", "a-", "a--b", "a_b", "x" * 61, "é1", "a/b"]
)
def test_invalid_slugs(slug: str) -> None:
    problem = slug_problem(slug)

    assert problem is not None and (problem.field, problem.code) == ("slug", "invalid_format")


def test_duplicate_names_are_found_case_insensitively_within_the_sibling_group() -> None:
    assert duplicate_name_problem("cafes", ["Restaurants", "Cafes"]) is not None
    assert duplicate_name_problem("  CAFES ", ["Cafes"]) is not None
    assert duplicate_name_problem("Cafe", ["Cafes"]) is None
    assert duplicate_name_problem("Cafes", []) is None


# -- hierarchy ------------------------------------------------------------------------------------


def test_a_root_is_always_valid() -> None:
    assert (
        parent_problems(
            module=FOOD, category_id=uuid.uuid4(), parent=None, parent_id=None, own_child_count=3
        )
        == []
    )


def test_a_top_level_parent_in_the_same_module_is_valid() -> None:
    parent = cat()

    assert (
        parent_problems(
            module=FOOD, category_id=None, parent=parent, parent_id=parent.id, own_child_count=0
        )
        == []
    )


def test_a_category_cannot_be_its_own_parent() -> None:
    me = cat()

    problems = parent_problems(
        module=FOOD, category_id=me.id, parent=me, parent_id=me.id, own_child_count=0
    )

    assert [(p.field, p.code) for p in problems] == [("parentId", "invalid_parent")]


def test_an_unknown_parent_is_reported() -> None:
    problems = parent_problems(
        module=FOOD, category_id=None, parent=None, parent_id=uuid.uuid4(), own_child_count=0
    )

    assert [(p.field, p.code) for p in problems] == [("parentId", "unknown_parent")]


def test_a_parent_in_another_module_is_refused() -> None:
    other = cat(module=SERVICES)

    problems = parent_problems(
        module=FOOD, category_id=None, parent=other, parent_id=other.id, own_child_count=0
    )

    assert [(p.field, p.code) for p in problems] == [("parentId", "invalid_parent")]


def test_the_hierarchy_is_at_most_two_levels_deep() -> None:
    root = cat()
    child = cat(parent=root.id, name="Sub")

    problems = parent_problems(
        module=FOOD, category_id=None, parent=child, parent_id=child.id, own_child_count=0
    )

    assert [(p.field, p.code) for p in problems] == [("parentId", "invalid_parent")]
    assert "levels" in problems[0].message


def test_a_category_with_children_cannot_itself_get_a_parent() -> None:
    root = cat(name="Root")
    other_root = cat(name="Other")

    problems = parent_problems(
        module=FOOD,
        category_id=root.id,
        parent=other_root,
        parent_id=other_root.id,
        own_child_count=2,
    )

    assert [(p.field, p.code) for p in problems] == [("parentId", "invalid_parent")]


def test_a_cycle_through_the_ancestors_is_detected() -> None:
    me = uuid.uuid4()
    parent = cat(name="Parent")

    problems = parent_problems(
        module=FOOD,
        category_id=me,
        parent=parent,
        parent_id=parent.id,
        own_child_count=0,
        ancestors_of_parent=(me,),
    )

    assert [(p.field, p.code) for p in problems] == [("parentId", "invalid_parent")]
    assert "cycle" in problems[0].message


# -- search impact --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("old", "new", "impact"),
    [
        ("Bakeries", "Bakery & Cakes", True),
        ("Bakeries", "bakeries", True),  # case is part of the stored text
        ("Bakeries", "  Bakeries ", False),  # whitespace-only: normalises to the same text
        ("Fast Food", "Fast  Food", False),
        ("Fast Food", "Fast-Food", True),
    ],
)
def test_only_a_changed_name_changes_search_documents(old: str, new: str, impact: bool) -> None:
    assert search_impact(old, new) is impact


# -- reorder --------------------------------------------------------------------------------------


def ids(count: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(count)]


def test_a_reorder_must_list_exactly_the_group() -> None:
    group = ids(3)

    assert reorder_problems(group, [group[2], group[0], group[1]]) == []


def test_a_duplicate_a_stranger_and_an_omission_are_each_reported() -> None:
    group = ids(3)
    stranger = uuid.uuid4()

    duplicate = reorder_problems(group, [group[0], group[0], group[1], group[2]])
    foreign = reorder_problems(group, [group[0], group[1], group[2], stranger])
    missing = reorder_problems(group, [group[0], group[1]])

    assert [(p.field, p.code) for p in duplicate] == [("orderedIds.1", "duplicate")]
    assert [(p.field, p.code) for p in foreign] == [("orderedIds.3", "unknown_category")]
    assert [(p.field, p.code) for p in missing] == [("orderedIds", "incomplete")]


def test_renumbering_is_one_to_n_in_the_order_given() -> None:
    a, b, c = ids(3)

    assert renumber([c, a, b]) == {c: 1, a: 2, b: 3}
    assert renumber([]) == {}
