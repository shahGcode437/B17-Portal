"""RBAC-A schema security (migration 0007; docs/backend/AUTH_RBAC.md §27, DATA_MODEL.md §17).

Real PostgreSQL. Every invariant the design calls a database guarantee is proven here against the
database itself (raw SQL where the ORM would otherwise refuse the value first):

* the widened role / actor-role vocabularies;
* a scope assignment cannot exist without the same user holding ``moderator``, cannot be duplicated,
  is a closed vocabulary, and disappears with the role;
* ``admin`` and ``moderator`` are mutually exclusive (a native partial unique index; the concurrent
  race is in ``test_staff_exclusivity_concurrency.py``);
* the staff audit accepts INSERT and refuses UPDATE and DELETE, its CHECKs close the vocabulary and
  the payload, and it has no foreign keys so a deleted or tombstoned account never blocks it.
"""

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import StaffAuditEvent, StaffScopeAssignment, UserRole
from app.models.enums import (
    RoleName,
    StaffAuditAction,
    StaffAuditSource,
    StaffScope,
)
from tests.db.helpers import make_listing, make_user, raw_insert, violates

REASON = "Approved as the only available reviewer."
# The Super Admin / Moderator exclusivity is now a native partial unique index (RBAC-A hardening):
# `uq_user_roles_one_staff_role ON user_roles(user_id) WHERE role IN ('admin', 'moderator')`.
# A violation is SQLSTATE 23505 with the index name as the ``constraint_name`` in psycopg's diag.
EXCLUSIVE = "uq_user_roles_one_staff_role"
FK_ROLE = "fk_staff_scope_assignments_user_id_role_user_roles"
APPEND_ONLY = "trg_staff_audit_events_append_only"


def grant(session: Session, user_id: uuid.UUID, role: str) -> None:
    raw_insert(session, "user_roles", user_id=user_id, role=role)


def roles_of(session: Session, user_id: uuid.UUID) -> list[str]:
    return sorted(
        session.scalars(text("SELECT role FROM user_roles WHERE user_id = :u"), {"u": user_id})
    )


def scopes_of(session: Session, user_id: uuid.UUID) -> list[str]:
    return sorted(
        session.scalars(
            text("SELECT scope FROM staff_scope_assignments WHERE user_id = :u"), {"u": user_id}
        )
    )


def moderator(session: Session, *scopes: StaffScope) -> uuid.UUID:
    user = make_user(session)
    grant(session, user.id, "moderator")
    for scope in scopes:
        raw_insert(session, "staff_scope_assignments", user_id=user.id, scope=scope.value)
    return user.id


def insert_audit(session: Session, **overrides: Any) -> uuid.UUID:
    """A staff audit row through plain SQL (JSON columns cast explicitly)."""
    row: dict[str, Any] = {
        "id": uuid.uuid4(),
        "source": "web",
        "action": "scope_granted",
        "actor": uuid.uuid4(),
        "target": None,
        "rtype": None,
        "rid": None,
        "before": None,
        "after": None,
        "reason": None,
    }
    row.update(overrides)
    session.execute(
        text(
            "INSERT INTO staff_audit_events (id, source, action, actor_user_id, target_user_id, "
            "resource_type, resource_id, before, after, reason) VALUES (:id, :source, :action, "
            ":actor, :target, :rtype, :rid, CAST(:before AS jsonb), CAST(:after AS jsonb), :reason)"
        ),
        row,
    )
    return row["id"]  # type: ignore[no-any-return]


# -- the widened vocabularies ------------------------------------------------------------------------


def test_admin_and_moderator_roles_are_both_accepted_and_nothing_else_is(
    db_session: Session,
) -> None:
    admin, mod, nobody = make_user(db_session), make_user(db_session), make_user(db_session)

    grant(db_session, admin.id, "admin")
    grant(db_session, mod.id, "moderator")

    assert roles_of(db_session, admin.id) == ["admin"]
    assert roles_of(db_session, mod.id) == ["moderator"]
    for bad in ("superuser", "super_admin", "staff", "professional", "resident"):
        with violates(db_session, "ck_user_roles_role_valid"):
            grant(db_session, nobody.id, bad)


