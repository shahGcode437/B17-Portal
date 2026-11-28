"""A staff change is made on a stated revision (GROCERY-4A, ``docs/backend/AUTH_RBAC.md`` §39).

Through the real endpoints, judged by the stored rows. Concurrency has its own tests over
independent connections (``test_staff_revision_concurrency.py``); nothing here claims to prove it.
"""

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from httpx import Response

from app.models import User
from app.models.enums import StaffAuditAction
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.staff_helpers import (
    DIRECTORY,
    FOOD,
    MODERATORS,
    PROPERTY,
    REASON,
    STAFF,
    appoint,
    audit_count,
    audit_events,
    auth_event_count,
    candidate,
    detail_code,
    open_sessions,
    pause,
    put_scopes,
    remove,
    resume,
    revision_of,
    service,
    snapshot,
    super_admin,
)


def data(response: Response) -> dict[str, Any]:
    assert response.status_code in (200, 201), response.text
    body: dict[str, Any] = response.json()["data"]
    return body


def stale(response: Response, current: int) -> None:
    assert response.status_code == 409, response.text
    error = response.json()["error"]
    assert error["code"] == "conflict"
    (detail,) = error["details"]
    assert detail["code"] == "staff_changed" and detail["field"] == "revision"
    assert detail["currentRevision"] == current


def setup(env: AuthEnv, email: str = "mod@example.org") -> tuple[AuthApi, User]:
    admin = super_admin(env)
    return admin, candidate(env, email)


def stored(env: AuthEnv, user: User) -> tuple[Any, ...]:
    """Everything a refused change must leave as it was."""
    return (
        snapshot(env.session, user.id),
        revision_of(env.session, user.id),
        audit_count(env.session),
        auth_event_count(env.session),
    )


# -- the revision itself ---------------------------------------------------------------------------


def test_every_change_advances_the_revision_by_one_and_says_so(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    assert revision_of(auth_env.session, user.id) == 0

    assert data(appoint(admin, user.email, [FOOD], revision=0))["revision"] == 1
    assert data(put_scopes(admin, user.id, [DIRECTORY], revision=1))["revision"] == 2
    assert data(pause(admin, user.id, revision=2))["revision"] == 3
    assert data(resume(admin, user.id, [FOOD], revision=3))["revision"] == 4
    assert remove(admin, user.id, revision=4).status_code == 204
    assert revision_of(auth_env.session, user.id) == 5  # it is the ACCOUNT's: removal keeps it
    stale(appoint(admin, user.email, [FOOD], revision=0), 5)
    assert data(appoint(admin, user.email, [FOOD], revision=5))["revision"] == 6

    # The test clock gives every audit row one time, so their order is undefined: sort them.
    recorded = sorted(
        ((e.before or {})["revision"], (e.after or {})["revision"])
        for e in audit_events(auth_env.session)
    )
    # The replacement writes two rows (a scope added, a scope removed) for its one step.
    assert recorded == [(0, 1), (1, 2), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6)]


def test_the_roster_reports_each_accounts_revision(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD]))
    data(put_scopes(admin, user.id, [PROPERTY]))
    rows = admin.get(STAFF).json()["data"]
    assert {row["email"]: row["revision"] for row in rows} == {
        "sa@example.org": 0,
        "mod@example.org": 2,
    }


def test_a_change_that_changes_nothing_leaves_the_revision(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD]))
    before = stored(auth_env, user)
    assert data(put_scopes(admin, user.id, [FOOD], revision=1))["revision"] == 1
    assert stored(auth_env, user) == before


# -- stale changes ---------------------------------------------------------------------------------

Operation = Callable[[AuthApi, User, int], Response]

OPERATIONS: dict[str, Operation] = {
    "replace": lambda api, user, at: put_scopes(api, user.id, [PROPERTY], revision=at),
    "pause": lambda api, user, at: pause(api, user.id, revision=at),
    "resume": lambda api, user, at: resume(api, user.id, [PROPERTY], revision=at),
    "remove": lambda api, user, at: remove(api, user.id, revision=at),
    "appoint": lambda api, user, at: appoint(api, user.email, [PROPERTY], revision=at),
}


