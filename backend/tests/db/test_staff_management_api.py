"""RBAC-C staff management through the real HTTP stack (docs/backend/AUTH_RBAC.md §27.7, §30).

A Super Admin appoints, re-scopes, pauses, resumes and removes Moderators; reads the roster and the
durable audit. Real PostgreSQL, real login, real CSRF / Origin middleware. Every assertion about a
change reads the STORED state (``staff_helpers``), and every refusal proves it changed NOTHING:
no role, scope, session, audit row or timeline event.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import select, update

from app.models import AuthEvent, User, UserRole
from app.models.enums import (
    AuthEventType,
    PlanCode,
    StaffAuditAction,
    StaffAuditSource,
    UserStatus,
)
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account
from tests.db.staff_helpers import (
    AUDIT,
    DIRECTORY,
    EDUCATION,
    FOOD,
    MODERATORS,
    NEWS,
    PROPERTY,
    STAFF,
    appoint,
    audit_count,
    audit_events,
    candidate,
    detail_code,
    live_sessions,
    no_secrets,
    open_sessions,
    pause,
    put_scopes,
    remove,
    resume,
    revoke_reasons,
    roles_of,
    scopes_of,
    service,
    sign_in,
    snapshot,
    super_admin,
)
from tests.db.write_helpers import error_code, signed_in

REASON = "Rotating credentials after the quarterly review."


def user_id(env: AuthEnv, email: str) -> uuid.UUID:
    found = env.session.scalar(select(User.id).where(User.email == email))
    assert found is not None
    return found


def data(response: Response) -> dict[str, Any]:
    assert response.status_code in (200, 201), response.text
    body: dict[str, Any] = response.json()["data"]
    return body


def error_shape(response: Response) -> dict[str, Any]:
    """An error body with the per-request id removed, so two refusals can be compared."""
    error: dict[str, Any] = dict(response.json()["error"])
    error.pop("requestId", None)
    return error


def appointed(
    env: AuthEnv,
    admin: AuthApi,
    email: str = "mod@example.org",
    scopes: Any = (FOOD,),
    **account: Any,
) -> User:
    """An account appointed Moderator through the API (so the audit and revocation are real)."""
    account.setdefault("professional", None)
    user = candidate(env, email, **account)
    assert appoint(admin, email, scopes).status_code == 201
    env.session.expire_all()
    return user


# -- appointment ----------------------------------------------------------------------------------


@pytest.mark.parametrize("professional", [None, PlanCode.FREE], ids=["resident", "professional"])
def test_a_super_admin_appoints_a_verified_account_and_a_professional_profile_is_not_required(
    auth_env: AuthEnv, professional: PlanCode | None
) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "jane@example.org", professional=professional)
    old_browsers = open_sessions(auth_env, cand.email, 2)

    response = appoint(admin, cand.email, [FOOD, DIRECTORY])

    assert response.status_code == 201, response.text
    member = data(response)
    assert member["userId"] == str(cand.id) and member["role"] == "moderator"
    assert member["scopes"] == ["directory", "food"] and member["paused"] is False
    assert member["accountStatus"] == "active" and member["emailVerified"] is True
    assert member["grantedBy"] == {
        "userId": str(user_id(auth_env, "sa@example.org")),
        "displayName": "Sam Admin",
    }
    assert roles_of(auth_env.session, cand.id) == {"moderator"}
    assert scopes_of(auth_env.session, cand.id) == ["directory", "food"]
    # the target's old sessions are gone: new authority is usable only after a fresh sign-in
    assert live_sessions(auth_env.session, cand.id) == 0
    assert revoke_reasons(auth_env.session, cand.id) == {"role_change"}
    assert old_browsers[0].get("/admin/listings").status_code == 401
    assert old_browsers[1].me().json()["error"]["code"] == "session_expired"


def test_appointment_writes_the_audit_and_the_timeline_event(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "audited@example.org")
    open_sessions(auth_env, cand.email, 2)

    appoint(admin, cand.email, [PROPERTY, FOOD])

    (event,) = audit_events(auth_env.session)
    actor = user_id(auth_env, "sa@example.org")
    assert event.action is StaffAuditAction.MODERATOR_APPOINTED
    assert event.source is StaffAuditSource.WEB and event.actor_user_id == actor
    assert event.target_user_id == cand.id and event.reason is None
    assert event.before == {"role": None, "scopes": [], "revision": 0}
    assert event.after == {
        "role": "moderator",
        "scopes": ["food", "property"],
        "revision": 1,
        "paused": False,
        "sessions_revoked": 2,
    }
    timeline = auth_env.session.scalars(
        select(AuthEvent).where(
            AuthEvent.user_id == cand.id, AuthEvent.event_type == AuthEventType.ROLE_GRANTED
        )
    ).all()
    assert len(timeline) == 1 and timeline[0].actor_user_id == actor
    assert timeline[0].details == {"reason": "moderator"}


def test_after_a_fresh_login_the_appointed_moderator_has_exactly_the_granted_authority(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "fresh@example.org")
    appoint(admin, cand.email, [DIRECTORY])

    moderator = sign_in(auth_env, cand.email)

    me = moderator.me().json()["data"]
    assert "moderator" in me["roles"] and me["staffScopes"] == ["directory"]
    assert moderator.get("/admin/listings").status_code == 200  # the scoped queue (RBAC-B)
    assert moderator.get(STAFF).status_code == 403  # ...but never staff management
    assert moderator.get(AUDIT).status_code == 403


@pytest.mark.parametrize(
    "account",
    [{"verified": False}, {"status": "suspended"}, {"status": "deleted"}],
    ids=["unverified", "suspended", "deleted"],
)
def test_an_ineligible_account_is_refused_and_nothing_changes(
    auth_env: AuthEnv, account: dict[str, Any]
) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "ineligible@example.org", **account)
    before = snapshot(auth_env.session, cand.id)

    response = appoint(admin, cand.email, [FOOD])

    assert response.status_code == 422 and detail_code(response) == "target_not_eligible"
    assert snapshot(auth_env.session, cand.id) == before


def test_an_unknown_address_and_an_ineligible_one_are_indistinguishable(auth_env: AuthEnv) -> None:
    """The appointment endpoint is not an account-existence oracle."""
    admin = super_admin(auth_env)
    candidate(auth_env, "exists-but-unverified@example.org", verified=False)

    unknown = appoint(admin, "nobody-at-all@example.org", [FOOD])
    ineligible = appoint(admin, "exists-but-unverified@example.org", [FOOD])
    malformed = appoint(admin, "not an address", [FOOD])
    empty = appoint(admin, "", [FOOD])

    assert {r.status_code for r in (unknown, ineligible, malformed, empty)} == {422}
    assert error_shape(unknown) == error_shape(ineligible)
    assert error_shape(unknown) == error_shape(malformed) == error_shape(empty)


def test_a_super_admin_cannot_be_appointed_a_moderator(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    other = make_account(auth_env.session, "other-admin@example.org", admin=True)
    before = snapshot(auth_env.session, other.id)

    response = appoint(admin, other.email, [FOOD])

    assert response.status_code == 403 and detail_code(response) == "super_admin_target_forbidden"
    assert snapshot(auth_env.session, other.id) == before
    assert roles_of(auth_env.session, other.id) == {"admin"}  # never both roles


def test_an_existing_moderator_cannot_be_appointed_again(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin)
    before = snapshot(auth_env.session, mod.id)

    response = appoint(admin, mod.email, [DIRECTORY])

    assert response.status_code == 409 and detail_code(response) == "already_moderator"
    assert snapshot(auth_env.session, mod.id) == before
    assert scopes_of(auth_env.session, mod.id) == ["food"]


@pytest.mark.parametrize(
    "scopes",
    [[], [NEWS], [NEWS, FOOD], [FOOD, NEWS, DIRECTORY]],
    ids=["empty", "news-only", "news-and-food", "news-among-three"],
)
def test_invalid_scope_sets_are_refused_atomically(auth_env: AuthEnv, scopes: list[Any]) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "scopes@example.org")
    before = snapshot(auth_env.session, cand.id)

    response = appoint(admin, cand.email, scopes)

    assert response.status_code == 422 and detail_code(response) == "invalid_staff_scope"
    assert snapshot(auth_env.session, cand.id) == before  # no role without scopes, ever
    assert scopes_of(auth_env.session, cand.id) == []


def test_an_unknown_scope_value_and_a_duplicate_list_are_handled_before_any_write(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "dupes@example.org")
    before = snapshot(auth_env.session, cand.id)

    assert appoint(admin, cand.email, ["nonsense"]).status_code == 422
    assert snapshot(auth_env.session, cand.id) == before

    assert appoint(admin, cand.email, [FOOD, FOOD, FOOD]).status_code == 201
    assert scopes_of(auth_env.session, cand.id) == ["food"]  # de-duplicated: one row


@pytest.mark.parametrize(
    "extra",
    [
        {"role": "admin"},
        {"roles": ["admin"]},
        {"staffScopes": ["food"]},
        {"userId": "x"},
        {"grantedBy": "x"},
        {"emailVerified": True},
        {"module": "food"},
    ],
)
def test_authority_cannot_be_smuggled_in_through_extra_fields(
    auth_env: AuthEnv, extra: dict[str, Any]
) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "smuggle@example.org")
    before = snapshot(auth_env.session, cand.id)

    response = admin.request(
        "POST", MODERATORS, json={"email": cand.email, "scopes": ["food"], **extra}
    )

    assert response.status_code == 422
    assert snapshot(auth_env.session, cand.id) == before


# -- scope replacement ----------------------------------------------------------------------------


def test_replacing_scopes_adds_removes_and_audits_before_and_after(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=[FOOD, EDUCATION])
    browsers = open_sessions(auth_env, mod.email, 2)
    auth_env.clock.advance(seconds=1)

    response = put_scopes(admin, mod.id, [EDUCATION, PROPERTY, DIRECTORY])

    assert response.status_code == 200, response.text
    assert data(response)["scopes"] == ["directory", "education", "property"]
    assert scopes_of(auth_env.session, mod.id) == ["directory", "education", "property"]
    assert live_sessions(auth_env.session, mod.id) == 0 and browsers[0].me().status_code == 401
    events = [e for e in audit_events(auth_env.session) if e.action.value.startswith("scope_")]
    assert {e.action for e in events} == {
        StaffAuditAction.SCOPE_GRANTED,
        StaffAuditAction.SCOPE_REVOKED,
    }
    for event in events:  # each carries the FULL before / after sets
        assert event.target_user_id == mod.id and event.source is StaffAuditSource.WEB
        assert event.before == {
            "role": "moderator",
            "scopes": ["education", "food"],
            "paused": False,
            "revision": 1,
        }
        assert event.after is not None and event.after["revision"] == 2
        assert event.after["scopes"] == ["directory", "education", "property"]
        assert event.after["sessions_revoked"] == 2


@pytest.mark.parametrize(
    ("start", "target", "actions"),
    [
        ([FOOD], [FOOD, EDUCATION], {StaffAuditAction.SCOPE_GRANTED}),
        ([FOOD, EDUCATION], [FOOD], {StaffAuditAction.SCOPE_REVOKED}),
    ],
    ids=["add-only", "remove-only"],
)
def test_only_the_kind_of_change_that_happened_is_audited(
    auth_env: AuthEnv, start: list[Any], target: list[Any], actions: set[StaffAuditAction]
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=start)

    assert put_scopes(admin, mod.id, target).status_code == 200

    scope_events = {e.action for e in audit_events(auth_env.session)} - {
        StaffAuditAction.MODERATOR_APPOINTED
    }
    assert scope_events == actions


def test_replacing_with_the_same_set_changes_nothing_at_all(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=[FOOD, DIRECTORY])
    browser = sign_in(auth_env, mod.email)
    before = snapshot(auth_env.session, mod.id)

    response = put_scopes(admin, mod.id, [DIRECTORY, FOOD])  # same set, any order

    assert response.status_code == 200 and data(response)["scopes"] == ["directory", "food"]
    assert snapshot(auth_env.session, mod.id) == before  # no revocation, no audit
    assert browser.me().status_code == 200  # the live session survived


def test_a_failed_replacement_leaves_the_old_scopes_in_place(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=[FOOD, DIRECTORY])
    sign_in(auth_env, mod.email)
    before = snapshot(auth_env.session, mod.id)

    for bad in ([], [NEWS], [FOOD, NEWS], ["nonsense"]):
        assert put_scopes(admin, mod.id, bad).status_code == 422
        assert snapshot(auth_env.session, mod.id) == before
    assert scopes_of(auth_env.session, mod.id) == ["directory", "food"]


def test_scopes_cannot_be_replaced_on_a_paused_moderator_or_a_non_moderator(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin)
    assert pause(admin, mod.id).status_code == 200
    stranger = candidate(auth_env, "stranger@example.org")
    super_admin_row = make_account(auth_env.session, "peer@example.org", admin=True)

    paused = put_scopes(admin, mod.id, [FOOD])
    unknown = put_scopes(admin, uuid.uuid4(), [FOOD])
    non_staff = put_scopes(admin, stranger.id, [FOOD])
    malformed = put_scopes(admin, "not-a-uuid", [FOOD])
    peer = put_scopes(admin, super_admin_row.id, [FOOD])

    assert (paused.status_code, detail_code(paused)) == (409, "moderator_paused")
    assert peer.status_code == 403 and detail_code(peer) == "super_admin_target_forbidden"
    for refusal in (unknown, non_staff, malformed):
        assert refusal.status_code == 404 and detail_code(refusal) == "moderator_not_found"
    # a nonexistent id and an existing non-staff id are indistinguishable (no oracle)
    assert error_shape(unknown) == error_shape(non_staff) == error_shape(malformed)
    assert scopes_of(auth_env.session, mod.id) == []


# -- pause / resume -------------------------------------------------------------------------------


def test_pausing_keeps_the_role_deletes_every_scope_and_leaves_zero_authority(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=[FOOD, DIRECTORY])
    browsers = open_sessions(auth_env, mod.email, 2)
    auth_env.clock.advance(seconds=1)

    response = pause(admin, mod.id)

    assert response.status_code == 200, response.text
    assert data(response)["paused"] is True and data(response)["scopes"] == []
    assert roles_of(auth_env.session, mod.id) == {"moderator"}  # the role stays
    assert scopes_of(auth_env.session, mod.id) == []
    assert live_sessions(auth_env.session, mod.id) == 0 and browsers[0].me().status_code == 401
    event = audit_events(auth_env.session)[-1]
    assert event.action is StaffAuditAction.MODERATOR_PAUSED
    assert event.before == {
        "role": "moderator",
        "scopes": ["directory", "food"],
        "paused": False,
        "revision": 1,
    }
    assert event.after == {
        "role": "moderator",
        "scopes": [],
        "paused": True,
        "sessions_revoked": 2,
        "revision": 2,
    }

    paused = sign_in(auth_env, mod.email)
    assert paused.me().json()["data"]["staffScopes"] == []
    assert paused.get("/admin/listings").status_code == 403  # a paused Moderator is not staff


def test_pausing_twice_or_a_non_moderator_is_refused(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin)
    stranger = candidate(auth_env, "stranger2@example.org")
    assert pause(admin, mod.id).status_code == 200
    before = snapshot(auth_env.session, mod.id)

    again = pause(admin, mod.id)
    non_staff = pause(admin, stranger.id)

    assert (again.status_code, detail_code(again)) == (409, "moderator_already_paused")
    assert (non_staff.status_code, detail_code(non_staff)) == (404, "moderator_not_found")
    assert snapshot(auth_env.session, mod.id) == before


def test_resuming_restores_scopes_revokes_sessions_and_authority_returns_after_login(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=[FOOD])
    pause(admin, mod.id)
    paused_browser = sign_in(auth_env, mod.email)
    auth_env.clock.advance(seconds=1)

    response = resume(admin, mod.id, [EDUCATION, PROPERTY])

    assert response.status_code == 200, response.text
    assert data(response)["paused"] is False and data(response)["scopes"] == [
        "education",
        "property",
    ]
    assert scopes_of(auth_env.session, mod.id) == ["education", "property"]
    assert live_sessions(auth_env.session, mod.id) == 0
    assert paused_browser.me().status_code == 401  # revoked at resume
    event = audit_events(auth_env.session)[-1]
    assert event.action is StaffAuditAction.SCOPE_GRANTED  # recorded from a PAUSED state
    assert event.before == {"role": "moderator", "scopes": [], "paused": True, "revision": 2}
    assert event.after == {
        "role": "moderator",
        "scopes": ["education", "property"],
        "paused": False,
        "sessions_revoked": 1,
        "revision": 3,
    }
    assert sign_in(auth_env, mod.email).get("/admin/listings").status_code == 200


@pytest.mark.parametrize("scopes", [[], [NEWS], [FOOD, NEWS]], ids=["empty", "news", "mixed"])
def test_resuming_needs_a_valid_scope(auth_env: AuthEnv, scopes: list[Any]) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin)
    pause(admin, mod.id)
    before = snapshot(auth_env.session, mod.id)

    response = resume(admin, mod.id, scopes)

    assert response.status_code == 422 and detail_code(response) == "invalid_staff_scope"
    assert snapshot(auth_env.session, mod.id) == before


def test_resuming_refuses_a_moderator_that_is_not_paused_or_no_longer_eligible(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    active = appointed(auth_env, admin, "active-mod@example.org")
    suspended = appointed(auth_env, admin, "to-suspend@example.org")
    pause(admin, suspended.id)
    auth_env.session.execute(
        update(User).where(User.id == suspended.id).values(status=UserStatus.SUSPENDED)
    )
    auth_env.session.commit()
    before_active, before_suspended = (
        snapshot(auth_env.session, active.id),
        snapshot(auth_env.session, suspended.id),
    )

    not_paused = resume(admin, active.id, [FOOD])
    ineligible = resume(admin, suspended.id, [FOOD])
    missing = resume(admin, uuid.uuid4(), [FOOD])

    assert (not_paused.status_code, detail_code(not_paused)) == (409, "moderator_not_paused")
    assert (ineligible.status_code, detail_code(ineligible)) == (422, "target_not_eligible")
    assert (missing.status_code, detail_code(missing)) == (404, "moderator_not_found")
    assert snapshot(auth_env.session, active.id) == before_active
    assert snapshot(auth_env.session, suspended.id) == before_suspended


# -- removal --------------------------------------------------------------------------------------


def test_removing_a_moderator_deletes_the_role_and_scopes_but_keeps_the_account(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, scopes=[FOOD, DIRECTORY])
    browsers = open_sessions(auth_env, mod.email, 2)
    auth_env.clock.advance(seconds=1)

    response = remove(admin, mod.id)

    assert response.status_code == 204 and response.content == b""
    assert roles_of(auth_env.session, mod.id) == set()
    assert scopes_of(auth_env.session, mod.id) == []
    assert live_sessions(auth_env.session, mod.id) == 0
    assert browsers[0].get("/admin/listings").status_code == 401  # the old cookie is dead
    assert auth_env.session.get(User, mod.id) is not None  # the account is untouched
    event = audit_events(auth_env.session)[-1]
    assert event.action is StaffAuditAction.MODERATOR_REMOVED
    assert event.before == {
        "role": "moderator",
        "scopes": ["directory", "food"],
        "paused": False,
        "revision": 1,
    }
    assert event.after == {"role": None, "scopes": [], "sessions_revoked": 2, "revision": 2}
    timeline = auth_env.session.scalars(
        select(AuthEvent).where(
            AuthEvent.user_id == mod.id, AuthEvent.event_type == AuthEventType.ROLE_REVOKED
        )
    ).all()
    assert len(timeline) == 1 and timeline[0].details == {"reason": "moderator"}

    plain = sign_in(auth_env, mod.email)  # the person can still sign in, as an ordinary account
    assert plain.me().json()["data"]["roles"] == []
    assert plain.get("/admin/listings").status_code == 403


def test_a_paused_moderator_can_be_removed_and_a_removal_cannot_be_repeated(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin)
    pause(admin, mod.id)

    assert remove(admin, mod.id).status_code == 204
    again = remove(admin, mod.id)

    assert (again.status_code, detail_code(again)) == (404, "moderator_not_found")
    assert audit_count(auth_env.session) == 3  # appointed, paused, removed


def test_a_super_admin_and_a_non_staff_account_cannot_be_removed_as_moderators(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    peer = make_account(auth_env.session, "peer-admin@example.org", admin=True)
    stranger = candidate(auth_env, "stranger3@example.org")
    me = user_id(auth_env, "sa@example.org")

    for target in (peer.id, me):  # a peer, and the acting Super Admin themselves
        response = remove(admin, target)
        assert (
            response.status_code == 403 and detail_code(response) == "super_admin_target_forbidden"
        )
    assert remove(admin, stranger.id).status_code == 404
    assert roles_of(auth_env.session, peer.id) == {"admin"}
    assert roles_of(auth_env.session, me) == {"admin"}


# -- the sensitive window -------------------------------------------------------------------------

MUTATIONS: dict[str, Callable[[AuthApi, uuid.UUID, str], Response]] = {
    "appoint": lambda api, _id, email: appoint(api, email, [FOOD]),
    "replace": lambda api, uid, _e: put_scopes(api, uid, [FOOD, EDUCATION]),
    "pause": lambda api, uid, _e: pause(api, uid),
    "resume": lambda api, uid, _e: resume(api, uid, [FOOD]),
    "remove": lambda api, uid, _e: remove(api, uid),
}


def test_a_session_within_the_window_may_mutate_including_exactly_at_the_boundary(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    first = candidate(auth_env, "w1@example.org")
    second = candidate(auth_env, "w2@example.org")

    assert appoint(admin, first.email, [FOOD]).status_code == 201  # age 0
    auth_env.clock.advance(minutes=15)  # EXACTLY 15 minutes: allowed (<=)
    assert appoint(admin, second.email, [FOOD]).status_code == 201


@pytest.mark.parametrize("operation", list(MUTATIONS))
def test_a_session_older_than_fifteen_minutes_cannot_mutate_and_nothing_changes(
    auth_env: AuthEnv, operation: str
) -> None:
    admin = super_admin(auth_env)
    mod = appointed(auth_env, admin, "target@example.org")
    if operation == "resume":
        pause(admin, mod.id)
    fresh = candidate(auth_env, "fresh-target@example.org")
    before = snapshot(auth_env.session, mod.id), snapshot(auth_env.session, fresh.id)
    auth_env.clock.advance(minutes=15, seconds=1)

    response = MUTATIONS[operation](admin, mod.id, fresh.email)

    assert response.status_code == 403 and error_code(response) == "forbidden"
    assert detail_code(response) == "sensitive_reauth_required"
    assert (
        snapshot(auth_env.session, mod.id),
        snapshot(auth_env.session, fresh.id),
    ) == (before if operation != "resume" else (before[0], before[1]))
    no_secrets(response.text)  # and no session metadata: no age, no timestamp, no cookie value
    assert "minutes" not in response.text and "expires" not in response.text.lower()


def test_signing_in_again_reopens_the_window_and_reads_never_needed_it(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "late@example.org")
    auth_env.clock.advance(minutes=16)

    assert appoint(admin, cand.email, [FOOD]).status_code == 403
    assert admin.get(STAFF).status_code == 200  # the normal staff freshness is enough to read
    assert admin.get(AUDIT).status_code == 200

    fresh_admin = sign_in(auth_env, "sa@example.org")
    assert appoint(fresh_admin, cand.email, [FOOD]).status_code == 201


def test_the_existing_idle_rule_still_wins_over_the_sensitive_one(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "idle@example.org")
    auth_env.clock.advance(hours=2, minutes=1)  # idle past the 2 h staff rule

    mutate = appoint(admin, cand.email, [FOOD])
    read = admin.get(STAFF)

    assert mutate.status_code == 401 and error_code(mutate) == "session_expired"
    assert read.status_code == 401 and error_code(read) == "session_expired"
    assert roles_of(auth_env.session, cand.id) == set()


# -- who may call it ------------------------------------------------------------------------------

ROUTES: dict[str, Callable[[AuthApi, uuid.UUID], Response]] = {
    "roster": lambda api, _id: api.get(STAFF),
    "audit": lambda api, _id: api.get(AUDIT),
    "appoint": lambda api, _id: appoint(api, "someone@example.org", [FOOD]),
    "replace": lambda api, uid: put_scopes(api, uid, [PROPERTY]),
    "pause": lambda api, uid: pause(api, uid),
    "resume": lambda api, uid: resume(api, uid, [PROPERTY]),
    "remove": lambda api, uid: remove(api, uid),
}
DENIED: dict[str, tuple[Callable[[AuthEnv], AuthApi], int, str]] = {
    "anonymous": (lambda env: env.client(), 401, "unauthenticated"),
    "unverified resident": (
        lambda env: signed_in(env, "unv@example.org", verified=False, professional=None),
        403,
        "email_not_verified",
    ),
    "resident": (
        lambda env: signed_in(env, "res@example.org", professional=None),
        403,
        "forbidden",
    ),
    "professional": (lambda env: signed_in(env, "pro@example.org"), 403, "forbidden"),
    "moderator": (
        lambda env: signed_in(env, "mod1@example.org", professional=None, moderator_scopes=[FOOD]),
        403,
        "forbidden",
    ),
    "moderator of every scope": (
        lambda env: signed_in(
            env,
            "mod2@example.org",
            professional=None,
            moderator_scopes=[FOOD, DIRECTORY, EDUCATION, PROPERTY],
        ),
        403,
        "forbidden",
    ),
    "paused moderator": (
        lambda env: signed_in(env, "mod3@example.org", professional=None, moderator_scopes=[]),
        403,
        "forbidden",
    ),
    "moderator with only news": (
        lambda env: signed_in(env, "mod4@example.org", professional=None, moderator_scopes=[NEWS]),
        403,
        "forbidden",
    ),
    "unverified super admin": (
        lambda env: signed_in(
            env, "unvsa@example.org", verified=False, professional=None, admin=True
        ),
        403,
        "email_not_verified",
    ),
}


@pytest.mark.parametrize("route", list(ROUTES))
@pytest.mark.parametrize("actor", list(DENIED))
def test_nobody_but_a_verified_super_admin_reaches_any_staff_route(
    auth_env: AuthEnv, actor: str, route: str
) -> None:
    admin = super_admin(auth_env)
    target = appointed(auth_env, admin, "protected@example.org", scopes=[FOOD, DIRECTORY])
    make, status, code = DENIED[actor]
    api = make(auth_env)
    before = snapshot(auth_env.session, target.id)

    response = ROUTES[route](api, target.id)

    assert (response.status_code, error_code(response)) == (status, code), (actor, route)
    assert response.headers["Cache-Control"] == "no-store"
    assert (
        snapshot(auth_env.session, target.id) == before
    )  # nothing read into a body, nothing written


def test_a_moderator_cannot_escalate_themselves_or_change_a_colleague(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mine = appointed(auth_env, admin, "mine@example.org", scopes=[FOOD])
    colleague = appointed(auth_env, admin, "colleague@example.org", scopes=[DIRECTORY])
    browser = sign_in(auth_env, mine.email)
    before = snapshot(auth_env.session, mine.id), snapshot(auth_env.session, colleague.id)

    own = put_scopes(browser, mine.id, [FOOD, DIRECTORY, EDUCATION, PROPERTY])
    other = put_scopes(browser, colleague.id, [])
    paused = pause(browser, colleague.id)
    forged = browser.request(
        "PUT",
        f"{MODERATORS}/{mine.id}/scopes",
        json={"scopes": ["food", "property"]},
        headers={"X-Staff-Scopes": "food,property", "X-Role": "admin"},
    )

    assert {r.status_code for r in (own, other, paused, forged)} == {403}
    assert (snapshot(auth_env.session, mine.id), snapshot(auth_env.session, colleague.id)) == before
    assert scopes_of(auth_env.session, mine.id) == ["food"]


# -- CSRF and Origin ------------------------------------------------------------------------------

UNSAFE: dict[str, Callable[..., Response]] = {
    "appoint": lambda api, uid, **kw: api.request(
        "POST", MODERATORS, json={"email": "x@example.org", "scopes": ["food"]}, **kw
    ),
    "replace": lambda api, uid, **kw: api.request(
        "PUT", f"{MODERATORS}/{uid}/scopes", json={"scopes": ["property"]}, **kw
    ),
    "pause": lambda api, uid, **kw: api.request("POST", f"{MODERATORS}/{uid}/pause", **kw),
    "resume": lambda api, uid, **kw: api.request(
        "POST", f"{MODERATORS}/{uid}/resume", json={"scopes": ["property"]}, **kw
    ),
    "remove": lambda api, uid, **kw: api.request("DELETE", f"{MODERATORS}/{uid}", **kw),
}
BROKEN_CSRF: dict[str, dict[str, Any]] = {
    "missing Origin": {"origin": None},
    "foreign Origin": {"origin": "https://evil.example"},
    "missing CSRF token": {"csrf": None},
    "wrong CSRF token": {"csrf": "not-the-token"},
    "cross-site fetch": {"headers": {"Sec-Fetch-Site": "cross-site"}},
}


@pytest.mark.parametrize("break_it", list(BROKEN_CSRF))
@pytest.mark.parametrize("route", list(UNSAFE))
def test_every_staff_mutation_enforces_csrf_and_origin_and_changes_nothing(
    auth_env: AuthEnv, route: str, break_it: str
) -> None:
    admin = super_admin(auth_env)
    target = appointed(auth_env, admin, "csrf-target@example.org", scopes=[FOOD])
    before = snapshot(auth_env.session, target.id)

    response = UNSAFE[route](admin, target.id, **BROKEN_CSRF[break_it])

    assert response.status_code == 403 and error_code(response) == "csrf_failed", (route, break_it)
    assert snapshot(auth_env.session, target.id) == before


# -- the roster -----------------------------------------------------------------------------------

MEMBER_KEYS = {
    "userId", "displayName", "email", "role", "scopes", "paused", "accountStatus",
    "emailVerified", "grantedAt", "grantedBy", "revision",
}  # fmt: skip


def test_the_roster_lists_staff_with_exactly_the_fields_an_administrator_needs(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env, name="Zed Admin")
    make_account(auth_env.session, "peer@example.org", admin=True, display_name="Amy Peer")
    active = appointed(
        auth_env, admin, "active@example.org", [FOOD, DIRECTORY], display_name="Bob Active"
    )
    paused = appointed(auth_env, admin, "paused@example.org", [FOOD], display_name="Cat Paused")
    pause(admin, paused.id)
    make_account(
        auth_env.session, "susp@example.org", moderator_scopes=[FOOD], status="suspended",
        display_name="Dan Suspended",
    )  # fmt: skip
    signed_in(auth_env, "resident@example.org", professional=None)  # NOT staff: must not appear

    response = admin.get(STAFF)

    assert response.status_code == 200, response.text
    members = response.json()["data"]
    assert [m["displayName"] for m in members] == [
        "Amy Peer", "Zed Admin", "Bob Active", "Cat Paused", "Dan Suspended",
    ]  # fmt: skip
    assert {m["role"] for m in members[:2]} == {"admin"} and {m["role"] for m in members[2:]} == {
        "moderator"
    }
    for member in members:  # a null ``grantedBy`` is OMITTED (API contract section 1), nothing else
        assert set(member) <= MEMBER_KEYS and MEMBER_KEYS - {"grantedBy"} <= set(member)
    by_name = {m["displayName"]: m for m in members}
    assert by_name["Zed Admin"]["scopes"] == [] and by_name["Zed Admin"]["paused"] is False
    assert by_name["Bob Active"]["scopes"] == ["directory", "food"]
    assert by_name["Cat Paused"]["paused"] is True and by_name["Cat Paused"]["scopes"] == []
    assert by_name["Dan Suspended"]["accountStatus"] == "suspended"
    assert by_name["Bob Active"]["grantedBy"] == {
        "userId": str(user_id(auth_env, "sa@example.org")),
        "displayName": "Zed Admin",
    }
    assert "grantedBy" not in by_name["Amy Peer"]  # a CLI / direct grant has no granting user
    assert "grantedBy" not in by_name["Dan Suspended"]
    assert response.json()["meta"] == {"total": 5, "limit": 50, "offset": 0}
    assert active.email in response.text
    no_secrets(response.text)


def test_the_roster_is_paginated_and_bounded(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env, name="Aaron Admin")
    for n in range(4):
        appointed(auth_env, admin, f"m{n}@example.org", [FOOD], display_name=f"Mod {n}")

    first = admin.get(STAFF, params={"limit": "2", "offset": "0"}).json()
    second = admin.get(STAFF, params={"limit": "2", "offset": "2"}).json()
    last = admin.get(STAFF, params={"limit": "2", "offset": "4"}).json()

    assert [first["meta"]["total"], second["meta"]["total"]] == [5, 5]
    names = [m["displayName"] for m in first["data"] + second["data"] + last["data"]]
    assert names == ["Aaron Admin", "Mod 0", "Mod 1", "Mod 2", "Mod 3"] and len(set(names)) == 5
    for bad in ("0", "101", "-1", "abc"):
        assert admin.get(STAFF, params={"limit": bad}).status_code == 422
    assert admin.get(STAFF, params={"offset": "-1"}).status_code == 422


# -- the audit ------------------------------------------------------------------------------------

ENTRY_KEYS = {
    "id", "occurredAt", "source", "action", "actor", "target", "resourceType", "resourceId",
    "before", "after", "reason", "requestId",
}  # fmt: skip


def lifecycle(env: AuthEnv, admin: AuthApi) -> User:
    """appoint -> replace -> pause -> resume -> remove, a second apart, plus one CLI promotion."""
    mod = candidate(env, "life@example.org", display_name="Lee Life")
    steps: list[Callable[[], Response]] = [
        lambda: appoint(admin, mod.email, [FOOD]),
        lambda: put_scopes(admin, mod.id, [FOOD, EDUCATION]),
        lambda: pause(admin, mod.id),
        lambda: resume(admin, mod.id, [PROPERTY]),
        lambda: remove(admin, mod.id),
    ]
    for step in steps:
        env.clock.advance(seconds=1)
        assert step().status_code in (200, 201, 204)
    env.clock.advance(seconds=1)
    rescuer = make_account(env.session, "promoted@example.org", display_name="Pat Promoted")
    service(env.session, env.clock).promote_super_admin(rescuer.email, REASON)
    return mod


def test_the_audit_lists_events_newest_first_with_actor_target_and_payloads(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    mod = lifecycle(auth_env, admin)

    response = admin.get(AUDIT)

    assert response.status_code == 200, response.text
    entries = response.json()["data"]
    assert [e["action"] for e in entries] == [
        "super_admin_promoted", "moderator_removed", "scope_granted", "moderator_paused",
        "scope_granted", "moderator_appointed",
    ]  # fmt: skip
    for entry in entries:  # absent optional fields are omitted (API contract section 1)
        assert {"id", "occurredAt", "source", "action"} <= set(entry) <= ENTRY_KEYS
    cli, removed = entries[0], entries[1]
    assert cli["source"] == "cli" and "actor" not in cli and cli["reason"] == REASON
    assert cli["target"]["displayName"] == "Pat Promoted"
    assert removed["source"] == "web"
    assert removed["actor"] == {
        "userId": str(user_id(auth_env, "sa@example.org")),
        "displayName": "Sam Admin",
    }
    assert removed["target"] == {"userId": str(mod.id), "displayName": "Lee Life"}
    assert removed["before"]["scopes"] == ["property"]
    assert removed["after"]["role"] is None  # the stored payload is returned exactly as stored
    assert response.json()["meta"] == {"total": 6, "limit": 25, "offset": 0}
    no_secrets(response.text)


def test_the_audit_filters_narrow_and_never_widen(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    mod = lifecycle(auth_env, admin)
    actor = user_id(auth_env, "sa@example.org")

    def ids(**params: str) -> list[str]:
        return [e["action"] for e in admin.get(AUDIT, params=params).json()["data"]]

    assert ids(action="moderator_paused") == ["moderator_paused"]
    assert ids(action="scope_granted") == ["scope_granted", "scope_granted"]
    assert len(ids(actor=str(actor))) == 5  # every web event; the CLI one has no actor
    assert len(ids(target=str(mod.id))) == 5  # the CLI promotion targeted somebody else
    assert ids(actor=str(actor), action="moderator_removed") == ["moderator_removed"]
    assert ids(action="moderator_removed", target=str(uuid.uuid4())) == []  # ANDed
    assert ids(resource="listing") == [] and ids(resource="category") == []
    assert ids(since="2999-01-01T00:00:00+00:00") == []
    assert ids(until="2000-01-01T00:00:00+00:00") == []
    assert len(ids(since="2000-01-01T00:00:00+00:00", until="2999-01-01T00:00:00+00:00")) == 6
    assert (
        len(ids(action="", actor="")) == 6
    )  # a blank filter is an absent filter, not a wildcard hack


def test_the_audit_is_paginated_stably_and_bounded(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    lifecycle(auth_env, admin)
    everything = [e["id"] for e in admin.get(AUDIT, params={"limit": "100"}).json()["data"]]

    pages: list[str] = []
    for offset in range(0, 6, 3):
        page = admin.get(AUDIT, params={"limit": "3", "offset": str(offset)}).json()
        assert page["meta"] == {"total": 6, "limit": 3, "offset": offset}
        pages += [e["id"] for e in page["data"]]

    assert pages == everything and len(set(pages)) == 6  # no gaps, no repeats
    assert admin.get(AUDIT, params={"offset": "50"}).json()["data"] == []
    for bad in ({"limit": "0"}, {"limit": "101"}, {"offset": "-1"}, {"offset": "100001"},
                {"action": "not_an_action"}, {"actor": "nope"}, {"since": "2024-01-01T00:00:00"},
                {"resource": "bogus"}):  # fmt: skip
        assert admin.get(AUDIT, params=bad).status_code == 422, bad


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_the_audit_api_is_read_only(auth_env: AuthEnv, method: str) -> None:
    admin = super_admin(auth_env)
    lifecycle(auth_env, admin)
    before = audit_count(auth_env.session)

    response = admin.request(method, AUDIT, json={"action": "moderator_removed"})

    assert response.status_code == 405
    assert audit_count(auth_env.session) == before


# -- the rate limit -------------------------------------------------------------------------------


def test_a_normal_staff_workflow_is_never_throttled(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    for n in range(4):
        cand = candidate(auth_env, f"flow{n}@example.org")
        assert appoint(admin, cand.email, [FOOD]).status_code == 201
        assert put_scopes(admin, cand.id, [FOOD, DIRECTORY]).status_code == 200
        if n % 2:
            assert pause(admin, cand.id).status_code == 200
            assert resume(admin, cand.id, [EDUCATION]).status_code == 200
    # 4 appointments + 4 replacements + 4 pause/resume = 12 mutations, well under the tripwire
    assert admin.get(STAFF).status_code == 200


def test_excessive_mutation_attempts_get_429_and_a_rejected_request_does_nothing(
    auth_env: AuthEnv,
) -> None:
    admin = super_admin(auth_env)
    other_admin = super_admin(auth_env, "sa2@example.org", "Sue Admin")
    cand = candidate(auth_env, "throttled@example.org")
    for n in range(20):  # failing attempts count too: probing accounts is throttled as well
        assert appoint(admin, f"nobody{n}@example.org", [FOOD]).status_code == 422
    before = snapshot(auth_env.session, cand.id)

    blocked = appoint(admin, cand.email, [FOOD])  # a VALID request, over the limit

    assert blocked.status_code == 429 and error_code(blocked) == "rate_limited"
    assert int(blocked.headers["Retry-After"]) >= 1
    assert snapshot(auth_env.session, cand.id) == before  # the service was never reached
    # reads are not mutations; another Super Admin has their own counter
    assert admin.get(STAFF).status_code == 200 and admin.get(AUDIT).status_code == 200
    assert appoint(other_admin, cand.email, [FOOD]).status_code == 201


def test_the_limit_belongs_to_the_actor_not_to_a_session_or_a_browser(auth_env: AuthEnv) -> None:
    """Signing in again, or using several browsers, does not buy a fresh allowance."""
    first_browser = super_admin(auth_env)
    second_browser = sign_in(auth_env, "sa@example.org")  # the same Super Admin, another session
    cand = candidate(auth_env, "shared-limit@example.org")
    for n in range(10):
        assert appoint(first_browser, f"ghost-a{n}@example.org", [FOOD]).status_code == 422
        assert appoint(second_browser, f"ghost-b{n}@example.org", [FOOD]).status_code == 422

    assert appoint(first_browser, cand.email, [FOOD]).status_code == 429
    assert appoint(second_browser, cand.email, [FOOD]).status_code == 429
    assert roles_of(auth_env.session, cand.id) == set()


def test_the_limit_resets_with_the_window(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "later@example.org")
    for n in range(21):
        appoint(admin, f"nobody{n}@example.org", [FOOD])
    assert appoint(admin, cand.email, [FOOD]).status_code == 429

    auth_env.clock.advance(minutes=16)  # a new window, and (separately) a new sensitive window
    fresh = sign_in(auth_env, "sa@example.org")

    assert appoint(fresh, cand.email, [FOOD]).status_code == 201


# -- the routes carry no secrets ------------------------------------------------------------------


def test_no_staff_response_contains_a_secret_field(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    cand = candidate(auth_env, "plain@example.org")
    responses = [
        appoint(admin, cand.email, [FOOD]),
        put_scopes(admin, cand.id, [FOOD, DIRECTORY]),
        pause(admin, cand.id),
        resume(admin, cand.id, [FOOD]),
        admin.get(STAFF),
        admin.get(AUDIT),
    ]
    for response in responses:
        assert response.status_code in (200, 201), response.text
        no_secrets(response.text)
    stored = auth_env.session.scalar(select(UserRole.role).where(UserRole.user_id == cand.id))
    assert stored is not None
