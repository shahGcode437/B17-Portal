"""Upgrading a POPULATED database across migration 0002 (the search foundation).

Migration 0002 adds ``listings.search_document`` with an empty default, so listings that already
exist are not searchable until the supported one-time reindex has run. This proves that path end to
end on a real database at the historical revision — not just a fresh, empty one:

    0001 + real listing data  ->  alembic upgrade 0002  ->  check: stale  ->  rebuild  ->
    check: clean  ->  the old listing is found through the public API.

It uses the supported mechanism (``python -m app.db.search_index``'s ``main``), with SQL only for
inserting the pre-0002 rows (the current ORM model already has the column the old schema lacks).
"""

import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import Settings, get_settings
from app.db import search_index as search_index_cli
from app.db.seed import seed_reference_data
from app.factory import create_app
from tests.db.conftest import alembic_config
from tests.db.test_migrations import scratch_url  # noqa: F401  (pytest fixture)

OWNER = uuid.uuid5(uuid.NAMESPACE_URL, "upgrade-test:owner")
FOOD = uuid.uuid5(uuid.NAMESPACE_URL, "upgrade-test:food")
PROVIDER = uuid.uuid5(uuid.NAMESPACE_URL, "upgrade-test:provider")
PENDING = uuid.uuid5(uuid.NAMESPACE_URL, "upgrade-test:pending")


def populate_at_0001(url: str) -> None:
    """A Food business (two categories, menu items), a provider, and a pending listing."""
    from sqlalchemy.orm import Session

    engine = create_engine(url)
    try:
        with Session(engine) as session:
            seed_reference_data(session)
            session.commit()
        with engine.begin() as connection:
            categories = {
                row.slug: row.id
                for row in connection.execute(text("SELECT id, slug FROM categories"))
            }
            connection.execute(
                text("INSERT INTO users (id, email, display_name) VALUES (:id, :e, 'Old Owner')"),
                {"id": OWNER, "e": "owner@upgrade.example"},
            )
            for listing_id, kind, status, title, description, tags in (
                (
                    FOOD,
                    "business",
                    "approved",
                    "Old Town Biryani",
                    "Slow-cooked rice since the first release.",
                    ["rice", "lunch"],
                ),
                (PROVIDER, "provider", "approved", "Legacy Solar Co", "Panels.", ["solar"]),
                (PENDING, "provider", "pending", "Legacy Plumbing Pending", "Waiting.", []),
            ):
                connection.execute(
                    text(
                        "INSERT INTO listings (id, kind, owner_id, status, title, description, "
                        "area, tags, is_featured, revision) VALUES (:id, :kind, :owner, :status, "
                        ":title, :description, 'B-17, Legacy Block', :tags, false, 1)"
                    ),
                    {
                        "id": listing_id,
                        "kind": kind,
                        "owner": OWNER,
                        "status": status,
                        "title": title,
                        "description": description,
                        "tags": tags,
                    },
                )
            connection.execute(
                text(
                    "INSERT INTO business_profiles (listing_id, kind, vertical) "
                    "VALUES (:id, 'business', 'food')"
                ),
                {"id": FOOD},
            )
            connection.execute(
                text(
                    "INSERT INTO food_profiles (listing_id, vertical, service_options) "
                    "VALUES (:id, 'food', ARRAY['dine-in','takeaway'])"
                ),
                {"id": FOOD},
            )
            for position, name in ((1, "Legacy Pulao"), (2, "Saffron Zarda")):
                connection.execute(
                    text(
                        "INSERT INTO food_menu_items (id, listing_id, position, name) "
                        "VALUES (gen_random_uuid(), :id, :p, :n)"
                    ),
                    {"id": FOOD, "p": position, "n": name},
                )
            for listing_id, slug in (
                (FOOD, "biryani-rice"),
                (FOOD, "desi-food"),
                (PROVIDER, "solar"),
                (PENDING, "plumbing"),
            ):
                position = 2 if (listing_id, slug) == (FOOD, "desi-food") else 1
                connection.execute(
                    text(
                        "INSERT INTO listing_categories (listing_id, position, category_id) "
                        "VALUES (:l, :p, :c)"
                    ),
                    {"l": listing_id, "p": position, "c": categories[slug]},
                )
    finally:
        engine.dispose()