def test_the_listing_history_actor_role_accepts_moderator_and_nothing_else_new(
    db_session: Session,
) -> None:
    listing, actor = make_listing(db_session), make_user(db_session)

    def history_row(actor_role: str) -> None:
        raw_insert(
            db_session,
            "listing_status_history",
            id=uuid.uuid4(),
            listing_id=listing.id,
            from_status="pending",
            to_status="approved",
            action="approved",
            revision=1,
            actor_user_id=actor.id,
            actor_role=actor_role,
        )

    for accepted in ("owner", "admin", "moderator"):
        history_row(accepted)
    with violates(db_session, "ck_listing_status_history_actor_role_valid"):
        history_row("super_admin")


# -- scope assignments -----------------------------------------------------------------------------


def test_every_canonical_scope_can_be_assigned_to_a_moderator(db_session: Session) -> None:
    user_id = moderator(db_session, *StaffScope)

    assert scopes_of(db_session, user_id) == sorted(scope.value for scope in StaffScope)
    row = db_session.scalars(
        select(StaffScopeAssignment).where(StaffScopeAssignment.user_id == user_id)
    ).first()
    assert row is not None
    assert row.role is RoleName.MODERATOR
    assert row.granted_at is not None  # captured by the database
    assert row.granted_by is None  # nobody recorded here: set by the future staff service


@pytest.mark.parametrize("scope", ["tutor", "business", "Food", "", "all", "*", "admin"])
def test_a_scope_outside_the_closed_vocabulary_is_rejected(db_session: Session, scope: str) -> None:
    user_id = moderator(db_session)

    with violates(db_session, "ck_staff_scope_assignments_scope_valid"):
        raw_insert(db_session, "staff_scope_assignments", user_id=user_id, scope=scope)


def test_a_duplicate_scope_assignment_is_impossible(db_session: Session) -> None:
    user_id = moderator(db_session, StaffScope.FOOD)

    with violates(db_session, "pk_staff_scope_assignments"):
        raw_insert(db_session, "staff_scope_assignments", user_id=user_id, scope="food")


def test_a_scope_without_the_moderator_role_cannot_exist(db_session: Session) -> None:
    nobody = make_user(db_session)

    with violates(db_session, FK_ROLE):
        raw_insert(db_session, "staff_scope_assignments", user_id=nobody.id, scope="food")


def test_a_super_admin_can_never_hold_scope_rows(db_session: Session) -> None:
    """A Super Admin's authority is the role itself: scope rows need the MODERATOR role."""
    admin = make_user(db_session)
    grant(db_session, admin.id, "admin")

    with violates(db_session, FK_ROLE):
        raw_insert(db_session, "staff_scope_assignments", user_id=admin.id, scope="food")


def test_the_role_column_of_an_assignment_is_the_constant_moderator(db_session: Session) -> None:
    admin = make_user(db_session)
    grant(db_session, admin.id, "admin")  # so the composite foreign key alone would be satisfied

    with violates(db_session, "ck_staff_scope_assignments_role_is_moderator"):
        raw_insert(
            db_session, "staff_scope_assignments", user_id=admin.id, scope="food", role="admin"
        )


def test_removing_the_moderator_role_removes_every_scope_assignment(db_session: Session) -> None:
    user_id = moderator(db_session, StaffScope.FOOD, StaffScope.EDUCATION)
    other = moderator(db_session, StaffScope.FOOD)
    assert len(scopes_of(db_session, user_id)) == 2

    db_session.execute(
        text("DELETE FROM user_roles WHERE user_id = :u AND role = 'moderator'"), {"u": user_id}
    )

    assert scopes_of(db_session, user_id) == []  # no orphan survives the role
    assert scopes_of(db_session, other) == ["food"]  # and nobody else is touched


