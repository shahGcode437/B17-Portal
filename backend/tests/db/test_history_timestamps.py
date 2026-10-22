"""Listing status history is stamped with the wall clock of THE WRITE (Phase 12I).

Before 12I the history ``created_at`` was the schema default ``now()`` — the START of the
transaction. Every event of one transaction shared one timestamp, and under contention an event could
be stamped before the event it followed, so ordering by time told the wrong story. The model now
supplies ``clock_timestamp()`` (application code, same rule as ``service_request_status_history`` in
12F; the schema default is unchanged, so there is no migration).

The suite's per-test outer transaction is the sharpest possible probe: ``now()`` is constant inside
it, so under the old behaviour every row below would carry the SAME timestamp. These tests therefore
do NOT call ``age_history`` and do NOT lean on the ``revision`` / ``id`` tie-breakers.
"""

import time
import uuid
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import ListingStatusHistory
from app.models.enums import ActorRole, HistoryAction, ListingStatus
from tests.db.admin_helpers import (
    admin_signed_in,
    approve,
    detail,
    history_of,
    owner_signed_in,
    pending,
    reject,
)
from tests.db.auth_helpers import AuthEnv
from tests.db.write_helpers import history, patch, provider_body

REASON = "Please add before-and-after photos of your work."


def stamps(session: Session, listing_id: str) -> list[tuple[str, datetime]]:
    """``(action, created_at)`` ordered ONLY by time — no tie-breaker."""
    session.expire_all()
    rows = session.execute(
        select(ListingStatusHistory.action, ListingStatusHistory.created_at)
        .where(ListingStatusHistory.listing_id == uuid.UUID(listing_id))
        .order_by(ListingStatusHistory.created_at)
    ).all()
    return [(action.value, created_at) for action, created_at in rows]


def test_a_history_row_is_stamped_after_the_transaction_started(auth_env: AuthEnv) -> None:
    session = auth_env.session
    started = session.execute(text("SELECT now()")).scalar_one()
    time.sleep(0.05)

    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Clock Co"))

    (row,) = history(session, listing_id)
    assert row.action is HistoryAction.SUBMITTED
    # ``now()`` would equal ``started`` (one outer transaction); the wall clock is later.
    assert row.created_at > started


def test_events_in_one_transaction_get_strictly_increasing_timestamps(auth_env: AuthEnv) -> None:
    session = auth_env.session
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Rapid Co"))
    admin = admin_signed_in(auth_env)

    assert approve(admin, listing_id, 1).status_code == 200
    assert (
        patch(owner, listing_id, 1, description="Now with a much fuller description.").status_code
        == 200
    )
    assert reject(admin, listing_id, 2, REASON).status_code == 200
    assert (
        patch(owner, listing_id, 2, description="Photos available on request, see us.").status_code
        == 200
    )
    assert approve(admin, listing_id, 3).status_code == 200

    ordered = stamps(session, listing_id)
    assert [action for action, _ in ordered] == [
        "submitted",
        "approved",
        "resubmitted",
        "rejected",
        "resubmitted",
        "approved",
    ]
    times = [created_at for _, created_at in ordered]
    assert len(set(times)) == len(times), "two events share a timestamp"
    assert times == sorted(times)


def test_time_order_agrees_with_the_story_the_admin_detail_tells(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Story Co"))
    admin = admin_signed_in(auth_env)
    assert reject(admin, listing_id, 1, REASON).status_code == 200
    assert (
        patch(
            owner, listing_id, 1, description="A fixed and fuller description, as asked."
        ).status_code
        == 200
    )
    assert approve(admin, listing_id, 2).status_code == 200

    assert history_of(detail(admin, listing_id)) == [
        ("submitted", None, "pending", 1),
        ("rejected", "pending", "rejected", 1),
        ("resubmitted", "rejected", "pending", 2),
        ("approved", "pending", "approved", 2),
    ]
    assert [a for a, _ in stamps(auth_env.session, listing_id)] == [
        "submitted",
        "rejected",
        "resubmitted",
        "approved",
    ]


def test_a_refused_decision_leaves_no_history_row_and_no_timestamp(auth_env: AuthEnv) -> None:
    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Refused Co"))
    admin = admin_signed_in(auth_env)
    before = stamps(auth_env.session, listing_id)

    assert approve(admin, listing_id, 99).status_code == 409  # stale

    assert stamps(auth_env.session, listing_id) == before


def test_the_schema_default_is_unchanged_so_a_raw_insert_still_works(auth_env: AuthEnv) -> None:
    """No migration: the column default is still ``now()``; only the ORM supplies the wall clock."""
    session = auth_env.session
    default = session.execute(
        text(
            "SELECT column_default FROM information_schema.columns"
            " WHERE table_name = 'listing_status_history' AND column_name = 'created_at'"
        )
    ).scalar_one()
    assert default == "now()"

    owner = owner_signed_in(auth_env)
    listing_id = pending(owner, provider_body(name="Raw Co"))
    actor = session.execute(
        text("SELECT owner_id FROM listings WHERE id = :i"), {"i": listing_id}
    ).scalar_one()
    session.execute(
        text(
            "INSERT INTO listing_status_history (id, listing_id, from_status, to_status, action,"
            " revision, actor_user_id, actor_role) VALUES (:id, :l, 'pending', 'approved',"
            " 'approved', 1, :a, 'admin')"
        ),
        {"id": uuid.uuid4(), "l": listing_id, "a": actor},
    )
    rows = {r.action: r for r in history(session, listing_id)}
    assert set(rows) == {HistoryAction.SUBMITTED, HistoryAction.APPROVED}
    assert rows[HistoryAction.APPROVED].actor_role is ActorRole.ADMIN
    assert rows[HistoryAction.APPROVED].to_status is ListingStatus.APPROVED
    # The raw row took the schema default — the transaction start — which is exactly why the
    # application must not rely on it: it sorts BEFORE the earlier, wall-clocked 'submitted' row.
    started = session.execute(text("SELECT now()")).scalar_one()
    assert rows[HistoryAction.APPROVED].created_at == started
    assert rows[HistoryAction.SUBMITTED].created_at > started
