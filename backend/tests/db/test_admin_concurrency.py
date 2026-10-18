"""Concurrent Admin moderation and taxonomy writes against REAL committed rows on separate
connections (Phase 12E).

Moderation acts ON the reviewed revision and never bumps it, so an Admin decision and an owner edit
that start from the same revision do not exclude each other the way two owner edits do — the
guarantee is instead that every outcome is a *consistent* one: the owner's edit is never lost, an
approval is only ever applied to the exact content that was reviewed, the history tells the same
story as the final row, and nothing deadlocks. Taxonomy writes serialise on the taxonomy lock, which
every listing writer takes first (shared), so a rename + reindex and a listing write can never leave
a stale category name in a search document.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.models import Category
from app.models.enums import PlanCode
from app.repositories.taxonomy import TAXONOMY_LOCK_KEY
from app.services.search_index import SearchIndexer
from tests.db.admin_helpers import ADMIN_CATEGORIES, ADMIN_LISTINGS
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.test_listing_write_concurrency import (
    browser,
    committed_world,
    history_actions,
    listing_row,
    make_listing,
    race,
    statuses,
)
from tests.write_payloads import LISTINGS, business_body, exact, food_body, provider_body

REASON = "Please add your opening hours and a clearer description."


@contextmanager
def admin_world(engine: Engine) -> Iterator[AuthEnv]:
    """``committed_world`` plus cleanup of the categories these tests create (slug ``cc-…``)."""
    try:
        with committed_world(engine) as env:
            yield env
    finally:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM categories WHERE slug LIKE 'cc-%' AND parent_id IS NOT NULL")
            )
            connection.execute(text("DELETE FROM categories WHERE slug LIKE 'cc-%'"))


def clients(env: AuthEnv, email: str, count: int) -> list[AuthApi]:
    """``count`` independent browsers (cookie jars, sessions) of one account."""
    made = []
    for _ in range(count):
        api = env.client()
        assert api.login(email).status_code == 200
        made.append(api)
    return made


def admin_account(env: AuthEnv, email: str = "admin@example.org", count: int = 1) -> list[AuthApi]:
    first = browser(env, email, professional=None, admin=True, display_name="Site Admin")
    return [first, *clients(env, email, count - 1)]


def approve(api: AuthApi, listing_id: str, revision: int) -> Any:
    return api.request(
        "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": revision}
    )


def reject(api: AuthApi, listing_id: str, revision: int) -> Any:
    return api.request(
        "POST",
        f"{ADMIN_LISTINGS}/{listing_id}/reject",
        json={"revision": revision, "reason": REASON},
    )


def edit(api: AuthApi, listing_id: str, revision: int, **fields: Any) -> Any:
    return api.request("PATCH", f"{LISTINGS}/{listing_id}", json={"revision": revision, **fields})


def code(response: Any) -> str:
    return str(response.json()["error"]["code"])


def public_status(env: AuthEnv, listing_id: str) -> int:
    return int(env.client().get(f"/listings/{listing_id}").status_code)


def stale_documents(engine: Engine) -> list[Any]:
    with Session(engine) as session:
        return SearchIndexer(session).find_stale()


def set_status(engine: Engine, listing_id: str, status: str) -> None:
    with Session(engine) as session:
        session.execute(
            text("UPDATE listings SET status = :s WHERE id = :i"), {"s": status, "i": listing_id}
        )
        session.commit()


# -- Admin decision vs owner edit ------------------------------------------------------------------------


def test_approve_racing_an_owner_edit_never_publishes_unreviewed_content(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        owner_tab = clients(env, "owner@example.org", 1)[0]
        (admin,) = admin_account(env)
        listing_id = make_listing(owner)

        results = race(
            2,
            lambda i: (
                approve(admin, listing_id, 1)
                if i == 0
                else edit(owner_tab, listing_id, 1, name="Rewritten In Race")
            ),
        )

        admin_result, owner_result = results
        assert owner_result.status_code == 200  # the owner's edit is never lost
        row = listing_row(db_engine, listing_id)
        assert (row["status"], row["revision"], row["title"]) == ("pending", 2, "Rewritten In Race")
        assert public_status(env, listing_id) == 404  # the NEW content is not public until reviewed
        if admin_result.status_code == 200:  # approved the reviewed content, then it was edited out
            assert history_actions(db_engine, listing_id) == [
                "submitted:1",
                "approved:1",
                "resubmitted:2",
            ]
        else:  # the edit committed first: the approval of revision 1 was refused
            assert (admin_result.status_code, code(admin_result)) == (409, "listing_conflict")
            assert history_actions(db_engine, listing_id) == ["submitted:1", "resubmitted:2"]
        assert stale_documents(db_engine) == []


def test_reject_racing_an_owner_edit_keeps_the_edit_and_a_truthful_history(
    db_engine: Engine,
) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        owner_tab = clients(env, "owner@example.org", 1)[0]
        (admin,) = admin_account(env)
        listing_id = make_listing(owner)

        results = race(
            2,
            lambda i: (
                reject(admin, listing_id, 1)
                if i == 0
                else edit(owner_tab, listing_id, 1, name="Fixed In Race")
            ),
        )

        admin_result, owner_result = results
        assert owner_result.status_code == 200
        row = listing_row(db_engine, listing_id)
        assert (row["status"], row["revision"], row["title"]) == ("pending", 2, "Fixed In Race")
        history = history_actions(db_engine, listing_id)
        if admin_result.status_code == 200:  # rejected first, then the owner's fix resubmitted it
            assert history == ["submitted:1", "rejected:1", "resubmitted:2"]
        else:
            assert (admin_result.status_code, code(admin_result)) == (409, "listing_conflict")
            assert history == ["submitted:1", "resubmitted:2"]


def test_approve_racing_a_privacy_narrowing_ends_in_a_consistent_state(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        owner_tab = clients(env, "owner@example.org", 1)[0]
        (admin,) = admin_account(env)
        response = owner.request("POST", LISTINGS, json=business_body(location=exact()))
        listing_id = str(response.json()["data"]["id"])

        results = race(
            2,
            lambda i: (
                approve(admin, listing_id, 1)
                if i == 0
                else edit(owner_tab, listing_id, 1, location=exact(visibility="approximate"))
            ),
        )

        admin_result, owner_result = results
        assert owner_result.status_code == 200  # a narrowing always applies
        row = listing_row(db_engine, listing_id)
        assert row["revision"] == 2
        if (
            admin_result.status_code == 200
        ):  # approved, then narrowed: a narrowing keeps the approval
            assert row["status"] == "approved"
            assert history_actions(db_engine, listing_id) == ["submitted:1", "approved:1"]
        else:  # narrowed first: the approval of the old revision was refused
            assert (admin_result.status_code, code(admin_result)) == (409, "listing_conflict")
            assert row["status"] == "pending"
            assert history_actions(db_engine, listing_id) == ["submitted:1"]
        assert stale_documents(db_engine) == []


def test_a_takedown_racing_an_owner_edit_of_an_approved_listing(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        owner_tab = clients(env, "owner@example.org", 1)[0]
        (admin,) = admin_account(env)
        listing_id = make_listing(owner)
        assert approve(admin, listing_id, 1).status_code == 200

        results = race(
            2,
            lambda i: (
                reject(admin, listing_id, 1)
                if i == 0
                else edit(owner_tab, listing_id, 1, name="Edited In Race")
            ),
        )

        admin_result, owner_result = results
        assert owner_result.status_code == 200
        row = listing_row(db_engine, listing_id)
        assert (row["status"], row["revision"], row["title"]) == ("pending", 2, "Edited In Race")
        assert public_status(env, listing_id) == 404
        history = history_actions(db_engine, listing_id)
        if admin_result.status_code == 200:  # taken down, then the owner's edit resubmitted it
            assert history == ["submitted:1", "approved:1", "rejected:1", "resubmitted:2"]
        else:  # the edit won (approved -> pending): the takedown of revision 1 is stale
            assert (admin_result.status_code, code(admin_result)) == (409, "listing_conflict")
            assert history == ["submitted:1", "approved:1", "resubmitted:2"]


# -- Admin vs Admin ----------------------------------------------------------------------------------------


def test_two_admins_approving_the_same_revision_have_exactly_one_winner(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        admins = admin_account(env, count=6)
        listing_id = make_listing(owner)

        results = race(6, lambda i: approve(admins[i], listing_id, 1))

        assert statuses(results) == [200, 409, 409, 409, 409, 409]
        assert {code(r) for r in results if r.status_code == 409} == {"invalid_state_transition"}
        assert history_actions(db_engine, listing_id) == ["submitted:1", "approved:1"]  # one row


def test_two_admins_rejecting_the_same_revision_have_exactly_one_winner(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        admins = admin_account(env, count=4)
        listing_id = make_listing(owner)

        results = race(4, lambda i: reject(admins[i], listing_id, 1))

        assert statuses(results) == [200, 409, 409, 409]
        assert history_actions(db_engine, listing_id) == ["submitted:1", "rejected:1"]


def test_approve_racing_reject_always_ends_rejected_with_a_truthful_history(
    db_engine: Engine,
) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        admins = admin_account(env, count=2)
        listing_id = make_listing(owner)

        results = race(
            2,
            lambda i: (
                approve(admins[0], listing_id, 1) if i == 0 else reject(admins[1], listing_id, 1)
            ),
        )

        approve_result, reject_result = results
        assert (
            reject_result.status_code == 200
        )  # a pending listing can always be rejected, and so can an approved one
        assert listing_row(db_engine, listing_id)["status"] == "rejected"
        if approve_result.status_code == 200:  # approved, then taken down
            assert history_actions(db_engine, listing_id) == [
                "submitted:1",
                "approved:1",
                "rejected:1",
            ]
        else:
            assert (approve_result.status_code, code(approve_result)) == (
                409,
                "invalid_state_transition",
            )
            assert history_actions(db_engine, listing_id) == ["submitted:1", "rejected:1"]
        assert public_status(env, listing_id) == 404


# -- taxonomy ------------------------------------------------------------------------------------------------


def test_concurrent_creates_of_one_slug_leave_exactly_one_category(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        admins = admin_account(env, count=6)

        results = race(
            6,
            lambda i: admins[i].request(
                "POST",
                ADMIN_CATEGORIES,
                json={"module": "food", "name": f"CC Same {i}", "slug": "cc-same"},
            ),
        )

        assert statuses(results) == [
            201,
            409,
            409,
            409,
            409,
            409,
        ]  # never a raw IntegrityError / 500
        assert {code(r) for r in results if r.status_code == 409} == {"conflict"}
        with Session(db_engine) as session:
            assert (
                session.scalar(
                    select(func.count()).select_from(Category).where(Category.slug == "cc-same")
                )
                == 1
            )


def test_concurrent_creates_of_one_name_leave_exactly_one_category(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        admins = admin_account(env, count=5)

        results = race(
            5,
            lambda i: admins[i].request(
                "POST",
                ADMIN_CATEGORIES,
                json={"module": "food", "name": "CC Twin", "slug": f"cc-twin-{i}"},
            ),
        )

        assert statuses(results) == [
            201,
            409,
            409,
            409,
            409,
        ]  # the name rule has no unique index: the lock holds it
        with Session(db_engine) as session:
            assert (
                session.scalar(
                    select(func.count()).select_from(Category).where(Category.name == "CC Twin")
                )
                == 1
            )


def test_concurrent_reorders_of_one_group_leave_a_valid_permutation(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        first, second = admin_account(env, count=2)
        root = first.request(
            "POST",
            ADMIN_CATEGORIES,
            json={"module": "services", "name": "CC Root", "slug": "cc-root"},
        ).json()["data"]
        kids = [
            first.request(
                "POST",
                ADMIN_CATEGORIES,
                json={
                    "module": "services",
                    "name": f"CC Kid {n}",
                    "slug": f"cc-kid-{n}",
                    "parentId": root["id"],
                },
            ).json()["data"]["id"]
            for n in range(5)
        ]
        orders = [kids, list(reversed(kids))]

        results = race(
            2,
            lambda i: (first, second)[i].request(
                "POST",
                f"{ADMIN_CATEGORIES}/reorder",
                json={"module": "services", "parentId": root["id"], "orderedIds": orders[i]},
            ),
        )

        assert statuses(results) == [200, 200]  # serialised, both applied
        with Session(db_engine) as session:
            rows = session.execute(
                text("SELECT id, display_order FROM categories WHERE parent_id = :p"),
                {"p": root["id"]},
            ).all()
        by_id = {str(row[0]): row[1] for row in rows}
        final = sorted(by_id, key=lambda key: by_id[key])
        assert sorted(by_id.values()) == [1, 2, 3, 4, 5]  # no duplicate, no gap
        assert final in orders  # exactly one of the two requested orders, never a blend


def test_a_rename_and_a_deactivation_of_one_category_both_apply(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        first, second = admin_account(env, count=2)
        created = first.request(
            "POST", ADMIN_CATEGORIES, json={"module": "food", "name": "CC Old", "slug": "cc-old"}
        ).json()["data"]

        results = race(
            2,
            lambda i: (
                first.request(
                    "PATCH", f"{ADMIN_CATEGORIES}/{created['id']}", json={"name": "CC Renamed"}
                )
                if i == 0
                else second.request(
                    "PATCH", f"{ADMIN_CATEGORIES}/{created['id']}", json={"isActive": False}
                )
            ),
        )

        assert statuses(results) == [200, 200]
        with Session(db_engine) as session:
            row = session.execute(
                text("SELECT name, is_active FROM categories WHERE slug = 'cc-old'")
            ).one()
        assert (row[0], row[1]) == ("CC Renamed", False)  # no lost update: each field kept


def test_two_renames_to_the_same_name_have_one_winner(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        first, second = admin_account(env, count=2)
        a = first.request(
            "POST", ADMIN_CATEGORIES, json={"module": "food", "name": "CC A", "slug": "cc-a"}
        ).json()["data"]
        b = first.request(
            "POST", ADMIN_CATEGORIES, json={"module": "food", "name": "CC B", "slug": "cc-b"}
        ).json()["data"]

        results = race(
            2,
            lambda i: (first, second)[i].request(
                "PATCH", f"{ADMIN_CATEGORIES}/{(a, b)[i]['id']}", json={"name": "CC Target"}
            ),
        )

        assert statuses(results) == [200, 409]
        with Session(db_engine) as session:
            assert (
                session.scalar(
                    select(func.count()).select_from(Category).where(Category.name == "CC Target")
                )
                == 1
            )


# -- the taxonomy lock: a rename vs the listing writers that link categories ----------------------------------


def test_a_rename_racing_listing_creations_never_leaves_a_stale_category_name(
    db_engine: Engine,
) -> None:
    with admin_world(db_engine) as env:
        (admin,) = admin_account(env)
        admin.request(
            "POST",
            ADMIN_CATEGORIES,
            json={"module": "food", "name": "CC Old Label", "slug": "cc-label"},
        )
        owners = [
            browser(
                env,
                f"owner{n}@example.org",
                professional=PlanCode.PREMIUM,
                display_name=f"Owner {n}",
            )
            for n in range(5)
        ]

        def work(i: int) -> Any:
            if i == 0:
                category = admin.request("GET", ADMIN_CATEGORIES, params={"module": "food"}).json()[
                    "data"
                ]
                target = next(row["id"] for row in category if row["slug"] == "cc-label")
                return admin.request(
                    "PATCH", f"{ADMIN_CATEGORIES}/{target}", json={"name": "CC New Label"}
                )
            body = food_body(name=f"Racing Place {i}")
            body["food"]["categories"] = ["cc-label"]
            return owners[i].request("POST", LISTINGS, json=body)

        results = race(5, work)

        assert statuses(results) == [200, 201, 201, 201, 201]  # no 500, no deadlock
        assert stale_documents(db_engine) == []
        with Session(db_engine) as session:
            documents = [
                row[0]
                for row in session.execute(text("SELECT search_document FROM listings")).all()
            ]
        assert len(documents) == 4
        assert all("cc new label" in doc and "cc old label" not in doc for doc in documents)


def test_a_rename_racing_listing_edits_that_link_the_category_stays_consistent(
    db_engine: Engine,
) -> None:
    with admin_world(db_engine) as env:
        (admin,) = admin_account(env)
        admin.request(
            "POST",
            ADMIN_CATEGORIES,
            json={"module": "food", "name": "CC Edit Old", "slug": "cc-edit"},
        )
        owner_accounts = [
            browser(
                env,
                f"owner{n}@example.org",
                professional=PlanCode.PREMIUM,
                display_name=f"Owner {n}",
            )
            for n in range(4)
        ]
        ids = []
        for api in owner_accounts:
            response = api.request("POST", LISTINGS, json=food_body(name="Edit Subject"))
            ids.append(str(response.json()["data"]["id"]))

        def work(i: int) -> Any:
            if i == 0:
                rows = admin.request("GET", ADMIN_CATEGORIES, params={"module": "food"}).json()[
                    "data"
                ]
                target = next(row["id"] for row in rows if row["slug"] == "cc-edit")
                return admin.request(
                    "PATCH", f"{ADMIN_CATEGORIES}/{target}", json={"name": "CC Edit New"}
                )
            return edit(
                owner_accounts[i - 1], ids[i - 1], 1, food={"categories": ["cc-edit", "bakeries"]}
            )

        results = race(5, work)

        assert statuses(results) == [200, 200, 200, 200, 200]
        assert stale_documents(db_engine) == []
        with Session(db_engine) as session:
            documents = [
                row[0]
                for row in session.execute(text("SELECT search_document FROM listings")).all()
            ]
        assert all("cc edit new" in doc and "cc edit old" not in doc for doc in documents)


def test_a_mixed_storm_of_owner_admin_and_taxonomy_writes_neither_deadlocks_nor_corrupts(
    db_engine: Engine,
) -> None:
    with admin_world(db_engine) as env:
        admins = admin_account(env, count=3)
        admins[0].request(
            "POST",
            ADMIN_CATEGORIES,
            json={"module": "food", "name": "CC Storm", "slug": "cc-storm"},
        )
        owners = [
            browser(
                env,
                f"owner{n}@example.org",
                professional=PlanCode.PREMIUM,
                display_name=f"Owner {n}",
            )
            for n in range(3)
        ]
        listing_ids = [
            make_listing(owner, name=f"Storm Listing {n}") for n, owner in enumerate(owners)
        ]
        storm = admins[0].request("GET", ADMIN_CATEGORIES, params={"module": "food"}).json()["data"]
        category = next(row["id"] for row in storm if row["slug"] == "cc-storm")

        def work(i: int) -> Any:
            kind = i % 6
            if kind == 0:
                return admins[0].request(
                    "PATCH", f"{ADMIN_CATEGORIES}/{category}", json={"name": f"CC Storm {i}"}
                )
            if kind == 1:
                return approve(admins[1], listing_ids[0], 1)
            if kind == 2:
                return reject(admins[2], listing_ids[1], 1)
            if kind == 3:
                return edit(owners[0], listing_ids[0], 1, name=f"Storm Edit {i}")
            if kind == 4:
                return edit(owners[1], listing_ids[1], 1, name=f"Storm Fix {i}")
            body = food_body(name=f"Storm New {i}")
            body["food"]["categories"] = ["cc-storm"]
            return owners[2].request("POST", LISTINGS, json=body)

        results = race(12, work)

        for result in results:
            assert not isinstance(result, Exception), result
            assert result.status_code < 500, (result.status_code, result.text)
            assert result.status_code in (200, 201, 409, 403), (result.status_code, result.text)
        assert stale_documents(db_engine) == []
        with Session(db_engine) as session:
            dead = session.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"
                )
            )
        assert dead == 0  # nobody is left waiting on a lock


# -- the taxonomy lock protocol, proven deterministically ---------------------------------------------------------


class Blocked:
    """Runs ``call`` on a thread so a test can observe whether it is waiting or finished."""

    def __init__(self, call: Any) -> None:
        self.result: Any = None
        self._thread = threading.Thread(target=lambda: setattr(self, "result", call()))
        self._thread.start()

    def waiting(self, seconds: float = 1.5) -> bool:
        self._thread.join(timeout=seconds)
        return self._thread.is_alive()

    def finish(self) -> Any:
        self._thread.join(timeout=30)
        assert not self._thread.is_alive(), "still blocked after the lock was released"
        return self.result


@contextmanager
def holding(engine: Engine, function: str) -> Iterator[None]:
    """An open transaction on its own connection holding the taxonomy advisory lock."""
    connection = engine.connect()
    transaction = connection.begin()
    connection.execute(text(f"SELECT {function}(:key)"), {"key": TAXONOMY_LOCK_KEY})
    try:
        yield
    finally:
        transaction.rollback()
        connection.close()


def owner_create(owner: AuthApi) -> Any:
    return owner.request("POST", LISTINGS, json=provider_body())


def test_a_listing_write_waits_for_an_admin_taxonomy_write_in_progress(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        with holding(db_engine, "pg_advisory_xact_lock") as _:
            attempt = Blocked(lambda: owner_create(owner))
            assert attempt.waiting(), (
                "a listing write must not run while the taxonomy is being rewritten"
            )
        assert attempt.finish().status_code == 201  # ... and proceeds the moment the admin commits


def test_an_owner_edit_also_waits_for_it(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        listing_id = make_listing(owner)
        with holding(db_engine, "pg_advisory_xact_lock") as _:
            attempt = Blocked(lambda: edit(owner, listing_id, 1, name="Waiting Edit"))
            assert attempt.waiting()
        assert attempt.finish().status_code == 200


def test_an_admin_taxonomy_write_waits_for_a_listing_write_in_progress(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        (admin,) = admin_account(env)
        for label, call in (
            (
                "create",
                lambda: admin.request(
                    "POST",
                    ADMIN_CATEGORIES,
                    json={"module": "food", "name": "CC Waits", "slug": "cc-waits"},
                ),
            ),
            (
                "reorder",
                lambda: admin.request(
                    "POST",
                    f"{ADMIN_CATEGORIES}/reorder",
                    json={
                        "module": "food",
                        "parentId": None,
                        "orderedIds": ["00000000-0000-4000-8000-000000000000"],
                    },
                ),
            ),
        ):
            with holding(db_engine, "pg_advisory_xact_lock_shared") as _:
                attempt = Blocked(call)
                assert attempt.waiting(), label
            assert attempt.finish().status_code in (201, 422), (
                label
            )  # it ran once the writer committed


def test_a_rename_waits_for_an_in_flight_listing_write_so_its_document_is_rebuilt(
    db_engine: Engine,
) -> None:
    with admin_world(db_engine) as env:
        (admin,) = admin_account(env)
        created = admin.request(
            "POST",
            ADMIN_CATEGORIES,
            json={"module": "food", "name": "CC Gate Old", "slug": "cc-gate"},
        ).json()["data"]
        with holding(db_engine, "pg_advisory_xact_lock_shared") as _:
            rename = Blocked(
                lambda: admin.request(
                    "PATCH", f"{ADMIN_CATEGORIES}/{created['id']}", json={"name": "CC Gate New"}
                )
            )
            assert rename.waiting()
            with Session(db_engine) as session:  # not renamed while a listing writer is mid-flight
                assert (
                    session.scalar(text("SELECT name FROM categories WHERE slug = 'cc-gate'"))
                    == "CC Gate Old"
                )
        assert rename.finish().status_code == 200
        with Session(db_engine) as session:
            assert (
                session.scalar(text("SELECT name FROM categories WHERE slug = 'cc-gate'"))
                == "CC Gate New"
            )


def test_listing_writers_do_not_block_each_other(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        with holding(
            db_engine, "pg_advisory_xact_lock_shared"
        ) as _:  # another writer is mid-flight
            attempt = Blocked(lambda: owner_create(owner))
            assert not attempt.waiting(seconds=10), "shared holders must not exclude each other"
        assert attempt.result.status_code == 201


def test_moderation_never_takes_the_taxonomy_lock(db_engine: Engine) -> None:
    with admin_world(db_engine) as env:
        owner = browser(env, "owner@example.org", professional=PlanCode.PREMIUM)
        (admin,) = admin_account(env)
        listing_id = make_listing(owner)
        with holding(db_engine, "pg_advisory_xact_lock") as _:  # a taxonomy rewrite is in progress
            attempt = Blocked(lambda: approve(admin, listing_id, 1))
            assert not attempt.waiting(seconds=10), "approve/reject must not wait for the taxonomy"
        assert attempt.result.status_code == 200
