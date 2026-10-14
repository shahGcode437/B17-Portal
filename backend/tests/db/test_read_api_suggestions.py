"""GET /api/v1/search/suggestions: bounded, ranked, de-duplicated, public-only autocomplete."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.db.test_read_api_search import HIDDEN_WORDS

URL = "/api/v1/search/suggestions"


def suggest(client: TestClient, **params: Any) -> list[dict[str, Any]]:
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    data: list[dict[str, Any]] = response.json()["data"]
    return data


def labels(client: TestClient, **params: Any) -> list[str]:
    return [item["label"] for item in suggest(client, **params)]


def test_a_suggestion_has_the_frontend_shape(read_client: TestClient) -> None:
    item = suggest(read_client, q="biryani")[0]

    assert set(item) == {"id", "label", "secondaryLabel", "type", "value"}
    assert item["value"] == item["label"]
    assert item["id"].startswith(f"{item['type']}:")


def test_suggestions_for_a_title_carry_a_stable_item_id_and_a_descriptive_subtitle(
    read_client: TestClient,
) -> None:
    item = next(
        i for i in suggest(read_client, q="karachi") if i["label"] == "Karachi Biryani House"
    )

    assert item["type"] == "business"
    assert ":item:" in item["id"]
    assert item["secondaryLabel"] == "Directory · Biryani / Rice"


def test_tutor_and_property_titles_carry_grade_and_listing_type_in_the_subtitle(
    read_client: TestClient,
) -> None:
    tutor = next(i for i in suggest(read_client, q="sara") if i["label"] == "Sara M.")
    prop = next(i for i in suggest(read_client, q="marla") if i["label"].startswith("5 Marla"))

    assert tutor["secondaryLabel"] == "Education · Physics · Grade 9"
    assert prop["secondaryLabel"] == "Property · House · For Sale"


@pytest.mark.parametrize("q", ["", " ", "a", " b "])
def test_a_query_shorter_than_two_characters_returns_nothing(
    read_client: TestClient, q: str
) -> None:
    assert suggest(read_client, q=q) == []


def test_a_missing_query_returns_nothing(read_client: TestClient) -> None:
    assert suggest(read_client) == []


@pytest.mark.parametrize("q", ["BIR", "bir", "Bir"])
def test_matching_is_case_insensitive(read_client: TestClient, q: str) -> None:
    assert "Biryani" in labels(read_client, q=q)


def test_terms_come_from_categories_tags_menu_items_grades_and_titles(
    read_client: TestClient,
) -> None:
    assert "Biryani / Rice" in labels(read_client, q="biryani")  # a category name
    assert "Chicken Biryani" in labels(read_client, q="biryani")  # a Food menu item
    assert "Grade 10" in labels(read_client, q="grade")  # a tutor grade
    assert "For Rent" in labels(read_client, q="for r")  # the property listing-type label
    assert "Net metering" in labels(read_client, q="net")  # a tag, first letter capitalised


def test_ranking_is_exact_then_starts_with_then_word_prefix_then_contains(
    read_client: TestClient,
) -> None:
    ranked = labels(read_client, q="cafe")

    assert ranked[0] == "Cafe"  # the exact tag
    assert ranked[1] == "Cafes"  # starts with, and shorter than the "Mocha Corner Cafe" title
    assert ranked[2] == "Mocha Corner Cafe"  # word-prefix: "cafe" begins its last word


def test_an_exact_term_beats_longer_matches(read_client: TestClient) -> None:
    assert labels(read_client, q="physics")[0] == "Physics"


def test_results_are_deduplicated_per_kind_and_label(read_client: TestClient) -> None:
    ranked = [(i["type"], i["label"].lower()) for i in suggest(read_client, q="chicken", limit=20)]

    assert len(ranked) == len(set(ranked))  # "Chicken Patties" appears for two restaurants
    assert ("business", "chicken patties") in ranked


def test_a_term_wins_over_an_item_title_with_the_same_label(read_client: TestClient) -> None:
    items = [i for i in suggest(read_client, q="pharmacy") if i["label"].lower() == "pharmacy"]

    assert len(items) == 1 and items[0]["id"].startswith("business:term:")


@pytest.mark.parametrize(("limit", "expected"), [(1, 1), (3, 3)])
def test_the_limit_bounds_the_result(read_client: TestClient, limit: int, expected: int) -> None:
    assert len(suggest(read_client, q="ba", limit=limit)) == expected


def test_the_default_limit_is_eight(read_client: TestClient) -> None:
    assert len(suggest(read_client, q="in")) <= 8


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 21}, {"limit": "x"}, {"type": "x"}])
def test_invalid_parameters_are_rejected(read_client: TestClient, params: dict[str, Any]) -> None:
    response = read_client.get(URL, params={"q": "bi", **params})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize(
    ("kind", "q"),
    [
        ("provider", "sol"),
        ("business", "bir"),
        ("tutor", "phy"),
        ("property", "fla"),
        ("news", "wat"),
    ],
)
def test_the_type_scope_returns_only_that_kind(read_client: TestClient, kind: str, q: str) -> None:
    items = suggest(read_client, q=q, type=kind)

    assert items and {i["type"] for i in items} == {kind}


def test_the_type_scope_excludes_other_kinds(read_client: TestClient) -> None:
    assert suggest(read_client, q="water", type="provider") == []
    assert suggest(read_client, q="biryani", type="tutor") == []


@pytest.mark.parametrize("hidden", HIDDEN_WORDS)
def test_hidden_records_never_appear_as_suggestions(read_client: TestClient, hidden: str) -> None:
    assert suggest(read_client, q=hidden) == []
    assert suggest(read_client, q=hidden[:4]) == []


def test_hidden_records_do_not_contribute_categories_or_tags(read_client: TestClient) -> None:
    # "Plumbing" is the category of the pending Quokka only; "Tailoring" of the rejected Wombat
    assert suggest(read_client, q="plumb") == []
    assert suggest(read_client, q="tailor") == []
    assert suggest(read_client, q="kebab") == []


@pytest.mark.parametrize("q", ["%%", "__", "\\\\", "x'; --"])
def test_wildcards_and_quotes_are_matched_literally(read_client: TestClient, q: str) -> None:
    assert suggest(read_client, q=q) == []


def test_the_response_is_deterministic(read_client: TestClient) -> None:
    assert suggest(read_client, q="ba", limit=20) == suggest(read_client, q="ba", limit=20)


def test_unicode_is_accepted(read_client: TestClient) -> None:
    assert isinstance(suggest(read_client, q="دکان"), list)
