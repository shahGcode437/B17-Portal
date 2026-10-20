"""Concurrent Saved items and service-request actions against REAL committed rows on separate
connections (Phase 12F).

Guarantees under test:

* Saved: any number of simultaneous saves / unsaves of one (user, listing) never raise and leave
  zero or one row — never a duplicate, never a raw database error;
* request actions: each transition is a guarded ``UPDATE … WHERE status = :from`` behind a row
  lock, so two INCOMPATIBLE concurrent actions can not both win; the final status is always a legal
  one and the history is an unbroken chain whose length equals the number of successful actions;
* create: one requester's creates are serialised, so the frozen rate limits hold even when sent in
  parallel;
* nothing deadlocks when request writes race listing moderation and owner edits.
"""

from typing import Any

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.models.enums import PlanCode
from tests.db.admin_helpers import approve, reject
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.request_helpers import REQUESTS, SAVED, request_body
from tests.db.test_admin_concurrency import clients, set_status
from tests.db.test_listing_write_concurrency import (
    browser,
    committed_world,
    make_listing,
    race,
    statuses,
)

REASON = "Reported as closed for good."


def provider_listing(engine: Engine, owner: AuthApi, name: str = "Race Wiring Services") -> str:
    listing_id = make_listing(owner, name=name)
    set_status(engine, listing_id, "approved")
    return listing_id


def make_request(api: AuthApi, listing_id: str) -> str:
    response = api.request("POST", REQUESTS, json=request_body(listing_id))
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


def move(engine: Engine, request_id: str, status: str) -> None:
    with Session(engine) as session:
        session.execute(
            text("UPDATE service_requests SET status = :s WHERE id = :i"),
            {"s": status, "i": request_id},
        )
        session.commit()


def status_of(engine: Engine, request_id: str) -> str:
    with Session(engine) as session:
        return str(
            session.execute(
                text("SELECT status FROM service_requests WHERE id = :i"), {"i": request_id}
            ).scalar_one()
        )


def chain(engine: Engine, request_id: str) -> list[tuple[str | None, str, str]]:
    with Session(engine) as session:
        return [
            (r[0], r[1], r[2])
            for r in session.execute(
                text(
                    "SELECT from_status, to_status, actor_role FROM service_request_status_history "
                    "WHERE request_id = :i ORDER BY created_at, id"
                ),
                {"i": request_id},
            )
        ]


def saved_count(engine: Engine, listing_id: str) -> int:
    with Session(engine) as session:
        return int(
            session.execute(
                text("SELECT count(*) FROM saved_items WHERE listing_id = :l"), {"l": listing_id}
            ).scalar_one()
        )


def request_total(engine: Engine) -> int:
    with Session(engine) as session:
        return int(session.execute(text("SELECT count(*) FROM service_requests")).scalar_one())


def act(api: AuthApi, request_id: str, action: str) -> Any:
    return api.request("POST", f"{REQUESTS}/{request_id}/{action}")


def assert_unbroken_chain(
    engine: Engine, request_id: str, successes: int
) -> list[tuple[str | None, str, str]]:
    """The history is ``None -> submitted -> … -> final`` with every step's FROM equal to the
    previous step's TO, one row per successful action, and the row ends where the history does."""
    rows = chain(engine, request_id)
    assert rows[0] == (None, "submitted", "requester")
    for previous, current in zip(rows, rows[1:], strict=False):
        assert current[0] == previous[1], rows
    assert len(rows) == successes + 1, rows
    assert rows[-1][1] == status_of(engine, request_id)
    return rows


# -- Saved -------------------------------------------------------------------------------------------