def test_deleting_the_account_removes_its_role_and_scopes(db_session: Session) -> None:
    user_id = moderator(db_session, StaffScope.PROPERTY)

    db_session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})

    assert roles_of(db_session, user_id) == [] and scopes_of(db_session, user_id) == []


def test_who_granted_a_scope_is_kept_and_survives_the_granter_being_deleted(
    db_session: Session,
) -> None:
    granter = make_user(db_session)
    user_id = moderator(db_session)
    raw_insert(
        db_session,
        "staff_scope_assignments",
        user_id=user_id,
        scope="food",
        granted_by=granter.id,
    )
    assert (
        db_session.scalar(
            text("SELECT granted_by FROM staff_scope_assignments WHERE user_id = :u"),
            {"u": user_id},
        )
        == granter.id
    )

    db_session.execute(text("DELETE FROM users WHERE id = :u"), {"u": granter.id})

    assert scopes_of(db_session, user_id) == ["food"]  # the grant stays...
    assert (
        db_session.scalar(
            text("SELECT granted_by FROM staff_scope_assignments WHERE user_id = :u"),
            {"u": user_id},
        )
        is None
    )  # ...with the granter's identifier cleared (SET NULL)


# -- Super Admin / Moderator mutual exclusivity (the database backstop) ------------------------------


def test_an_admin_cannot_also_be_granted_moderator(db_session: Session) -> None:
    user = make_user(db_session)
    grant(db_session, user.id, "admin")

    with violates(db_session, EXCLUSIVE):
        grant(db_session, user.id, "moderator")

    assert roles_of(db_session, user.id) == ["admin"]


def test_a_moderator_cannot_also_be_granted_admin(db_session: Session) -> None:
    user_id = moderator(db_session, StaffScope.FOOD)

    with violates(db_session, EXCLUSIVE):
        grant(db_session, user_id, "admin")

    assert roles_of(db_session, user_id) == ["moderator"]
    assert scopes_of(db_session, user_id) == ["food"]  # the refused grant changed nothing


def test_different_users_may_hold_different_staff_roles(db_session: Session) -> None:
    admin = make_user(db_session)
    grant(db_session, admin.id, "admin")

    mod = moderator(db_session, StaffScope.FOOD)

    assert roles_of(db_session, admin.id) == ["admin"] and roles_of(db_session, mod) == [
        "moderator"
    ]


def test_the_roles_can_succeed_one_another_once_the_first_is_removed(db_session: Session) -> None:
    """The legitimate promotion path: remove the moderator role (scopes cascade), then add admin."""
    user_id = moderator(db_session, StaffScope.FOOD)

    db_session.execute(
        text("DELETE FROM user_roles WHERE user_id = :u AND role = 'moderator'"), {"u": user_id}
    )
    grant(db_session, user_id, "admin")

    assert roles_of(db_session, user_id) == ["admin"] and scopes_of(db_session, user_id) == []


def test_a_role_cannot_be_updated_into_the_other_staff_role_next_to_it(db_session: Session) -> None:
    """The trigger also guards UPDATE: moving a moderator row onto an admin account is refused."""
    admin = make_user(db_session)
    grant(db_session, admin.id, "admin")
    mod = moderator(db_session)

    with violates(db_session, EXCLUSIVE):
        db_session.execute(
            text("UPDATE user_roles SET user_id = :a WHERE user_id = :m AND role = 'moderator'"),
            {"a": admin.id, "m": mod},
        )

    assert roles_of(db_session, admin.id) == ["admin"] and roles_of(db_session, mod) == [
        "moderator"
    ]


def test_swapping_a_scopeless_moderator_row_to_admin_is_a_legitimate_update(
    db_session: Session,
) -> None:
    """The trigger does not mistake a row for its own conflict (OLD is excluded)."""
    user_id = moderator(db_session)

    db_session.execute(
        text("UPDATE user_roles SET role = 'admin' WHERE user_id = :u AND role = 'moderator'"),
        {"u": user_id},
    )

    assert roles_of(db_session, user_id) == ["admin"]


