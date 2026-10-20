"""Saved items against real PostgreSQL (Phase 12F; API_CONTRACT.md §10.8, §13).

Any signed-in user (verified or not) may save an APPROVED listing; ``PUT`` / ``DELETE`` are
idempotent; the list is the caller's own, public cards only, and a saved listing that stops being
approved is hidden (its row is kept and it reappears if re-approved); un-saving always works.
"""

import json
from typing import Any

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.models.enums import ListingStatus
from tests.db.auth_helpers import AuthEnv
from tests.db.request_helpers import (
    SAVED,
    approved,
    approved_business,
    approved_provider,
    approved_tutor,
    new_id,
    provider_signed_in,
    requester_signed_in,
    saved_ids,
    saved_rows,
)
from tests.db.write_helpers import archive, created_id, patch, set_status, signed_in, stored_columns
from tests.write_payloads import business_body, exact, property_body, provider_body

PRIVATE_FRAGMENTS = (
    "Shop 4, Main Market",  # address
    "Opposite the mosque",  # landmark
    "33.123456",
    "72.123456",  # the exact point
    "ownerId",
    "owner_id",
    "revision",
    "rejectionReason",
    "searchDocument",
    "search_document",
    "email",
)


def put(api: Any, listing_id: str, **kwargs: Any) -> Any:
    return api.request("PUT", f"{SAVED}/{listing_id}", **kwargs)


def delete(api: Any, listing_id: str, **kwargs: Any) -> Any:
    return api.request("DELETE", f"{SAVED}/{listing_id}", **kwargs)


# -- who may save ------------------------------------------------------------------------------------


@pytest.mark.parametrize("route", ["list", "put", "delete"])
def test_anonymous_callers_cannot_use_saved(auth_env: AuthEnv, route: str) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    anonymous = auth_env.client()

    calls: dict[str, Any] = {
        "list": lambda: anonymous.get(SAVED),
        "put": lambda: put(anonymous, listing_id),
        "delete": lambda: delete(anonymous, listing_id),
    }
    response = calls[route]()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_an_unverified_user_may_save_list_and_unsave(auth_env: AuthEnv) -> None:
    """Saving is low risk: e-mail verification is not required (AUTH_RBAC.md §22.1)."""
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    unverified = requester_signed_in(auth_env, "unverified@example.org", verified=False)

    assert put(unverified, listing_id).status_code == 204
    assert saved_ids(unverified) == [listing_id]
    assert delete(unverified, listing_id).status_code == 204
    assert saved_ids(unverified) == []


@pytest.mark.parametrize("who", ["resident", "professional", "premium", "admin"])
def test_every_kind_of_signed_in_account_may_save(auth_env: AuthEnv, who: str) -> None:
    owner = provider_signed_in(auth_env, "owner@example.org")
    listing_id = approved_provider(auth_env, owner)
    api = {
        "resident": lambda: requester_signed_in(auth_env, "a@example.org"),
        "professional": lambda: signed_in(auth_env, "b@example.org"),
        "premium": lambda: provider_signed_in(auth_env, "c@example.org"),
        "admin": lambda: signed_in(auth_env, "d@example.org", professional=None, admin=True),
    }[who]()

    assert put(api, listing_id).status_code == 204
    assert saved_ids(api) == [listing_id]


def test_an_owner_may_save_their_own_approved_listing(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)

    assert put(owner, listing_id).status_code == 204
    assert saved_ids(owner) == [listing_id]


# -- eligibility -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "make"),
    [
        ("provider", lambda env, owner: approved_provider(env, owner)),
        ("business", lambda env, owner: approved_business(env, owner)),
        ("tutor", lambda env, owner: approved_tutor(env, owner)),
        ("property", lambda env, owner: approved(env, owner, property_body())),
        ("business", lambda env, owner: approved(env, owner, business_body(vertical="general"))),
    ],
)
def test_every_listing_kind_can_be_saved_and_comes_back_as_its_public_card(
    auth_env: AuthEnv, kind: str, make: Any
) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = make(auth_env, owner)
    resident = requester_signed_in(auth_env)

    assert put(resident, listing_id).status_code == 204
    entries = resident.get(SAVED).json()["data"]

    assert [(e["kind"], e["item"]["id"]) for e in entries] == [(kind, listing_id)]
    assert entries[0]["savedAt"]
    # the same card the public search returns for that listing
    public = auth_env.client().get(f"/listings/{listing_id}").json()["data"]
    assert entries[0]["item"]["name" if kind != "property" else "title"] == public.get(
        "name", public.get("title")
    )


@pytest.mark.parametrize(
    "status",
    [ListingStatus.PENDING, ListingStatus.REJECTED, ListingStatus.ARCHIVED],
)
def test_a_listing_that_is_not_approved_cannot_be_newly_saved(
    auth_env: AuthEnv, status: ListingStatus
) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = created_id(owner, provider_body())  # pending
    if status is not ListingStatus.PENDING:
        set_status(auth_env.session, listing_id, status)
    resident = requester_signed_in(auth_env)

    response = put(resident, listing_id)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert saved_rows(auth_env.session, "resident@example.org") == []


