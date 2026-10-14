"""The read path is indexed, bounded and free of N+1 queries (real PostgreSQL)."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Connection, event, text
from sqlalchemy.orm import Session

from scripts.dev_fixtures import BAKERS_ID


@contextmanager
def count_statements(session: Session) -> Iterator[list[str]]:
    connection: Connection = session.connection()
    statements: list[str] = []

    def record(_c: Any, _cursor: Any, statement: str, *_rest: Any) -> None:
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(connection, "before_cursor_execute", record)


# -- indexes & extension --------------------------------------------------------------------------


def index_definitions(session: Session, table: str) -> dict[str, str]:
    rows = session.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = :t"), {"t": table}
    )
    return {name: definition for name, definition in rows}


def test_pg_trgm_is_installed(db_session: Session) -> None:
    assert db_session.scalar(text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")) == 1


def test_the_search_document_has_a_trigram_gin_index(db_session: Session) -> None:
    definition = index_definitions(db_session, "listings")["ix_listings_search_document_trgm"]

    assert "USING gin" in definition and "gin_trgm_ops" in definition
    assert "search_document" in definition


def test_the_public_browse_paths_are_indexed(db_session: Session) -> None:
    listings = index_definitions(db_session, "listings")

    assert "WHERE" in listings["ix_listings_approved_area"]
    assert "approved" in listings["ix_listings_approved_area"]
    news = index_definitions(db_session, "news_articles")
    assert "ix_news_articles_status_published_at" in news


def test_a_text_search_can_use_the_trigram_index(db_session: Session) -> None:
    """On a tiny table the planner prefers a scan, so it is told not to: the point is that the
    index is *usable* for ``LIKE '%q%'`` (substring) predicates."""
    db_session.execute(text("SET LOCAL enable_seqscan = off"))

    plan = "\n".join(
        db_session.scalars(
            text(
                "EXPLAIN SELECT id FROM listings "
                "WHERE search_document LIKE '%biryani%' ESCAPE chr(92)"
            )
        )
    )

    assert "ix_listings_search_document_trgm" in plan


# -- N+1 --------------------------------------------------------------------------------------------


def test_search_runs_a_bounded_number_of_statements_however_many_hits(
    read_client: TestClient, fixtures_session: Session
) -> None:
    with count_statements(fixtures_session) as small:
        assert read_client.get("/api/v1/search", params={"limit": 13}).status_code == 200
    with count_statements(fixtures_session) as large:
        assert read_client.get("/api/v1/search", params={"limit": 50}).status_code == 200

    # count + page + (listing cards: a few eager loads) + news. A page of 13 and of 50 hits (all
    # kinds, so every loader runs) cost the same: the statement count does not grow with the hits.
    assert len(large) == len(small)
    assert len(large) <= 8


def test_search_with_text_and_filters_is_not_more_expensive(
    read_client: TestClient, fixtures_session: Session
) -> None:
    params = {"q": "chicken", "type": "business", "vertical": "food", "service": "takeaway"}
    with count_statements(fixtures_session) as statements:
        assert read_client.get("/api/v1/search", params=params).status_code == 200

    assert len(statements) <= 6


def test_listing_detail_is_a_fixed_number_of_statements(
    read_client: TestClient, fixtures_session: Session
) -> None:
    with count_statements(fixtures_session) as statements:
        assert read_client.get(f"/api/v1/listings/{BAKERS_ID}").status_code == 200

    assert len(statements) <= 6  # listing + categories + business/food + menu items (eager)


def test_suggestions_are_a_single_statement(
    read_client: TestClient, fixtures_session: Session
) -> None:
    with count_statements(fixtures_session) as statements:
        assert read_client.get("/api/v1/search/suggestions", params={"q": "ba"}).status_code == 200

    assert len(statements) == 1


def test_news_list_is_two_statements_and_categories_one(
    read_client: TestClient, fixtures_session: Session
) -> None:
    with count_statements(fixtures_session) as listing:
        assert read_client.get("/api/v1/news").status_code == 200
    assert len(listing) == 2  # count + page (category joined, not lazy-loaded per row)

    with count_statements(fixtures_session) as categories:
        assert read_client.get("/api/v1/categories").status_code == 200
    assert len(categories) == 1


@pytest.mark.parametrize("limit", [1, 25, 50])
def test_a_page_never_returns_more_than_the_limit(read_client: TestClient, limit: int) -> None:
    body = read_client.get("/api/v1/search", params={"limit": limit}).json()

    assert len(body["data"]) <= limit