def test_a_moderator_row_with_scopes_cannot_be_swapped_to_admin_leaving_orphans(
    db_session: Session,
) -> None:
    user_id = moderator(db_session, StaffScope.FOOD)

    with violates(db_session, FK_ROLE):
        db_session.execute(
            text("UPDATE user_roles SET role = 'admin' WHERE user_id = :u AND role = 'moderator'"),
            {"u": user_id},
        )

    assert roles_of(db_session, user_id) == ["moderator"]


# -- the staff audit: append-only -------------------------------------------------------------------


def test_an_audit_row_can_be_inserted_and_read_back(db_session: Session) -> None:
    actor, target = uuid.uuid4(), uuid.uuid4()

    event_id = insert_audit(
        db_session,
        actor=actor,
        target=target,
        action="moderator_appointed",
        before=json.dumps({"scopes": []}),
        after=json.dumps({"scopes": ["food"]}),
    )

    row = db_session.get(StaffAuditEvent, event_id)
    assert row is not None
    assert row.action is StaffAuditAction.MODERATOR_APPOINTED
    assert row.source is StaffAuditSource.WEB
    assert (row.actor_user_id, row.target_user_id) == (actor, target)
    assert row.before == {"scopes": []} and row.after == {"scopes": ["food"]}
    assert row.occurred_at is not None  # the database's wall clock when the writer gave none


def test_an_audit_row_can_never_be_updated(db_session: Session) -> None:
    event_id = insert_audit(db_session)

    with violates(db_session, APPEND_ONLY):
        db_session.execute(
            text("UPDATE staff_audit_events SET action = 'scope_revoked' WHERE id = :i"),
            {"i": event_id},
        )
    with violates(db_session, APPEND_ONLY):  # not even a no-op rewrite of the same value
        db_session.execute(
            text("UPDATE staff_audit_events SET reason = reason WHERE id = :i"), {"i": event_id}
        )

    stored = db_session.get(StaffAuditEvent, event_id)
    assert stored is not None and stored.action is StaffAuditAction.SCOPE_GRANTED


def test_an_audit_row_can_never_be_deleted(db_session: Session) -> None:
    event_id = insert_audit(db_session)

    with violates(db_session, APPEND_ONLY):
        db_session.execute(text("DELETE FROM staff_audit_events WHERE id = :i"), {"i": event_id})

    assert db_session.get(StaffAuditEvent, event_id) is not None


def test_the_whole_audit_cannot_be_truncated(db_session: Session) -> None:
    """RBAC-A hardening: a statement-level BEFORE TRUNCATE trigger refuses TRUNCATE too, so the
    append-only invariant covers the UPDATE / DELETE / TRUNCATE trio an ordinary database role can
    reach. The function message is shared with the row-level trigger, and both surface in psycopg's
    diag as ``trg_staff_audit_events_append_only``."""
    insert_audit(db_session)
    insert_audit(db_session)
    before = int(db_session.scalar(text("SELECT count(*) FROM staff_audit_events")) or 0)
    assert before == 2  # there is really something to protect

    with violates(db_session, APPEND_ONLY):
        db_session.execute(text("TRUNCATE staff_audit_events"))

    assert db_session.scalar(text("SELECT count(*) FROM staff_audit_events")) == before


def test_the_truncate_refusal_names_the_operation(db_session: Session) -> None:
    """One function serves both triggers; the ``TG_OP`` in the message tells them apart."""
    import pytest
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError) as refused, db_session.begin_nested():
        db_session.execute(text("TRUNCATE staff_audit_events"))

    message = str(refused.value.orig).lower()
    assert "truncate is not allowed" in message
    assert "staff_audit_events is append-only" in message