def test_many_simultaneous_saves_leave_exactly_one_row(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        browser(env, "resident@example.org", professional=None)
        tabs = clients(env, "resident@example.org", 8)

        results = race(8, lambda i: tabs[i].request("PUT", f"{SAVED}/{listing_id}"))

        assert statuses(results) == [204] * 8  # no 500, no IntegrityError, no 409
        assert saved_count(db_engine, listing_id) == 1


def test_simultaneous_saves_by_different_users_each_get_their_own_row(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        people = [
            browser(env, f"person{n}@example.org", professional=None, display_name=f"Person {n}")
            for n in range(5)
        ]

        results = race(5, lambda i: people[i].request("PUT", f"{SAVED}/{listing_id}"))

        assert statuses(results) == [204] * 5
        assert saved_count(db_engine, listing_id) == 5


def test_saving_racing_unsaving_always_ends_in_a_valid_state(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        browser(env, "resident@example.org", professional=None)
        tabs = clients(env, "resident@example.org", 8)

        results = race(
            8,
            lambda i: (
                tabs[i].request("PUT", f"{SAVED}/{listing_id}")
                if i % 2 == 0
                else tabs[i].request("DELETE", f"{SAVED}/{listing_id}")
            ),
        )

        assert statuses(results) == [204] * 8  # every call is idempotent: none can fail
        assert saved_count(db_engine, listing_id) in (0, 1)
        listed = [e["item"]["id"] for e in tabs[0].get(SAVED).json()["data"]]
        assert listed == ([listing_id] if saved_count(db_engine, listing_id) else [])


def test_many_simultaneous_unsaves_are_all_fine(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        resident = browser(env, "resident@example.org", professional=None)
        resident.request("PUT", f"{SAVED}/{listing_id}")
        tabs = clients(env, "resident@example.org", 6)

        results = race(6, lambda i: tabs[i].request("DELETE", f"{SAVED}/{listing_id}"))

        assert statuses(results) == [204] * 6
        assert saved_count(db_engine, listing_id) == 0


def test_saving_racing_a_takedown_never_errors(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        admin = browser(env, "admin@example.org", professional=None, admin=True)
        browser(env, "resident@example.org", professional=None)
        (tab,) = clients(env, "resident@example.org", 1)

        results = race(
            2,
            lambda i: (
                tab.request("PUT", f"{SAVED}/{listing_id}")
                if i == 0
                else reject(admin, listing_id, 1, REASON)
            ),
        )

        save, decision = results
        assert decision.status_code == 200
        assert save.status_code in (204, 404)  # saved just before, or refused just after
        assert tab.get(SAVED).json()["data"] == []  # either way it is not listed: it is down


# -- creating ----------------------------------------------------------------------------------------


def test_parallel_requests_to_one_provider_respect_the_once_a_day_limit(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        browser(env, "resident@example.org", professional=None)
        tabs = clients(env, "resident@example.org", 6)

        results = race(
            6, lambda i: tabs[i].request("POST", REQUESTS, json=request_body(listing_id))
        )

        assert statuses(results) == [201, 429, 429, 429, 429, 429]  # exactly one gets through
        assert request_total(db_engine) == 1


def test_parallel_requests_by_one_user_respect_the_five_an_hour_limit(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listings = [provider_listing(db_engine, owner, name=f"Race Provider {n}") for n in range(8)]
        browser(env, "resident@example.org", professional=None)
        tabs = clients(env, "resident@example.org", 8)

        results = race(
            8, lambda i: tabs[i].request("POST", REQUESTS, json=request_body(listings[i]))
        )

        assert statuses(results) == [201] * 5 + [429] * 3
        assert request_total(db_engine) == 5


def test_different_requesters_do_not_block_or_limit_each_other(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = provider_listing(db_engine, owner)
        people = [
            browser(env, f"person{n}@example.org", professional=None, display_name=f"Person {n}")
            for n in range(6)
        ]

        results = race(
            6, lambda i: people[i].request("POST", REQUESTS, json=request_body(listing_id))
        )

        assert statuses(results) == [201] * 6
        assert request_total(db_engine) == 6


def test_creating_racing_a_takedown_is_consistent_and_never_deadlocks(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        admin = browser(env, "admin@example.org", professional=None, admin=True)
        listing_id = make_listing(owner, name="Race Takedown Co")
        set_status(db_engine, listing_id, "pending")
        assert approve(admin, listing_id, 1).status_code == 200
        browser(env, "resident@example.org", professional=None)
        (tab,) = clients(env, "resident@example.org", 1)

        create, decision = race(
            2,
            lambda i: (
                tab.request("POST", REQUESTS, json=request_body(listing_id))
                if i == 0
                else reject(admin, listing_id, 1, REASON)
            ),
        )

        assert decision.status_code == 200
        assert create.status_code in (201, 404)  # created against an approved listing, or refused
        assert request_total(db_engine) == (1 if create.status_code == 201 else 0)
        with Session(db_engine) as session:
            status = session.execute(
                text("SELECT status FROM listings WHERE id = :i"), {"i": listing_id}
            ).scalar_one()
        assert status == "rejected"  # the decision is never lost


# -- transitions: incompatible actions can not both win -------------------------------------------------


def lifecycle_world(env: AuthEnv, engine: Engine, extra_tabs: int = 1) -> dict[str, Any]:
    owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
    listing_id = provider_listing(engine, owner)
    requester = browser(env, "resident@example.org", professional=None)
    request_id = make_request(requester, listing_id)
    return {
        "request_id": request_id,
        "listing_id": listing_id,
        "provider": [owner, *clients(env, "owner@example.org", extra_tabs)],
        "requester": [requester, *clients(env, "resident@example.org", extra_tabs)],
    }


def test_two_accepts_exactly_one_wins(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)
        tabs = w["provider"]

        results = race(2, lambda i: act(tabs[i], w["request_id"], "accept"))

        assert statuses(results) == [200, 409]
        assert_unbroken_chain(db_engine, w["request_id"], successes=1)
        assert status_of(db_engine, w["request_id"]) == "accepted"


def test_accept_racing_a_requester_cancel_ends_cancelled_with_a_legal_history(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)

        results = race(
            2,
            lambda i: (
                act(w["provider"][0], w["request_id"], "accept")
                if i == 0
                else act(w["requester"][0], w["request_id"], "cancel")
            ),
        )

        accept, cancel = results
        assert cancel.status_code == 200  # cancelling is allowed from submitted AND accepted
        assert status_of(db_engine, w["request_id"]) == "cancelled"  # never "accepted" afterwards
        rows = assert_unbroken_chain(
            db_engine, w["request_id"], successes=1 + (1 if accept.status_code == 200 else 0)
        )
        # either cancel won first (accept refused) or accept ran first and cancel followed
        assert [r[1] for r in rows] in (
            ["submitted", "cancelled"],
            ["submitted", "accepted", "cancelled"],
        )
        assert accept.status_code in (200, 409)


def test_start_racing_a_requester_cancel_exactly_one_wins(db_engine: Engine) -> None:
    """After ``accepted`` the requester may still cancel, but not once work has started: the two
    are incompatible, so exactly one succeeds and the final status is the winner's."""
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)
        move(db_engine, w["request_id"], "accepted")

        results = race(
            2,
            lambda i: (
                act(w["provider"][0], w["request_id"], "start")
                if i == 0
                else act(w["requester"][0], w["request_id"], "cancel")
            ),
        )

        assert statuses(results) == [200, 409]
        start, cancel = results
        final = status_of(db_engine, w["request_id"])
        assert final == ("in-progress" if start.status_code == 200 else "cancelled")
        assert cancel.status_code == (409 if start.status_code == 200 else 200)


def test_complete_racing_a_requester_cancel_always_completes(db_engine: Engine) -> None:
    """The requester can never cancel work in progress, whatever the timing."""
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)
        move(db_engine, w["request_id"], "in-progress")

        results = race(
            2,
            lambda i: (
                act(w["provider"][0], w["request_id"], "complete")
                if i == 0
                else act(w["requester"][0], w["request_id"], "cancel")
            ),
        )

        complete, cancel = results
        assert (complete.status_code, cancel.status_code) == (200, 409)
        assert status_of(db_engine, w["request_id"]) == "completed"


def test_complete_racing_a_provider_cancel_exactly_one_wins(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)
        move(db_engine, w["request_id"], "in-progress")
        tabs = w["provider"]

        results = race(
            2,
            lambda i: act(tabs[i], w["request_id"], "complete" if i == 0 else "cancel"),
        )

        assert statuses(results) == [200, 409]
        complete, cancel = results
        assert status_of(db_engine, w["request_id"]) == (
            "completed" if complete.status_code == 200 else "cancelled"
        )
        assert cancel.status_code == (409 if complete.status_code == 200 else 200)


def test_two_starts_and_two_completes_exactly_one_wins_each(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)
        tabs = w["provider"]
        move(db_engine, w["request_id"], "accepted")
        first = race(2, lambda i: act(tabs[i], w["request_id"], "start"))
        second = race(2, lambda i: act(tabs[i], w["request_id"], "complete"))

        assert statuses(first) == [200, 409] and statuses(second) == [200, 409]
        assert status_of(db_engine, w["request_id"]) == "completed"


def test_cancel_by_both_parties_at_once_exactly_one_wins(db_engine: Engine) -> None:
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine)

        results = race(
            2,
            lambda i: act(
                (w["provider"] if i == 0 else w["requester"])[0], w["request_id"], "cancel"
            ),
        )

        assert statuses(results) == [200, 409]
        rows = assert_unbroken_chain(db_engine, w["request_id"], successes=1)
        assert rows[-1][1] == "cancelled"
        assert rows[-1][2] in ("provider", "requester")


def test_a_free_for_all_always_leaves_a_legal_status_and_an_unbroken_history(
    db_engine: Engine,
) -> None:
    """Every action by both parties, several copies of each, all released together."""
    legal: dict[tuple[str, str], tuple[set[str], str]] = {
        ("provider", "accept"): ({"submitted"}, "accepted"),
        ("provider", "start"): ({"accepted"}, "in-progress"),
        ("provider", "complete"): ({"in-progress"}, "completed"),
        ("provider", "cancel"): ({"submitted", "accepted", "in-progress"}, "cancelled"),
        ("requester", "cancel"): ({"submitted", "accepted"}, "cancelled"),
    }
    plan = [
        ("provider", "accept"), ("provider", "accept"), ("requester", "cancel"),
        ("provider", "start"), ("provider", "complete"), ("provider", "cancel"),
        ("requester", "cancel"), ("provider", "start"),
    ]  # fmt: skip
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine, extra_tabs=len(plan))

        results = race(
            len(plan),
            lambda i: act(
                w["provider" if plan[i][0] == "provider" else "requester"][i],
                w["request_id"],
                plan[i][1],
            ),
        )

        successes = sum(1 for r in results if r.status_code == 200)
        assert all(r.status_code in (200, 403, 409) for r in results), [
            r.status_code for r in results
        ]
        rows = assert_unbroken_chain(db_engine, w["request_id"], successes)
        for previous, step, actor in rows[1:]:
            allowed = [
                sources
                for (role, _a), (sources, to) in legal.items()
                if role == actor and to == step
            ]
            assert any(previous in sources for sources in allowed), rows


def test_request_actions_racing_moderation_and_owner_edits_never_deadlock(
    db_engine: Engine,
) -> None:
    with committed_world(db_engine) as env:
        w = lifecycle_world(env, db_engine, extra_tabs=2)
        admin = browser(env, "admin@example.org", professional=None, admin=True)
        other = browser(env, "other@example.org", professional=None, display_name="Other Person")

        def work(i: int) -> Any:
            if i == 0:
                return act(w["provider"][0], w["request_id"], "accept")
            if i == 1:
                return act(w["requester"][0], w["request_id"], "cancel")
            if i == 2:
                return reject(admin, w["listing_id"], 1, REASON)
            if i == 3:
                return w["provider"][1].request(
                    "PATCH",
                    f"/listings/{w['listing_id']}",
                    json={"revision": 1, "name": "Renamed During The Race"},
                )
            if i == 4:
                return other.request("POST", REQUESTS, json=request_body(w["listing_id"]))
            return w["requester"][1].request("PUT", f"{SAVED}/{w['listing_id']}")

        results = race(6, work)  # race() fails the test if any request is stuck

        for result in results:
            assert not isinstance(result, Exception), result
            assert result.status_code < 500, result.text
        assert status_of(db_engine, w["request_id"]) in ("accepted", "cancelled")
