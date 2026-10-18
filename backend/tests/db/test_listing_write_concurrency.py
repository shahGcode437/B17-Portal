"""Concurrent writes against REAL committed rows on separate connections (Phase 12D).

These are the guarantees the savepoint-isolated tests cannot prove: the row lock + guarded UPDATE
make a lost update impossible, quota checks are serialised per owner, the idempotent profile PUT
leaves one row, and the lock order (profile -> listing) cannot deadlock. Every request here runs
through the real HTTP stack with its OWN database session.
"""

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import FastAPI
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.dependencies.db import get_db_session
from app.factory import create_app
from app.models import Listing, ListingStatusHistory, ProfessionalProfile
from app.models.enums import ListingStatus, PlanCode
from app.services.email import MemoryEmailSender
from tests.db.auth_helpers import (
    AuthApi,
    AuthEnv,
    FakeClock,
    fast_passwords,
    make_account,
    make_test_settings,
)
from tests.write_payloads import (
    LISTINGS,
    PROFILE,
    business_body,
    exact,
    provider_body,
)

TABLES = (
    "users, auth_sessions, auth_tokens, auth_events, auth_rate_limits, "
    "listings, professional_profiles, listing_status_history"
)


@contextmanager
def committed_world(engine: Engine) -> Iterator[AuthEnv]:
    """The real app with a NEW database session per request, over committed data."""
    app: FastAPI = create_app(make_test_settings())

    def session_per_request() -> Iterator[Session]:
        session = Session(engine, expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db_session] = session_per_request
    clock = FakeClock()
    app.state.clock = clock
    app.state.email_sender = MemoryEmailSender()
    app.state.password_service = fast_passwords()
    setup = Session(engine, expire_on_commit=False)
    env = AuthEnv(app, setup, clock, app.state.email_sender, make_test_settings())
    try:
        yield env
    finally:
        setup.close()
        for api in env._apis:
            api.http.close()
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE {TABLES} CASCADE"))


def browser(env: AuthEnv, email: str, **account: Any) -> AuthApi:
    make_account(env.session, email, **account)
    api = env.client()
    assert api.login(email).status_code == 200
    return api