def test_the_orm_cannot_alter_or_delete_an_audit_row_either(db_session: Session) -> None:
    event = StaffAuditEvent(
        actor_user_id=uuid.uuid4(),
        source=StaffAuditSource.WEB,
        action=StaffAuditAction.SCOPE_GRANTED,
    )
    db_session.add(event)
    db_session.flush()

    with violates(db_session, APPEND_ONLY):
        event.reason = "rewritten history"
        db_session.flush()
    db_session.expire_all()
    with violates(db_session, APPEND_ONLY):
        db_session.delete(db_session.get(StaffAuditEvent, event.id))
        db_session.flush()


# -- the staff audit: closed vocabularies and bounded payloads ---------------------------------------


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"action": "wipe_everything"}, "ck_staff_audit_events_action_valid"),
        ({"source": "api"}, "ck_staff_audit_events_source_valid"),
        ({"rtype": "user", "rid": uuid.uuid4()}, "ck_staff_audit_events_resource_type_valid"),
        ({"actor": None}, "ck_staff_audit_events_web_has_actor"),  # a web action has an actor
        ({"rtype": "listing"}, "ck_staff_audit_events_resource_pair"),
        ({"rid": uuid.uuid4()}, "ck_staff_audit_events_resource_pair"),
        ({"before": "[1, 2]"}, "ck_staff_audit_events_before_object"),
        ({"after": '"just text"'}, "ck_staff_audit_events_after_object"),
        ({"after": json.dumps({"k": "x" * 5000})}, "ck_staff_audit_events_payload_size"),
        ({"reason": "   "}, "ck_staff_audit_events_reason_length"),
        ({"reason": "x" * 501}, "ck_staff_audit_events_reason_length"),
        ({"action": "super_admin_promoted"}, "ck_staff_audit_events_reason_required"),
        (
            {"action": "super_admin_demoted", "reason": "too short"},
            "ck_staff_audit_events_reason_required",
        ),
        ({"action": "moderation_self_override"}, "ck_staff_audit_events_reason_required"),
    ],
)
def test_the_audit_checks_refuse_malformed_rows(
    db_session: Session, overrides: dict[str, Any], constraint: str
) -> None:
    with violates(db_session, constraint):
        insert_audit(db_session, **overrides)


def test_an_operator_cli_action_has_no_web_actor_and_a_valid_reason_passes(
    db_session: Session,
) -> None:
    insert_audit(db_session, source="cli", actor=None, action="super_admin_promoted", reason=REASON)
    insert_audit(
        db_session,
        action="moderation_self_override",
        reason=REASON,
        rtype="listing",
        rid=uuid.uuid4(),
    )

    count = db_session.scalar(text("SELECT count(*) FROM staff_audit_events"))
    assert count == 2


def test_the_audit_keeps_its_identifiers_when_an_account_is_deleted_or_tombstoned(
    db_session: Session,
) -> None:
    """No foreign keys: the audit never blocks account maintenance and never loses who acted."""
    actor, target = make_user(db_session), make_user(db_session)
    event_id = insert_audit(db_session, actor=actor.id, target=target.id)

    db_session.execute(
        text("UPDATE users SET status = 'deleted', display_name = 'Deleted' WHERE id = :u"),
        {"u": actor.id},
    )  # a tombstone
    db_session.execute(text("DELETE FROM users WHERE id = :u"), {"u": target.id})  # even a delete

    kept = db_session.get(StaffAuditEvent, event_id)
    assert kept is not None
    assert (kept.actor_user_id, kept.target_user_id) == (actor.id, target.id)


def test_an_audit_row_may_reference_an_identifier_that_no_longer_exists(
    db_session: Session,
) -> None:
    ghost = uuid.uuid4()  # never a user: the identifier columns are history, not references

    event_id = insert_audit(db_session, actor=ghost, target=ghost, rtype="listing", rid=ghost)

    assert db_session.get(StaffAuditEvent, event_id) is not None


def test_the_models_report_the_expected_role_rows(db_session: Session) -> None:
    """ORM round trip of the new enum value (the role vocabulary is one Python enum)."""
    user_id = moderator(db_session, StaffScope.SERVICES)

    role = db_session.get(UserRole, (user_id, RoleName.MODERATOR))

    assert role is not None and role.role is RoleName.MODERATOR