def documents(url: str) -> dict[uuid.UUID, str]:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return {
                row.id: row.search_document
                for row in connection.execute(text("SELECT id, search_document FROM listings"))
            }
    finally:
        engine.dispose()


def search_titles(url: str, q: str) -> list[str]:
    app = create_app(Settings(_env_file=None, environment="test", database_url=url))
    with TestClient(app) as client:
        response = client.get("/api/v1/search", params={"q": q})
        assert response.status_code == 200, response.text
        return [hit["item"]["name"] for hit in response.json()["data"]]


@pytest.fixture
def cli_database(monkeypatch: pytest.MonkeyPatch, scratch_url: str) -> Iterator[str]:  # noqa: F811
    """Point the supported CLI (which reads settings from the environment) at the scratch DB."""
    monkeypatch.setenv("DATABASE_URL", scratch_url)
    get_settings.cache_clear()
    try:
        yield scratch_url
    finally:
        get_settings.cache_clear()


def test_existing_listings_become_searchable_only_after_the_supported_reindex(
    cli_database: str, capsys: pytest.CaptureFixture[str]
) -> None:
    url = cli_database
    config = alembic_config(url)
    command.upgrade(config, "0001")
    populate_at_0001(url)

    command.upgrade(config, "0002")

    # -- before the reindex: the column exists but is empty, so nothing is found ----------------
    assert set(documents(url).values()) == {""}
    assert search_titles(url, "biryani") == []
    assert search_titles(url, "pulao") == []
    capsys.readouterr()
    assert search_index_cli.main(["check"]) == 1  # the audit reports the unbuilt documents
    assert "3 stale document(s)" in capsys.readouterr().out

    # -- the one-time reindex -----------------------------------------------------------------------
    assert search_index_cli.main(["rebuild"]) == 0
    assert "3 listing document(s) rebuilt" in capsys.readouterr().out

    # -- after: clean audit, complete documents, the pre-0002 listing is searchable --------------
    assert search_index_cli.main(["check"]) == 0
    assert "all documents are current" in capsys.readouterr().out
    stored = documents(url)
    food = stored[FOOD]
    for fragment in (
        "old town biryani",
        "biryani / rice",  # both categories
        "desi food",
        "slow-cooked rice",
        "b-17, legacy block",
        "lunch",
        "legacy pulao",  # menu items
        "saffron zarda",
    ):
        assert fragment in food
    assert search_titles(url, "biryani") == ["Old Town Biryani"]
    assert search_titles(url, "ZARDA") == ["Old Town Biryani"]  # a menu item, any case
    assert search_titles(url, "solar") == ["Legacy Solar Co"]
    assert search_titles(url, "plumbing") == []  # the pending listing is indexed but never public

    # -- idempotent: a second rebuild changes nothing --------------------------------------------
    assert search_index_cli.main(["rebuild"]) == 0
    assert documents(url) == stored


def test_downgrade_then_upgrade_again_needs_the_reindex_again(
    cli_database: str, capsys: pytest.CaptureFixture[str]
) -> None:
    """The column is dropped by the downgrade, so a re-upgrade is the same populated-data case."""
    url = cli_database
    config = alembic_config(url)
    command.upgrade(config, "0001")
    populate_at_0001(url)
    command.upgrade(config, "0002")
    assert search_index_cli.main(["rebuild"]) == 0

    command.downgrade(config, "0001")
    command.upgrade(config, "0002")

    assert set(documents(url).values()) == {""}
    capsys.readouterr()
    assert search_index_cli.main(["check"]) == 1
    assert search_index_cli.main(["rebuild"]) == 0
    assert search_index_cli.main(["check"]) == 0
    assert search_titles(url, "biryani") == ["Old Town Biryani"]