def race(count: int, work: Callable[[int], Any]) -> list[Any]:
    """Run ``work(i)`` on ``count`` threads released at the same instant."""
    barrier = threading.Barrier(count)
    results: list[Any] = [None] * count

    def runner(index: int) -> None:
        barrier.wait()
        try:
            results[index] = work(index)
        except Exception as error:  # surfaced to the assertions below
            results[index] = error

    threads = [threading.Thread(target=runner, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=90)
        assert not thread.is_alive(), "a request is stuck (deadlock?)"
    return results


def statuses(results: list[Any]) -> list[int]:
    for result in results:
        assert not isinstance(result, Exception), result
    return sorted(result.status_code for result in results)


def listing_row(engine: Engine, listing_id: str) -> dict[str, Any]:
    with Session(engine) as session:
        row = (
            session.execute(
                text("SELECT status, revision, title FROM listings WHERE id = :i"),
                {"i": listing_id},
            )
            .mappings()
            .one()
        )
        return dict(row)


def history_actions(engine: Engine, listing_id: str) -> list[str]:
    with Session(engine) as session:
        return [
            f"{h.action.value}:{h.revision}"
            for h in session.scalars(
                select(ListingStatusHistory)
                .where(ListingStatusHistory.listing_id == listing_id)
                .order_by(ListingStatusHistory.revision, ListingStatusHistory.created_at)
            )
        ]


def make_listing(owner: AuthApi, **body: Any) -> str:
    response = owner.request("POST", LISTINGS, json=provider_body(**body))
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


# -- optimistic concurrency ------------------------------------------------------------------------------


def test_two_edits_with_the_same_revision_exactly_one_wins(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        listing_id = make_listing(owner)
        second = env.client()
        second.login("sana@example.org")
        clients = [owner, second]

        results = race(
            2,
            lambda i: clients[i].request(
                "PATCH",
                f"{LISTINGS}/{listing_id}",
                json={"revision": 1, "name": f"Winner {i} Name"},
            ),
        )

        assert statuses(results) == [200, 409]
        loser = next(r for r in results if r.status_code == 409)
        assert loser.json()["error"]["code"] == "listing_conflict"
        row = listing_row(db_engine, listing_id)
        assert row["revision"] == 2  # incremented once: no lost update, no double bump
        winner = next(i for i, r in enumerate(results) if r.status_code == 200)
        assert row["title"] == f"Winner {winner} Name"
        assert history_actions(db_engine, listing_id) == ["submitted:1", "resubmitted:2"]


def test_many_edits_with_one_revision_still_have_one_winner(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        listing_id = make_listing(owner)
        clients = [owner, *[env.client() for _ in range(5)]]
        for extra in clients[1:]:
            extra.login("sana@example.org")

        results = race(
            6,
            lambda i: clients[i].request(
                "PATCH",
                f"{LISTINGS}/{listing_id}",
                json={"revision": 1, "name": f"Edit Number {i}"},
            ),
        )

        assert statuses(results) == [200, 409, 409, 409, 409, 409]
        assert listing_row(db_engine, listing_id)["revision"] == 2
        assert history_actions(db_engine, listing_id) == ["submitted:1", "resubmitted:2"]


def test_sequential_edits_each_need_the_previous_revision(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        listing_id = make_listing(owner)

        for revision in (1, 2, 3):
            response = owner.request(
                "PATCH",
                f"{LISTINGS}/{listing_id}",
                json={"revision": revision, "name": f"Edit At {revision}"},
            )
            assert (
                response.status_code == 200 and response.json()["data"]["revision"] == revision + 1
            )
        assert listing_row(db_engine, listing_id)["revision"] == 4


def test_archive_and_edit_with_the_same_revision_leave_a_consistent_listing(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        listing_id = make_listing(owner)
        other = env.client()
        other.login("sana@example.org")

        results = race(
            2,
            lambda i: (
                owner.request("POST", f"{LISTINGS}/{listing_id}/archive", json={"revision": 1})
                if i == 0
                else other.request(
                    "PATCH",
                    f"{LISTINGS}/{listing_id}",
                    json={"revision": 1, "name": "Late Edit Name"},
                )
            ),
        )

        archive_result, edit_result = results
        row = listing_row(db_engine, listing_id)
        assert row["revision"] == 2
        if archive_result.status_code == 200:
            # archive won: the edit meets a terminal listing (or, if it was already waiting on the
            # lock with revision 1, a changed one) — never a half-applied edit
            assert edit_result.status_code == 409
            assert edit_result.json()["error"]["code"] in (
                "invalid_state_transition",
                "listing_conflict",
            )
            assert row["status"] == "archived" and row["title"] == "Bright Spark Electricians"
            assert history_actions(db_engine, listing_id) == ["submitted:1", "archived:2"]
        else:
            assert (edit_result.status_code, archive_result.status_code) == (200, 409)
            assert archive_result.json()["error"]["code"] == "listing_conflict"
            assert row["status"] == "pending" and row["title"] == "Late Edit Name"
            assert history_actions(db_engine, listing_id) == ["submitted:1", "resubmitted:2"]


def test_a_narrowing_and_a_material_edit_race_on_an_approved_listing(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        response = owner.request("POST", LISTINGS, json=business_body(location=exact()))
        listing_id = str(response.json()["data"]["id"])
        with Session(db_engine) as session:
            session.execute(text("UPDATE listings SET status = 'approved'"))
            session.commit()
        other = env.client()
        other.login("sana@example.org")

        results = race(
            2,
            lambda i: (
                owner.request(
                    "PATCH",
                    f"{LISTINGS}/{listing_id}",
                    json={"revision": 1, "location": exact(visibility="approximate")},
                )
                if i == 0
                else other.request(
                    "PATCH",
                    f"{LISTINGS}/{listing_id}",
                    json={"revision": 1, "name": "Renamed In Race"},
                )
            ),
        )

        assert statuses(results) == [200, 409]
        row = listing_row(db_engine, listing_id)
        assert row["revision"] == 2
        if results[0].status_code == 200:  # the narrowing won: still approved, no history row
            assert row["status"] == "approved"
            assert history_actions(db_engine, listing_id) == ["submitted:1"]
        else:  # the material edit won: back to moderation
            assert row["status"] == "pending"
            assert history_actions(db_engine, listing_id) == ["submitted:1", "resubmitted:2"]


# -- the professional profile -----------------------------------------------------------------------------


def test_concurrent_profile_puts_leave_exactly_one_profile(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        make_account(env.session, "sana@example.org", professional=None)
        clients = [env.client() for _ in range(6)]
        for client in clients:
            assert client.login("sana@example.org").status_code == 200

        results = race(6, lambda i: clients[i].request("PUT", PROFILE, json={}))

        assert statuses(results) == [200, 200, 200, 200, 200, 201]  # one creator
        with Session(db_engine) as session:
            assert session.scalar(select(func.count()).select_from(ProfessionalProfile)) == 1


# -- quota and lock order ----------------------------------------------------------------------------------


def test_concurrent_creates_cannot_exceed_the_free_quota(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        make_listing(owner, name="Existing One")
        make_listing(owner, name="Existing Two")
        clients = [owner, *[env.client() for _ in range(4)]]
        for extra in clients[1:]:
            extra.login("sana@example.org")

        results = race(
            5,
            lambda i: clients[i].request(
                "POST", LISTINGS, json=provider_body(name=f"Racer Number {i}")
            ),
        )

        assert statuses(results) == [201, 403, 403, 403, 403]
        assert all(
            r.json()["error"]["code"] == "plan_limit_reached"
            for r in results
            if r.status_code == 403
        )
        with Session(db_engine) as session:
            active = session.scalar(
                select(func.count())
                .select_from(Listing)
                .where(Listing.status.in_((ListingStatus.PENDING, ListingStatus.APPROVED)))
            )
            assert active == 3  # the quota held under contention


def test_concurrent_resubmissions_into_a_full_quota_are_both_refused_without_deadlock(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        ids = [make_listing(owner, name=f"Listing Number {n}") for n in (1, 2, 3)]
        with Session(db_engine) as session:
            session.execute(
                text("UPDATE listings SET status = 'rejected' WHERE id IN (:a, :b)"),
                {"a": ids[0], "b": ids[1]},
            )
            session.commit()  # active = 1
        for n in (4, 5):
            make_listing(owner, name=f"Refill Number {n}")  # active = 3: the free plan is full
        other = env.client()
        other.login("sana@example.org")
        clients = [owner, other]

        results = race(
            2,
            lambda i: clients[i].request(
                "PATCH", f"{LISTINGS}/{ids[i]}", json={"revision": 1, "name": f"Fixed Listing {i}"}
            ),
        )

        assert statuses(results) == [403, 403]
        assert all(r.json()["error"]["code"] == "plan_limit_reached" for r in results)
        with Session(db_engine) as session:
            rejected = session.scalar(
                select(func.count())
                .select_from(Listing)
                .where(Listing.status == ListingStatus.REJECTED)
            )
            assert rejected == 2  # neither slipped in


def test_concurrent_resubmissions_with_one_free_slot_admit_exactly_one(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.FREE)
        ids = [make_listing(owner, name=f"Listing Number {n}") for n in (1, 2, 3)]
        with Session(db_engine) as session:
            session.execute(
                text("UPDATE listings SET status = 'rejected' WHERE id IN (:a, :b)"),
                {"a": ids[0], "b": ids[1]},
            )
            session.commit()  # active = 1 (ids[2]); two rejected both want back in; free limit 3
        make_listing(owner, name="Refill Number 4")  # active = 2: exactly ONE slot is free
        other = env.client()
        other.login("sana@example.org")
        clients = [owner, other]

        results = race(
            2,
            lambda i: clients[i].request(
                "PATCH", f"{LISTINGS}/{ids[i]}", json={"revision": 1, "name": f"Fixed Listing {i}"}
            ),
        )

        assert statuses(results) == [200, 403]  # one gets the slot, the other is refused
        with Session(db_engine) as session:
            active = session.scalar(
                select(func.count())
                .select_from(Listing)
                .where(Listing.status.in_((ListingStatus.PENDING, ListingStatus.APPROVED)))
            )
            assert active == 3


def test_edits_of_different_listings_by_one_owner_do_not_block_each_other(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "sana@example.org", professional=PlanCode.PREMIUM)
        ids = [make_listing(owner, name=f"Listing Number {n}") for n in range(4)]
        clients = [owner, *[env.client() for _ in range(3)]]
        for extra in clients[1:]:
            extra.login("sana@example.org")

        results = race(
            4,
            lambda i: clients[i].request(
                "PATCH", f"{LISTINGS}/{ids[i]}", json={"revision": 1, "name": f"Renamed Number {i}"}
            ),
        )

        assert statuses(results) == [200, 200, 200, 200]