def prepared(env: AuthEnv, operation: str) -> tuple[AuthApi, User]:
    """A target on which ``operation`` would succeed at its current revision."""
    admin, user = setup(env)
    if operation != "appoint":
        data(appoint(admin, user.email, [FOOD]))
    else:  # a returning member: appointed and removed before
        data(appoint(admin, user.email, [FOOD]))
        assert remove(admin, user.id).status_code == 204
    if operation == "resume":
        data(pause(admin, user.id))
    open_sessions(env, user.email, 2)
    return admin, user


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("offset", [-1, 1], ids=["behind", "ahead"])
def test_any_other_revision_is_refused_and_changes_nothing(
    auth_env: AuthEnv, operation: str, offset: int
) -> None:
    admin, user = prepared(auth_env, operation)
    current = revision_of(auth_env.session, user.id)
    before = stored(auth_env, user)

    stale(OPERATIONS[operation](admin, user, current + offset), current)

    assert stored(auth_env, user) == before  # no role, scope, session, audit or event
    # ...and the same change on the current revision still works.
    assert OPERATIONS[operation](admin, user, current).status_code in (200, 201, 204)


# -- A -> B -> A: the visible state comes back, the change is still stale -----------------------------


def test_scopes_changed_and_changed_back(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    seen = data(appoint(admin, user.email, [FOOD]))["revision"]
    data(put_scopes(admin, user.id, [PROPERTY]))
    now = data(put_scopes(admin, user.id, [FOOD]))
    assert now["scopes"] == ["food"]  # exactly what was seen

    before = stored(auth_env, user)
    stale(put_scopes(admin, user.id, [FOOD, DIRECTORY], revision=seen), now["revision"])
    stale(put_scopes(admin, user.id, [FOOD], revision=seen), now["revision"])  # "no change", too
    stale(pause(admin, user.id, revision=seen), now["revision"])
    stale(remove(admin, user.id, revision=seen), now["revision"])
    assert stored(auth_env, user) == before


def test_paused_and_resumed(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    seen = data(appoint(admin, user.email, [FOOD]))["revision"]
    data(pause(admin, user.id))
    now = data(resume(admin, user.id, [FOOD]))["revision"]

    stale(pause(admin, user.id, revision=seen), now)
    stale(put_scopes(admin, user.id, [PROPERTY], revision=seen), now)


def test_removed_and_appointed_again(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    seen = data(appoint(admin, user.email, [FOOD]))["revision"]
    assert remove(admin, user.id).status_code == 204
    now = data(appoint(admin, user.email, [FOOD]))["revision"]

    stale(pause(admin, user.id, revision=seen), now)
    stale(remove(admin, user.id, revision=seen), now)
    stale(put_scopes(admin, user.id, [PROPERTY], revision=seen), now)


def test_an_appointment_decided_before_another_came_and_went(auth_env: AuthEnv) -> None:
    """Someone who saw an account that had never been staff does not re-appoint it by accident."""
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD], revision=0))
    assert remove(admin, user.id).status_code == 204

    stale(appoint(admin, user.email, [FOOD, PROPERTY], revision=0), 2)


# -- what is never told, and what still answers first -------------------------------------------------


@pytest.mark.parametrize("account", ["unknown", "unverified", "suspended"])
def test_an_ineligible_address_never_reveals_a_revision(auth_env: AuthEnv, account: str) -> None:
    admin = super_admin(auth_env)
    email = "target@example.org"
    if account != "unknown":
        overrides: dict[str, Any] = (
            {"verified": False} if account == "unverified" else {"status": "suspended"}
        )
        candidate(auth_env, email, **overrides)
    response = appoint(admin, email, [FOOD], revision=7)
    assert response.status_code == 422 and detail_code(response) == "target_not_eligible"
    assert "currentRevision" not in response.text