@pytest.mark.parametrize(
    "bad", [new_id(), "not-a-uuid", "123", "00000000-0000-0000-0000-000000000000"]
)
def test_an_unknown_or_malformed_id_cannot_be_saved(auth_env: AuthEnv, bad: str) -> None:
    resident = requester_signed_in(auth_env)

    response = put(resident, bad)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_a_news_article_is_not_saveable(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)
    news = auth_env.session.execute(text("SELECT id FROM news_articles LIMIT 1")).scalar()
    if news is None:  # the test database holds no fixtures: any other uuid proves the same rule
        news = new_id()

    assert put(resident, str(news)).status_code == 404


# -- idempotency -------------------------------------------------------------------------------------


def test_saving_twice_leaves_exactly_one_row_and_answers_204_both_times(
    auth_env: AuthEnv,
) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)

    first, second, third = (put(resident, listing_id) for _ in range(3))

    assert (first.status_code, second.status_code, third.status_code) == (204, 204, 204)
    assert first.content == b"" and second.content == b""
    assert saved_rows(auth_env.session, "resident@example.org") == [listing_id]
    assert saved_ids(resident) == [listing_id]


def test_the_database_itself_forbids_a_duplicate_saved_row(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    requester_signed_in(auth_env)
    session: Session = auth_env.session
    user_id = session.execute(
        text("SELECT id FROM users WHERE email = 'resident@example.org'")
    ).scalar_one()
    insert = text("INSERT INTO saved_items (user_id, listing_id) VALUES (:u, :l)")
    session.execute(insert, {"u": user_id, "l": listing_id})

    with (
        pytest.raises(Exception, match="saved_items_pkey|duplicate key"),
        session.begin_nested(),
    ):
        session.execute(insert, {"u": user_id, "l": listing_id})


def test_unsaving_is_idempotent_and_never_an_error(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)

    assert delete(resident, listing_id).status_code == 204  # never saved
    put(resident, listing_id)
    assert delete(resident, listing_id).status_code == 204
    assert delete(resident, listing_id).status_code == 204  # already gone
    assert delete(resident, new_id()).status_code == 204  # a listing that does not exist
    assert saved_rows(auth_env.session, "resident@example.org") == []
    assert saved_ids(resident) == []


def test_unsaving_a_malformed_id_is_the_standard_404(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)

    assert delete(resident, "not-a-uuid").status_code == 404


# -- the list ----------------------------------------------------------------------------------------


def test_the_list_is_newest_save_first_and_paginated(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    ids = [approved_provider(auth_env, owner, name=f"Provider Number {n}") for n in range(1, 4)]
    resident = requester_signed_in(auth_env)
    for index, listing_id in enumerate(ids):
        put(resident, listing_id)
        auth_env.session.execute(  # saves in one test share a transaction timestamp: space them
            text(
                "UPDATE saved_items SET created_at = created_at + make_interval(secs => :s) "
                "WHERE listing_id = :l"
            ),
            {"s": index, "l": listing_id},
        )
        auth_env.session.commit()

    page = resident.get(SAVED, params={"limit": "2", "offset": "0"})
    rest = resident.get(SAVED, params={"limit": "2", "offset": "2"})

    assert page.json()["meta"] == {"total": 3, "limit": 2, "offset": 0}
    assert [e["item"]["id"] for e in page.json()["data"]] == [ids[2], ids[1]]
    assert [e["item"]["id"] for e in rest.json()["data"]] == [ids[0]]
    assert rest.json()["meta"]["total"] == 3


@pytest.mark.parametrize(
    "params",
    [{"limit": "0"}, {"limit": "51"}, {"limit": "x"}, {"offset": "-1"}, {"offset": "100001"}],
)
def test_invalid_pagination_is_a_validation_error(
    auth_env: AuthEnv, params: dict[str, str]
) -> None:
    resident = requester_signed_in(auth_env)

    response = resident.get(SAVED, params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_user_only_ever_sees_their_own_saved_items(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    mine = approved_provider(auth_env, owner, name="Provider Mine")
    theirs = approved_provider(auth_env, owner, name="Provider Theirs")
    alice = requester_signed_in(auth_env, "alice@example.org")
    bob = requester_signed_in(auth_env, "bob@example.org")
    put(alice, mine)
    put(bob, theirs)

    assert saved_ids(alice) == [mine]
    assert saved_ids(bob) == [theirs]
    # there is no parameter or path that names another user: they are all ignored or unknown
    other_user = auth_env.session.execute(
        text("SELECT id FROM users WHERE email = 'bob@example.org'")
    ).scalar_one()
    assert saved_ids(alice, userId=str(other_user)) == [mine]
    assert alice.get(f"{SAVED}/{theirs}").status_code == 405


def test_one_users_unsave_never_touches_another_users_save(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    alice = requester_signed_in(auth_env, "alice@example.org")
    bob = requester_signed_in(auth_env, "bob@example.org")
    put(alice, listing_id)
    put(bob, listing_id)

    delete(alice, listing_id)

    assert saved_ids(alice) == [] and saved_ids(bob) == [listing_id]


# -- a saved listing that stops being public ------------------------------------------------------


def test_a_saved_listing_that_is_taken_down_disappears_and_returns_when_re_approved(
    auth_env: AuthEnv,
) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)
    put(resident, listing_id)

    set_status(auth_env.session, listing_id, ListingStatus.REJECTED)

    body = resident.get(SAVED).json()
    assert body["data"] == [] and body["meta"]["total"] == 0  # not even counted
    assert saved_rows(auth_env.session, "resident@example.org") == [listing_id]  # the row is kept
    assert listing_id not in resident.get(SAVED).text  # nothing about it leaks

    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    assert saved_ids(resident) == [listing_id]


def test_an_owner_edit_hides_the_saved_listing_until_it_is_approved_again(
    auth_env: AuthEnv,
) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)
    put(resident, listing_id)

    assert patch(owner, listing_id, 1, name="Renamed By Owner").status_code == 200  # -> pending

    assert saved_ids(resident) == []
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    assert saved_ids(resident) == [listing_id]


def test_an_archived_saved_listing_is_hidden_but_can_still_be_unsaved(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)
    put(resident, listing_id)
    assert archive(owner, listing_id, 1).status_code == 200

    assert saved_ids(resident) == []
    assert delete(resident, listing_id).status_code == 204
    assert saved_rows(auth_env.session, "resident@example.org") == []


def test_a_hidden_saved_listing_cannot_be_saved_again(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)
    put(resident, listing_id)
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED)

    assert put(resident, listing_id).status_code == 404  # the same rule as a first save


# -- privacy and shape -------------------------------------------------------------------------------


def test_the_saved_card_carries_only_public_data(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved(auth_env, owner, business_body(location=exact(visibility="approximate")))
    resident = requester_signed_in(auth_env)
    put(resident, listing_id)

    text_body = resident.get(SAVED).text

    for fragment in PRIVATE_FRAGMENTS:
        assert fragment not in text_body, fragment
    entry = resident.get(SAVED).json()["data"][0]
    assert set(entry) == {"kind", "item", "savedAt"}
    assert "status" not in entry["item"] and "rejectionReason" not in entry["item"]


def test_the_saved_card_is_the_same_as_the_public_card(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_business_named(auth_env, owner)
    resident = requester_signed_in(auth_env)
    put(resident, listing_id)

    saved_item = resident.get(SAVED).json()["data"][0]["item"]
    search_item = (
        auth_env.client()
        .get("/search", params={"q": "Capital Stationers"})
        .json()["data"][0]["item"]
    )

    assert saved_item == search_item


def approved_business_named(env: AuthEnv, owner: Any) -> str:
    return approved(env, owner, business_body())


def test_saving_changes_nothing_about_the_listing(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)
    before = stored_columns(auth_env.session, listing_id)

    put(resident, listing_id)
    put(resident, listing_id)
    delete(resident, listing_id)

    assert stored_columns(auth_env.session, listing_id) == before  # status, revision, rank inputs


def test_saved_responses_are_never_cached(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    listing_id = approved_provider(auth_env, owner)
    resident = requester_signed_in(auth_env)

    for response in (
        resident.get(SAVED),
        put(resident, listing_id),
        delete(resident, listing_id),
        put(resident, "not-a-uuid"),
        auth_env.client().get(SAVED),
    ):
        assert response.headers["cache-control"] == "no-store"


# -- cost ---------------------------------------------------------------------------------------------


def test_the_list_uses_a_bounded_number_of_queries(auth_env: AuthEnv) -> None:
    owner = provider_signed_in(auth_env)
    resident = requester_signed_in(auth_env)
    for n in range(8):
        put(resident, approved_provider(auth_env, owner, name=f"Provider Bulk {n}"))
    engine = auth_env.session.get_bind().engine
    counted: list[str] = []

    def count(_c: Any, _cur: Any, statement: str, *_: Any) -> None:
        counted.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        small = resident.get(SAVED, params={"limit": "2"})
        statements_small = len(counted)
        counted.clear()
        large = resident.get(SAVED, params={"limit": "8"})
        statements_large = len(counted)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert len(small.json()["data"]) == 2 and len(large.json()["data"]) == 8
    assert statements_large <= statements_small + 1  # independent of the page size (no N+1)


def test_the_response_is_valid_json_with_the_documented_envelope(auth_env: AuthEnv) -> None:
    resident = requester_signed_in(auth_env)

    body = json.loads(resident.get(SAVED).text)

    assert body == {"data": [], "meta": {"total": 0, "limit": 12, "offset": 0}}
