"""Super Admin / Moderator exclusivity under REAL concurrency (RBAC-A; AUTH_RBAC.md §27.2).

The savepoint-isolated tests cannot prove a race, because every statement shares one connection.
These use committed rows and separate connections (the same approach as the Phase 12 concurrency
suites) to prove the partial unique index ``uq_user_roles_one_staff_role``:

* a concurrent grant of the OTHER staff role WAITS for the first transaction (PostgreSQL's unique
  index serializes insertions of the same key), then — when the first commits — is refused with a
  uniqueness violation; it never slips in beside it;
* a rolled-back first grant lets the waiting one succeed;
* a hammered race of ``admin`` against ``moderator`` for the same user never leaves both roles.

The invariant is a **native database guarantee**: it holds under every transaction isolation level
and makes no assumption about the application's chosen level.
"""

import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import IntegrityError

EXCLUSIVE = "uq_user_roles_one_staff_role"


@contextmanager
def committed_users(engine: Engine, count: int) -> Iterator[list[uuid.UUID]]:
    """``count`` committed users, removed afterwards (their roles and scopes cascade)."""
    ids = [uuid.uuid4() for _ in range(count)]
    with engine.begin() as connection:
        for user_id in ids:
            connection.execute(
                text("INSERT INTO users (id, email, display_name) VALUES (:i, :e, 'Race User')"),
                {"i": user_id, "e": f"race-{user_id.hex[:12]}@example.test"},
            )
    try:
        yield ids
    finally:
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": ids})


def roles_of(engine: Engine, user_id: uuid.UUID) -> list[str]:
    with engine.connect() as connection:
        return sorted(
            connection.execute(
                text("SELECT role FROM user_roles WHERE user_id = :u"), {"u": user_id}
            ).scalars()
        )


def insert_role(connection: Connection, user_id: uuid.UUID, role: str) -> None:
    connection.execute(
        text("INSERT INTO user_roles (user_id, role) VALUES (:u, :r)"), {"u": user_id, "r": role}
    )


def constraint_of(error: BaseException) -> str | None:
    assert isinstance(error, IntegrityError), error
    name: str | None = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    return name


def wait_until_blocked(engine: Engine, pid: int, timeout: float = 15.0) -> None:
    """Block until backend ``pid`` is waiting on a lock (so the test knows it truly queued)."""
    deadline = time.monotonic() + timeout
    with engine.connect() as watcher:
        while time.monotonic() < deadline:
            waiting = watcher.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE pid = :p AND wait_event_type = 'Lock'"
                ),
                {"p": pid},
            ).scalar_one()
            if waiting:
                return
            time.sleep(0.05)
    pytest.fail("the second grant never queued behind the first (it was not serialized)")


def second_grant_waits_then_is_refused(
    engine: Engine, user_id: uuid.UUID, first: str, second: str
) -> None:
    outcome: dict[str, Any] = {}
    second_pid: dict[str, int] = {}
    ready = threading.Event()

    def second_transaction() -> None:
        with engine.connect() as connection:
            try:
                with connection.begin():
                    # the explicit transaction must start BEFORE the first statement (autobegin)
                    second_pid["pid"] = connection.execute(
                        text("SELECT pg_backend_pid()")
                    ).scalar_one()
                    ready.set()
                    insert_role(connection, user_id, second)
                outcome["result"] = "granted"
            except IntegrityError as error:
                outcome["result"] = "refused"
                outcome["constraint"] = constraint_of(error)

    with engine.connect() as first_connection:
        first_tx = first_connection.begin()
        insert_role(first_connection, user_id, first)  # uncommitted: holds the user's row lock
        worker = threading.Thread(target=second_transaction)
        worker.start()
        assert ready.wait(10)
        wait_until_blocked(engine, second_pid["pid"])  # the second grant is genuinely queued
        assert "result" not in outcome  # and has not slipped through
        first_tx.commit()
    worker.join(timeout=30)
    assert not worker.is_alive(), "the second grant is stuck (deadlock?)"

    assert outcome == {"result": "refused", "constraint": EXCLUSIVE}
    assert roles_of(engine, user_id) == [first]