def test_a_super_admin_target_is_refused_as_before_whatever_the_revision(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    other = super_admin(auth_env, "other@example.org", "Other Admin")
    for response in (
        appoint(admin, "other@example.org", [FOOD], revision=9),
        pause(admin, other.me().json()["data"]["id"], revision=9),
    ):
        assert response.status_code == 403
        assert detail_code(response) == "super_admin_target_forbidden"
        assert "currentRevision" not in response.text


def test_lost_authority_answers_before_the_revision(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD]))
    super_admin(auth_env, "keeper@example.org", "Keeper")
    service(auth_env.session, auth_env.clock).demote_super_admin("sa@example.org", REASON)

    response = pause(admin, user.id, revision=999)

    assert response.status_code in (401, 403) and "currentRevision" not in response.text


def test_an_unknown_member_is_not_found_whatever_the_revision(auth_env: AuthEnv) -> None:
    admin = super_admin(auth_env)
    response = pause(admin, uuid.UUID(int=5), revision=3)
    assert response.status_code == 404 and detail_code(response) == "moderator_not_found"


# -- required, and strictly a number ---------------------------------------------------------------


def bodies(user: User, revision: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    return [
        ("POST", MODERATORS, {"email": user.email, "scopes": ["food"], **revision}),
        ("PUT", f"{MODERATORS}/{user.id}/scopes", {"scopes": ["property"], **revision}),
        ("POST", f"{MODERATORS}/{user.id}/pause", dict(revision)),
        ("POST", f"{MODERATORS}/{user.id}/resume", {"scopes": ["property"], **revision}),
    ]


@pytest.mark.parametrize(
    "revision",
    [
        {},
        {"revision": None},
        {"revision": -1},
        {"revision": "1"},
        {"revision": 1.5},
        {"revision": True},
    ],
    ids=["missing", "null", "negative", "text", "fraction", "boolean"],
)
def test_a_change_without_a_proper_revision_is_refused(
    auth_env: AuthEnv, revision: dict[str, Any]
) -> None:
    """Including an older client, which sends none: it cannot overwrite anything."""
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD]))
    before = stored(auth_env, user)

    for method, path, body in bodies(user, revision):
        response = admin.request(method, path, json=body)
        assert response.status_code == 422, (method, path, response.text)
        assert response.json()["error"]["code"] == "validation_error"

    assert stored(auth_env, user) == before


def test_an_older_clients_bodiless_pause_is_refused(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD]))
    before = stored(auth_env, user)
    assert admin.request("POST", f"{MODERATORS}/{user.id}/pause").status_code == 422
    assert stored(auth_env, user) == before


@pytest.mark.parametrize("query", [{}, {"revision": "-1"}, {"revision": "x"}, {"revision": ""}])
def test_a_removal_without_a_proper_revision_is_refused(
    auth_env: AuthEnv, query: dict[str, str]
) -> None:
    admin, user = setup(auth_env)
    data(appoint(admin, user.email, [FOOD]))
    before = stored(auth_env, user)

    response = admin.request("DELETE", f"{MODERATORS}/{user.id}", params=query)

    assert response.status_code == 422, response.text
    assert stored(auth_env, user) == before


# -- the operator CLI is a writer too --------------------------------------------------------------


def test_promotion_and_demotion_advance_the_revision(auth_env: AuthEnv) -> None:
    admin, user = setup(auth_env)
    seen = data(appoint(admin, user.email, [FOOD]))["revision"]
    cli = service(auth_env.session, auth_env.clock)

    assert cli.promote_super_admin(user.email, REASON).changed
    assert revision_of(auth_env.session, user.id) == seen + 1
    assert not cli.promote_super_admin(user.email, REASON).changed  # a no-op
    assert revision_of(auth_env.session, user.id) == seen + 1
    assert cli.demote_super_admin(user.email, REASON).changed
    assert revision_of(auth_env.session, user.id) == seen + 2
    assert not cli.demote_super_admin(user.email, REASON).changed
    assert revision_of(auth_env.session, user.id) == seen + 2

    # What a web page saw before the operator's changes can't be used, even for a new appointment.
    stale(appoint(admin, user.email, [FOOD], revision=seen), seen + 2)
    (demoted,) = [
        event
        for event in audit_events(auth_env.session)
        if event.action is StaffAuditAction.SUPER_ADMIN_DEMOTED
    ]
    assert (demoted.before or {})["revision"] == seen + 1
    assert (demoted.after or {})["revision"] == seen + 2