def test_a_concurrent_moderator_grant_queues_behind_an_admin_grant_and_is_refused(
    db_engine: Engine,
) -> None:
    with committed_users(db_engine, 1) as (user_id,):
        second_grant_waits_then_is_refused(db_engine, user_id, "admin", "moderator")


def test_a_concurrent_admin_grant_queues_behind_a_moderator_grant_and_is_refused(
    db_engine: Engine,
) -> None:
    with committed_users(db_engine, 1) as (user_id,):
        second_grant_waits_then_is_refused(db_engine, user_id, "moderator", "admin")


def test_a_rolled_back_first_grant_lets_the_waiting_one_succeed(db_engine: Engine) -> None:
    """The lock is only a queue: when the first transaction aborts, the second is not refused."""
    with committed_users(db_engine, 1) as (user_id,):
        outcome: dict[str, Any] = {}
        pid: dict[str, int] = {}
        ready = threading.Event()

        def second() -> None:
            with db_engine.connect() as connection, connection.begin():
                pid["pid"] = connection.execute(text("SELECT pg_backend_pid()")).scalar_one()
                ready.set()
                insert_role(connection, user_id, "moderator")
            outcome["result"] = "granted"

        with db_engine.connect() as first_connection:
            first_tx = first_connection.begin()
            insert_role(first_connection, user_id, "admin")
            worker = threading.Thread(target=second)
            worker.start()
            assert ready.wait(10)
            wait_until_blocked(db_engine, pid["pid"])
            first_tx.rollback()
        worker.join(timeout=30)
        assert not worker.is_alive()

        assert outcome == {"result": "granted"}
        assert roles_of(db_engine, user_id) == ["moderator"]


@pytest.mark.parametrize("round_number", range(3))
def test_a_hammered_race_never_leaves_both_staff_roles(
    db_engine: Engine, round_number: int
) -> None:
    rounds = 20
    with committed_users(db_engine, rounds) as users:
        results: list[list[str]] = [[] for _ in users]

        def attempt(index: int, role: str, barrier: threading.Barrier) -> None:
            barrier.wait()
            try:
                with db_engine.begin() as connection:
                    insert_role(connection, users[index], role)
                results[index].append(f"{role}:granted")
            except IntegrityError as error:
                assert constraint_of(error) == EXCLUSIVE, error
                results[index].append(f"{role}:refused")

        threads = []
        for index in range(rounds):
            barrier = threading.Barrier(2)
            for role in ("admin", "moderator"):
                threads.append(threading.Thread(target=attempt, args=(index, role, barrier)))
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
            assert not thread.is_alive(), "a role grant is stuck (deadlock?)"

        for index, user_id in enumerate(users):
            stored = roles_of(db_engine, user_id)
            assert len(stored) == 1, (stored, results[index])  # NEVER both
            granted = [r for r in results[index] if r.endswith(":granted")]
            assert len(granted) == 1 and granted[0].startswith(stored[0])


def test_the_exclusivity_backstop_is_a_native_database_invariant(db_engine: Engine) -> None:
    """RBAC-A hardening: the backstop is a partial unique index, not a trigger, so it holds under
    every transaction isolation level — the application does not have to pin READ COMMITTED to keep
    the Super Admin / Moderator roles mutually exclusive."""
    (name, uniqueness, definition) = (
        db_engine.connect()
        .execute(
            text(
                "SELECT i.relname, ix.indisunique, pg_get_indexdef(ix.indexrelid) "
                "FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid "
                f"WHERE i.relname = '{EXCLUSIVE}'"
            )
        )
        .one()
    )

    assert uniqueness is True
    assert "(user_id)" in definition
    assert "role" in definition and "admin" in definition and "moderator" in definition
    # And no trigger carries the exclusivity logic any more.
    trigger = (
        db_engine.connect()
        .execute(
            text(
                "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_user_roles_staff_roles_exclusive'"
            )
        )
        .scalar_one()
    )
    assert trigger == 0
    _ = name  # used for the lookup; the assertions above prove the index exists at EXCLUSIVE
