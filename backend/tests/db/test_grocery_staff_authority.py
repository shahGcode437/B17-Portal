"""GROCERY-1a: the ``grocery`` staff scope through the real app (docs/backend/AUTH_RBAC.md §32).

What it proves:

* ``require_grocery_staff`` admits a Super Admin or a Moderator who holds ``grocery``, and nobody
  else (it has no production route yet, so it is exercised through a TEST-ONLY router);
* a Grocery-only Moderator is refused on EVERY existing ``/admin`` route and changes nothing, and
  gets exactly a Resident's answers elsewhere — also when the front door is bypassed;
* adding ``grocery`` to a Moderator changes nothing else about what they can do;
* the existing staff-management API appoints, narrows, pauses, resumes and removes it, with the
  same session revocation and audit; nobody else's assignments change;
* no listing taxonomy comes with it;
* revocation and the locks a Grocery write will take linearise on real, separate connections.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import APIRouter
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from app.api.v1.admin import ADMIN_AUTHORITY
from app.core.errors import AppError
from app.db.reference_data import REFERENCE_CATEGORIES
from app.dependencies.auth import GroceryStaffUser, StaffUser
from app.models import Category, StaffScopeAssignment, User
from app.models.enums import (
    CategoryModule,
    ListingStatus,
    PlanCode,
    RoleName,
    StaffAuditAction,
    StaffScope,
)
from app.repositories.staff import StaffAuthorityRepository
from app.services.auth_sessions import Principal
from app.services.moderation import ModerationService
from app.services.moderation_rules import ModerationAction
from app.services.portal_requests import PortalRequestService
from app.services.provider_authoring import ProviderAuthoringService
from app.services.request_rules import RequestAction
from app.services.staff_authority import StaffAuthorityService
from app.services.staff_scopes import GROCERY_SCOPE, LISTING_STAFF_SCOPES
from tests.db.admin_helpers import ADMIN_CATEGORIES, ADMIN_LISTINGS, category_id, pending
from tests.db.auth_helpers import AuthApi, AuthEnv, FakeClock, make_account
from tests.db.request_helpers import approved_provider, sent_id
from tests.db.staff_helpers import (
    AUDIT,
    DIRECTORY,
    FOOD,
    GROCERY,
    MODERATORS,
    NEWS,
    SERVICES,
    STAFF,
    appoint,
    audit_events,
    candidate,
    detail_code,
    live_session,
    live_sessions,
    open_sessions,
    pause,
    policy,
    purge_staff_audit,
    put_scopes,
    remove,
    resume,
    revoke_reasons,
    roles_of,
    scopes_of,
    sign_in,
    snapshot,
    super_admin,
)
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_api import seed_one_of_each
from tests.db.test_scoped_moderation_concurrency import (
    TIMEOUT,
    Decision,
    Revoker,
    gate_at,
    wait_until,
    waiting_on_a_lock,
)
from tests.db.write_helpers import provider_body, signed_in
from tests.write_payloads import business_body, food_body

LISTING_SCOPES = sorted(LISTING_STAFF_SCOPES)

probe = APIRouter(prefix="/_grocery_probe")


@probe.get("/grocery")
def grocery_probe(user: GroceryStaffUser) -> dict[str, Any]:
    return {"user": str(user.user_id), "scopes": sorted(user.staff_scopes)}


@probe.get("/listing")
def listing_probe(user: StaffUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


GROCERY_GUARD = "/_grocery_probe/grocery"
LISTING_GUARD = "/_grocery_probe/listing"


@pytest.fixture
def env(auth_env: AuthEnv) -> AuthEnv:
    auth_env.app.include_router(probe, prefix="/api/v1")
    return auth_env


def actor(env: AuthEnv, **account: Any) -> AuthApi:
    email = f"actor-{uuid.uuid4().hex[:10]}@example.org"
    make_account(env.session, email, **account)
    api = env.client()
    assert api.login(email=email).status_code == 200
    return api


def answer(response: Any) -> tuple[int, str | None]:
    """``(status, error code)``."""
    code = response.json()["error"]["code"] if response.status_code >= 400 else None
    return response.status_code, code


# -- the authorization matrix ----------------------------------------------------------------------

OK = (200, None)
NO = (403, "forbidden")
UNVERIFIED = (403, "email_not_verified")

#: (label, account, Grocery guard, listing-staff guard)
MATRIX: list[tuple[str, dict[str, Any], tuple[int, str | None], tuple[int, str | None]]] = [
    ("resident", {}, NO, NO),
    ("professional", {"professional": PlanCode.PREMIUM}, NO, NO),
    ("super admin", {"admin": True}, OK, OK),
    ("grocery only", {"moderator_scopes": [GROCERY]}, OK, NO),
    (
        "grocery + professional",
        {"moderator_scopes": [GROCERY], "professional": PlanCode.FREE},
        OK,
        NO,
    ),
    ("grocery + reserved news", {"moderator_scopes": [GROCERY, NEWS]}, OK, NO),
    *[(f"grocery + {s.value}", {"moderator_scopes": [GROCERY, s]}, OK, OK) for s in LISTING_SCOPES],
    ("every assignable scope", {"moderator_scopes": [*LISTING_SCOPES, GROCERY]}, OK, OK),
    *[(f"{s.value} only", {"moderator_scopes": [s]}, NO, OK) for s in LISTING_SCOPES],
    ("every listing scope, no grocery", {"moderator_scopes": LISTING_SCOPES}, NO, OK),
    ("reserved news only", {"moderator_scopes": [NEWS]}, NO, NO),
    ("paused moderator", {"moderator_scopes": []}, NO, NO),
    (
        "unverified grocery",
        {"moderator_scopes": [GROCERY], "verified": False},
        UNVERIFIED,
        UNVERIFIED,
    ),
    ("unverified super admin", {"admin": True, "verified": False}, UNVERIFIED, UNVERIFIED),
]


@pytest.mark.parametrize(
    ("account", "grocery", "listing"),
    [row[1:] for row in MATRIX],
    ids=[row[0] for row in MATRIX],
)
def test_the_grocery_authorization_matrix(
    env: AuthEnv,
    account: dict[str, Any],
    grocery: tuple[int, str | None],
    listing: tuple[int, str | None],
) -> None:
    api = actor(env, **account)

    assert answer(api.get(GROCERY_GUARD)) == grocery
    assert answer(api.get(LISTING_GUARD)) == listing


def test_anonymous_is_unauthenticated(env: AuthEnv) -> None:
    assert answer(env.client().get(GROCERY_GUARD)) == (401, "unauthenticated")


def test_the_scope_is_read_from_the_database_never_from_the_request(env: AuthEnv) -> None:
    api = actor(env, moderator_scopes=[FOOD])
    forged = {"X-Staff-Scopes": "grocery", "X-Role": "admin"}

    assert (
        answer(api.get(f"{GROCERY_GUARD}?staffScopes=grocery&scope=grocery", headers=forged)) == NO
    )


@pytest.mark.parametrize("change", ["scope", "role"])
def test_a_removed_grocery_scope_or_role_ends_access_on_the_next_request(
    env: AuthEnv, change: str
) -> None:
    api = actor(env, moderator_scopes=[GROCERY, FOOD])
    assert api.get(GROCERY_GUARD).status_code == 200

    sql = {
        "scope": "DELETE FROM staff_scope_assignments WHERE scope = 'grocery'",
        "role": "DELETE FROM user_roles",
    }[change]
    env.session.execute(text(sql))
    env.session.commit()

    assert answer(api.get(GROCERY_GUARD)) == NO  # same session, no new sign-in needed
    assert api.get(LISTING_GUARD).status_code == (200 if change == "scope" else 403)


def test_a_suspended_grocery_moderator_loses_the_session_at_once(env: AuthEnv) -> None:
    api = actor(env, moderator_scopes=[GROCERY])
    assert api.get(GROCERY_GUARD).status_code == 200

    env.session.execute(text("UPDATE users SET status = 'suspended'"))
    env.session.commit()

    assert api.get(GROCERY_GUARD).status_code == 401


def test_grocery_staff_obey_the_idle_session_rule(env: AuthEnv) -> None:
    api = actor(env, moderator_scopes=[GROCERY])
    env.clock.advance(hours=1, minutes=59)
    assert api.get(GROCERY_GUARD).status_code == 200

    env.clock.advance(hours=2, minutes=1)

    assert answer(api.get(GROCERY_GUARD)) == (401, "session_expired")
    assert api.get(GROCERY_GUARD).status_code == 401  # a refused request is not activity


def test_grocery_staff_obey_the_twelve_hour_session_rule(env: AuthEnv) -> None:
    api = actor(env, moderator_scopes=[GROCERY])
    for _ in range(8):
        env.clock.advance(hours=1, minutes=30)
        assert api.get("/auth/me").status_code == 200
    env.clock.advance(minutes=1)

    assert answer(api.get(GROCERY_GUARD)) == (401, "session_expired")


def test_auth_me_reports_a_grocery_moderator_without_inventing_anything(env: AuthEnv) -> None:
    api = actor(env, moderator_scopes=[GROCERY])

    me = api.me().json()["data"]

    assert me["roles"] == ["moderator"] and me["staffScopes"] == ["grocery"]
    assert "professional" not in me


# -- every existing /admin route -------------------------------------------------------------------


def database(session: Session) -> dict[str, list[str]]:
    """Every row of every table (sessions excepted: using one updates its last-seen time)."""
    session.expire_all()
    names = list(
        session.scalars(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                "AND tablename NOT IN ('auth_sessions', 'alembic_version') ORDER BY 1"
            )
        )
    )
    return {
        name: list(session.scalars(text(f'SELECT to_jsonb(t)::text FROM "{name}" AS t ORDER BY 1')))  # noqa: S608
        for name in names
    }


class World:
    """One pending listing of each kind, an approved Provider with a submitted request, a category
    and an existing Moderator: a real target for every ``/admin`` route."""

    def __init__(self, env: AuthEnv) -> None:
        self.pending = seed_one_of_each(env)
        author = signed_in(env, "world-author@example.org", professional=None, admin=True)
        self.provider = approved_provider(env, author, "Approved Provider Co")
        self.requester = signed_in(env, "requester@example.org", professional=None)
        self.request = sent_id(self.requester, self.provider)
        self.category = category_id(env.session, "food", "bakeries")
        self.moderator = make_account(
            env.session, "existing-mod@example.org", moderator_scopes=[FOOD]
        ).id
        self.admin = author

    def calls(self) -> dict[str, tuple[str, str, dict[str, Any] | None]]:
        """A well-formed call for EVERY entry of ``ADMIN_AUTHORITY``."""
        listing = self.pending["food"]
        reason = {"revision": 1, "reason": "Please add your opening hours and a description."}
        return {
            "GET /admin/categories": ("GET", ADMIN_CATEGORIES, None),
            "POST /admin/categories": ("POST", ADMIN_CATEGORIES, {"module": "food", "name": "New"}),
            "POST /admin/categories/reorder": (
                "POST",
                f"{ADMIN_CATEGORIES}/reorder",
                {"module": "food", "parentId": None, "orderedIds": [self.category]},
            ),
            "PATCH /admin/categories/{category_id}": (
                "PATCH",
                f"{ADMIN_CATEGORIES}/{self.category}",
                {"name": "Renamed"},
            ),
            "GET /admin/listings": ("GET", ADMIN_LISTINGS, None),
            "GET /admin/listings/{listing_id}": ("GET", f"{ADMIN_LISTINGS}/{listing}", None),
            "POST /admin/listings/{listing_id}/approve": (
                "POST",
                f"{ADMIN_LISTINGS}/{listing}/approve",
                {"revision": 1},
            ),
            "POST /admin/listings/{listing_id}/reject": (
                "POST",
                f"{ADMIN_LISTINGS}/{listing}/reject",
                reason,
            ),
            "POST /admin/providers": (
                "POST",
                "/admin/providers",
                {k: v for k, v in provider_body(name="Forged").items() if k != "kind"},
            ),
            "PATCH /admin/providers/{provider_id}": (
                "PATCH",
                f"/admin/providers/{self.provider}",
                {"revision": 1, "name": "Forged Name"},
            ),
            "POST /admin/providers/{provider_id}/archive": (
                "POST",
                f"/admin/providers/{self.provider}/archive",
                {"revision": 1},
            ),
            "GET /admin/requests": ("GET", "/admin/requests", None),
            "GET /admin/requests/{request_id}": ("GET", f"/admin/requests/{self.request}", None),
            **{
                f"POST /admin/requests/{{request_id}}/{action}": (
                    "POST",
                    f"/admin/requests/{self.request}/{action}",
                    None,
                )
                for action in ("accept", "start", "complete", "cancel")
            },
            "GET /admin/grocery/settings": ("GET", "/admin/grocery/settings", None),
            "PATCH /admin/grocery/settings": (
                "PATCH",
                "/admin/grocery/settings",
                {"revision": 1, "enabled": True},
            ),
            "GET /admin/staff": ("GET", STAFF, None),
            "GET /admin/audit": ("GET", AUDIT, None),
            "POST /admin/staff/moderators": (
                "POST",
                MODERATORS,
                {"email": "requester@example.org", "scopes": ["grocery"]},
            ),
            "PUT /admin/staff/moderators/{user_id}/scopes": (
                "PUT",
                f"{MODERATORS}/{self.moderator}/scopes",
                {"scopes": ["grocery"]},
            ),
            "POST /admin/staff/moderators/{user_id}/pause": (
                "POST",
                f"{MODERATORS}/{self.moderator}/pause",
                None,
            ),
            "POST /admin/staff/moderators/{user_id}/resume": (
                "POST",
                f"{MODERATORS}/{self.moderator}/resume",
                {"scopes": ["grocery"]},
            ),
            "DELETE /admin/staff/moderators/{user_id}": (
                "DELETE",
                f"{MODERATORS}/{self.moderator}",
                None,
            ),
        }


def send_call(api: AuthApi, call: tuple[str, str, dict[str, Any] | None]) -> Any:
    method, path, body = call
    if method == "GET":
        return api.get(path)
    return api.request(method, path) if body is None else api.request(method, path, json=body)


def test_grocery_only_is_refused_on_every_admin_route_and_changes_nothing(env: AuthEnv) -> None:
    world = World(env)
    calls = world.calls()
    # GROCERY-2 added the one kind of route a Grocery Moderator MAY use (grocery_staff); its
    # refusals of everyone else are in test_grocery_staff_api.py
    assert set(calls) == {
        key for key, value in ADMIN_AUTHORITY.items() if value != "grocery_staff"
    }, "a new /admin route needs a Grocery decision here"
    grocery = actor(env, moderator_scopes=[GROCERY])
    before = database(env.session)

    answers = {key: answer(send_call(grocery, call)) for key, call in calls.items()}

    assert answers == {key: NO for key in calls}
    # nothing at all changed: no listing, request, category, role, audit row or rate-limit count
    assert database(env.session) == before
    # the ids are real: a Super Admin reads every one of them
    assert {
        key: send_call(world.admin, call).status_code
        for key, call in calls.items()
        if call[0] == "GET"
    } == {key: 200 for key, call in calls.items() if call[0] == "GET"}


def test_the_refusal_comes_before_any_validation_or_lookup(env: AuthEnv) -> None:
    """A junk body or an id that does not exist answers exactly like a real one: no oracle."""
    grocery = actor(env, moderator_scopes=[GROCERY])
    missing = uuid.uuid4()

    assert answer(grocery.get(f"{ADMIN_LISTINGS}/{missing}")) == NO
    assert answer(grocery.get(f"/admin/requests/{missing}")) == NO
    assert answer(grocery.request("POST", "/admin/providers", json={"junk": True})) == NO
    assert answer(grocery.get(f"{ADMIN_LISTINGS}?limit=-1")) == NO


def test_grocery_only_gets_exactly_a_residents_answers_outside_admin(env: AuthEnv) -> None:
    """The ``moderator`` role itself opens nothing anywhere else."""
    world = World(env)
    listing = world.pending["food"]
    calls: list[tuple[str, str, dict[str, Any] | None]] = [
        ("GET", f"/requests/{world.request}", None),
        ("POST", f"/requests/{world.request}/accept", None),
        ("POST", f"/requests/{world.request}/start", None),
        ("POST", f"/requests/{world.request}/cancel", None),
        ("GET", "/requests", None),
        ("GET", "/users/me/leads", None),
        ("GET", "/users/me/listings", None),
        ("GET", f"/users/me/listings/{listing}", None),
        ("GET", f"/listings/{listing}", None),  # pending: not public
        ("PATCH", f"/listings/{listing}", {"revision": 1}),
        ("POST", f"/listings/{listing}/archive", {"revision": 1}),
        ("POST", "/listings", food_body(name="Not A Professional")),
    ]
    resident = actor(env)
    grocery = actor(env, moderator_scopes=[GROCERY])
    before = database(env.session)

    for method, path, body in calls:
        expected = send_call(resident, (method, path, body))
        got = send_call(grocery, (method, path, body))
        assert answer(got) == answer(expected), (method, path)
        if method != "GET":
            assert got.status_code >= 400, (method, path)
    assert database(env.session) == before


def test_the_services_refuse_a_grocery_only_actor_even_without_the_front_door(
    env: AuthEnv,
) -> None:
    """Second layer: authority can change between the start of a request and its transaction, so
    each service decides again. Called directly, with a Grocery-only principal."""
    world = World(env)
    email = "second-layer@example.org"
    user = make_account(env.session, email, moderator_scopes=[GROCERY])
    now = FakeClock()()
    acting_session = live_session(env.session, user.id)
    principal = Principal(
        user_id=user.id,
        display_name="Grocery Only",
        email=email,
        email_verified=True,
        roles=frozenset({RoleName.MODERATOR}),
        plan_code=None,
        session_id=acting_session,
        session_created_at=now,
        session_last_seen_at=now,
        session_expires_at=now,
        staff_scopes=frozenset({GROCERY_SCOPE}),
    )
    before = database(env.session)

    def refusal(work: Any) -> int:
        with pytest.raises(AppError) as raised:
            work()
        env.session.rollback()
        return raised.value.status_code

    requests = PortalRequestService(env.session, clock=FakeClock())
    providers = ProviderAuthoringService(env.session, localities=["B-17"], clock=FakeClock())
    moderation = ModerationService(env.session, clock=FakeClock())
    assert refusal(lambda: requests.get(principal, world.request)) == 404
    assert refusal(lambda: requests.act(principal, world.request, RequestAction.ACCEPT)) == 404
    for listing_id in world.pending.values():
        assert (
            refusal(
                lambda i=listing_id: moderation.decide(principal, i, ModerationAction.APPROVE, 1)
            )
            == 404
        )
    assert refusal(lambda: providers.archive(principal, world.provider, 1)) == 404
    assert database(env.session) == before


# -- adding grocery changes nothing else ------------------------------------------------------------


def fingerprint(api: AuthApi, world: World) -> dict[str, Any]:
    """What this Moderator can see and do across the staff surface, using calls that cannot change
    anything: reads, stale revisions (``409`` in scope, ``404`` outside) and unknown ids."""
    queue = api.get(f"{ADMIN_LISTINGS}?limit=50")
    result: dict[str, Any] = {
        "queue": answer(queue),
        "queue rows": sorted(r["id"] for r in queue.json().get("data", [])),
        "queue counts": queue.json().get("meta", {}).get("counts"),
    }
    for kind, listing in world.pending.items():
        result[f"read {kind}"] = answer(api.get(f"{ADMIN_LISTINGS}/{listing}"))
        result[f"approve {kind}"] = answer(
            api.request("POST", f"{ADMIN_LISTINGS}/{listing}/approve", json={"revision": 99})
        )
    requests = api.get("/admin/requests")
    result["requests"] = answer(requests)
    result["request rows"] = sorted(r["id"] for r in requests.json().get("data", []))
    result["request"] = answer(api.get(f"/admin/requests/{world.request}"))
    result["accept unknown"] = answer(api.request("POST", f"/admin/requests/{uuid.uuid4()}/accept"))
    result["provider stale"] = answer(
        api.request("POST", f"/admin/providers/{world.provider}/archive", json={"revision": 99})
    )
    for path in (ADMIN_CATEGORIES, STAFF, AUDIT):
        result[path] = answer(api.get(path))
    return result


def test_adding_grocery_leaves_every_listing_moderator_exactly_as_before(env: AuthEnv) -> None:
    world = World(env)
    before = database(env.session)
    chosen = [[scope] for scope in LISTING_SCOPES] + [[SERVICES, FOOD], list(LISTING_SCOPES)]
    pairs = [
        (actor(env, moderator_scopes=scopes), actor(env, moderator_scopes=[*scopes, GROCERY]))
        for scopes in chosen
    ]
    seen = []
    for scopes, (without, with_grocery) in zip(chosen, pairs, strict=True):
        expected = fingerprint(without, world)
        assert fingerprint(with_grocery, world) == expected, [s.value for s in scopes]
        seen.append(expected)
    # the fingerprint is not vacuous: scopes really do differ from one another
    assert len({str(item) for item in seen}) == len(seen)
    assert seen[0] != seen[1]
    after = database(env.session)
    for table in ("listings", "service_requests", "categories", "staff_audit_events"):
        assert after[table] == before[table], table


# -- the existing staff-management API ---------------------------------------------------------------


def grocery_events(env: AuthEnv, target: uuid.UUID) -> list[tuple[str, list[str], list[str]]]:
    return [
        (
            event.action.value,
            list((event.before or {}).get("scopes", [])),
            list((event.after or {}).get("scopes", [])),
        )
        for event in audit_events(env.session)
        if event.target_user_id == target
    ]


@pytest.mark.parametrize(
    "scopes", [[GROCERY], [GROCERY, FOOD], [SERVICES, GROCERY]], ids=["only", "food", "services"]
)
def test_a_super_admin_appoints_grocery_staff_through_the_existing_api(
    env: AuthEnv, scopes: list[StaffScope]
) -> None:
    admin = super_admin(env)
    cand = candidate(env, "new-grocery@example.org")
    old_sessions = open_sessions(env, cand.email, 2)
    expected = sorted(s.value for s in scopes)

    response = appoint(admin, cand.email, scopes)

    assert response.status_code == 201, response.text
    assert response.json()["data"]["scopes"] == expected
    assert roles_of(env.session, cand.id) == {"moderator"}  # no new global role
    assert scopes_of(env.session, cand.id) == expected
    assert live_sessions(env.session, cand.id) == 0
    assert revoke_reasons(env.session, cand.id) == {"role_change"}
    assert all(api.get(GROCERY_GUARD).status_code == 401 for api in old_sessions)
    assert grocery_events(env, cand.id) == [
        (StaffAuditAction.MODERATOR_APPOINTED.value, [], expected)
    ]
    fresh = sign_in(env, cand.email)
    assert fresh.get(GROCERY_GUARD).status_code == 200
    member = next(m for m in admin.get(STAFF).json()["data"] if m["userId"] == str(cand.id))
    assert member["scopes"] == expected and member["paused"] is False


def test_scope_replacement_pause_resume_and_removal_work_for_grocery(env: AuthEnv) -> None:
    admin = super_admin(env)
    cand = candidate(env, "lifecycle@example.org")
    assert appoint(admin, cand.email, [FOOD]).status_code == 201

    def after(change: Any, expected: list[str], status: int = 200) -> AuthApi:
        """Run one change over a live session: it must be revoked; returns a fresh one."""
        old = sign_in(env, cand.email)
        response = change()
        assert response.status_code == status, response.text
        assert scopes_of(env.session, cand.id) == expected
        assert live_sessions(env.session, cand.id) == 0
        assert old.get("/auth/me").status_code == 401
        return sign_in(env, cand.email)

    # add grocery beside food
    fresh = after(lambda: put_scopes(admin, cand.id, [FOOD, GROCERY]), ["food", "grocery"])
    assert (fresh.get(GROCERY_GUARD).status_code, fresh.get(ADMIN_LISTINGS).status_code) == (
        200,
        200,
    )
    # keep only grocery: listing authority goes
    fresh = after(lambda: put_scopes(admin, cand.id, [GROCERY]), ["grocery"])
    assert (fresh.get(GROCERY_GUARD).status_code, fresh.get(ADMIN_LISTINGS).status_code) == (
        200,
        403,
    )
    # an identical set changes nothing: no revocation and no audit row
    unchanged = snapshot(env.session, cand.id)
    assert put_scopes(admin, cand.id, [GROCERY, GROCERY]).status_code == 200
    assert snapshot(env.session, cand.id) == unchanged
    # pause
    fresh = after(lambda: pause(admin, cand.id), [])
    assert fresh.get(GROCERY_GUARD).status_code == 403
    assert fresh.me().json()["data"]["staffScopes"] == []
    # resume with grocery
    fresh = after(lambda: resume(admin, cand.id, [GROCERY]), ["grocery"])
    assert fresh.get(GROCERY_GUARD).status_code == 200
    # replace grocery with a listing scope: Grocery authority goes
    fresh = after(lambda: put_scopes(admin, cand.id, [DIRECTORY]), ["directory"])
    assert fresh.get(GROCERY_GUARD).status_code == 403
    # grant it again, then remove the Moderator
    after(lambda: put_scopes(admin, cand.id, [DIRECTORY, GROCERY]), ["directory", "grocery"])
    fresh = after(lambda: remove(admin, cand.id), [], status=204)
    assert roles_of(env.session, cand.id) == set()
    assert fresh.get(GROCERY_GUARD).status_code == 403
    assert revoke_reasons(env.session, cand.id) == {"role_change"}

    # the audit tells the whole story and keeps it after the role is gone
    history = grocery_events(env, cand.id)
    assert sorted(action for action, _, _ in history) == sorted(
        [
            "moderator_appointed",
            "scope_granted",  # + grocery
            "scope_revoked",  # - food
            "moderator_paused",
            "scope_granted",  # resume
            "scope_granted",  # grocery -> directory (one event each way)
            "scope_revoked",
            "scope_granted",  # + grocery again
            "moderator_removed",
        ]
    )
    assert ("scope_granted", ["food"], ["food", "grocery"]) in history
    assert ("scope_revoked", ["food", "grocery"], ["grocery"]) in history
    assert ("moderator_paused", ["grocery"], []) in history
    assert ("moderator_removed", ["directory", "grocery"], []) in history
    served = admin.get(f"{AUDIT}?target={cand.id}&limit=50").json()["data"]
    assert len(served) == len(history)


def test_grocery_changes_never_touch_anyone_else(env: AuthEnv) -> None:
    admin = super_admin(env)
    others = {
        scope.value: make_account(
            env.session, f"other-{scope.value}@example.org", moderator_scopes=[scope]
        ).id
        for scope in [*LISTING_SCOPES, NEWS]
    }
    paused = make_account(env.session, "other-paused@example.org", moderator_scopes=[]).id
    sessions = {name: sign_in(env, f"other-{name}@example.org") for name in others}
    cand = candidate(env, "only-target@example.org")

    assert appoint(admin, cand.email, [GROCERY]).status_code == 201

    assert {name: scopes_of(env.session, i) for name, i in others.items()} == {
        name: [name] for name in others
    }
    assert scopes_of(env.session, paused) == []
    holders = env.session.scalars(
        select(StaffScopeAssignment.user_id).where(StaffScopeAssignment.scope == StaffScope.GROCERY)
    ).all()
    assert holders == [cand.id]  # exactly the explicit appointment
    assert all(api.get("/auth/me").status_code == 200 for api in sessions.values())


@pytest.mark.parametrize(
    ("scopes", "code"),
    [(["grocery", "news"], "invalid_staff_scope"), (["groceries"], None), (["Grocery"], None)],
    ids=["with-news", "unknown", "wrong-case"],
)
def test_an_invalid_set_with_grocery_is_refused_atomically(
    env: AuthEnv, scopes: list[str], code: str | None
) -> None:
    admin = super_admin(env)
    cand = candidate(env, "invalid@example.org")
    before = snapshot(env.session, cand.id)

    response = appoint(admin, cand.email, scopes)

    assert response.status_code == 422
    if code:
        assert detail_code(response) == code
    assert snapshot(env.session, cand.id) == before


def test_a_grocery_moderator_cannot_manage_staff_or_widen_themselves(env: AuthEnv) -> None:
    grocery = actor(env, moderator_scopes=[GROCERY])
    me = grocery.me().json()["data"]
    me_id = uuid.UUID(me["id"])
    before = snapshot(env.session, me_id)

    assert answer(put_scopes(grocery, me_id, [GROCERY, SERVICES])) == NO
    assert answer(appoint(grocery, "someone@example.org", [GROCERY])) == NO
    assert snapshot(env.session, me_id) == before


# -- no listing taxonomy comes with it -------------------------------------------------------------


def test_grocery_is_not_a_category_module_anywhere(env: AuthEnv) -> None:
    admin = super_admin(env)
    categories = env.session.scalars(select(Category.id)).all()
    assert "grocery" not in {module.value for module in CategoryModule}
    assert {seed.module for seed in REFERENCE_CATEGORIES} <= set(CategoryModule)
    # The directory's own, older ``grocery`` BUSINESS category is unrelated and unchanged.
    assert [(s.module, s.name) for s in REFERENCE_CATEGORIES if s.slug == "grocery"] == [
        (CategoryModule.DIRECTORY, "Grocery")
    ]

    assert (
        admin.request(
            "POST", ADMIN_CATEGORIES, json={"module": "grocery", "name": "Vegetables"}
        ).status_code
        == 422
    )
    assert admin.get(f"{ADMIN_CATEGORIES}?module=grocery").status_code == 422
    assert env.client().get("/categories?module=grocery").status_code == 422
    assert appoint(admin, candidate(env, "no-cats@example.org").email, [GROCERY]).status_code == 201

    assert env.session.scalars(select(Category.id)).all() == categories


def test_a_grocery_moderator_cannot_touch_the_directorys_grocery_businesses(env: AuthEnv) -> None:
    """Same word, unrelated things: a Business in the Directory's ``grocery`` category is a
    ``directory`` listing."""
    owner = signed_in(env, "shop-owner@example.org")
    listing = pending(owner, business_body(name="Corner Grocery Shop", category="grocery"))
    grocery = actor(env, moderator_scopes=[GROCERY])
    directory = actor(env, moderator_scopes=[DIRECTORY])

    assert answer(grocery.get(f"{ADMIN_LISTINGS}/{listing}")) == NO
    assert directory.get(f"{ADMIN_LISTINGS}/{listing}").status_code == 200


# -- concurrency: committed rows, separate connections ----------------------------------------------


@pytest.fixture
def committed(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_staff_audit(db_engine), committed_world(db_engine) as world_env:
        yield world_env


def lock_grocery_authority(session: Session, actor_id: uuid.UUID) -> tuple[set[RoleName], bool]:
    """The reads, in order, that a Grocery write must make inside its transaction."""
    repository = StaffAuthorityRepository(session)
    repository.share_user(actor_id)
    roles = set(repository.share_staff_roles(actor_id))
    return roles, repository.share_moderator_scope(actor_id, GROCERY_SCOPE)


class Change:
    """One real staff-management change on its own thread and session."""

    def __init__(self, engine: Engine, operation: str, actor_id: uuid.UUID, target: User) -> None:
        self.error: BaseException | None = None
        self.done = threading.Event()
        with Session(engine, expire_on_commit=False) as setup:
            self._acting = live_session(setup, actor_id)
        self._thread = threading.Thread(
            target=self._run, args=(engine, operation, actor_id, target.id), daemon=True
        )
        self._thread.start()

    def _run(self, engine: Engine, operation: str, actor_id: uuid.UUID, target: uuid.UUID) -> None:
        try:
            with Session(engine, expire_on_commit=False) as session:
                service = StaffAuthorityService(session, FakeClock(), policy())
                if operation == "replace":
                    service.replace_scopes(actor_id, target, [FOOD], session_id=self._acting)
                elif operation == "pause":
                    service.pause_moderator(actor_id, target, session_id=self._acting)
                else:
                    service.remove_moderator(actor_id, target, session_id=self._acting)
        except BaseException as error:
            self.error = error
        finally:
            self.done.set()

    def finish(self) -> None:
        self._thread.join(TIMEOUT)
        assert not self._thread.is_alive(), "the staff change never finished (deadlock?)"
        assert self.error is None, repr(self.error)


def grocery_pair(env: AuthEnv) -> tuple[User, User]:
    admin = make_account(env.session, "sa@example.org", admin=True)
    worker = make_account(env.session, "worker@example.org", moderator_scopes=[GROCERY])
    return admin, worker


@pytest.mark.parametrize("operation", ["replace", "pause", "remove"])
def test_a_staff_change_waits_for_a_writer_that_holds_grocery_authority(
    db_engine: Engine, committed: AuthEnv, operation: str
) -> None:
    admin, worker = grocery_pair(committed)
    with Session(db_engine) as writer:
        assert lock_grocery_authority(writer, worker.id) == ({RoleName.MODERATOR}, True)

        change = Change(db_engine, operation, admin.id, worker)
        wait_until(lambda: waiting_on_a_lock(db_engine, "%FOR UPDATE%"), "the change to queue")
        assert not change.done.is_set()
        writer.commit()
    change.finish()

    with Session(db_engine) as later:
        assert lock_grocery_authority(later, worker.id)[1] is False


def test_the_grocery_scope_row_itself_is_locked_until_the_writer_commits(
    db_engine: Engine, committed: AuthEnv
) -> None:
    _, worker = grocery_pair(committed)
    with Session(db_engine) as writer:
        assert lock_grocery_authority(writer, worker.id)[1] is True

        revoker = Revoker(
            db_engine,
            [
                "DELETE FROM staff_scope_assignments WHERE scope = 'grocery' "
                "AND user_id = (SELECT id FROM users WHERE email = :e)"
            ],
            worker.email,
        )
        wait_until(
            lambda: waiting_on_a_lock(db_engine, "DELETE FROM staff_scope_assignments%"),
            "the revoke to queue behind the scope row",
        )
        assert not revoker.done.is_set()
        writer.commit()
    revoker.finish()


def test_a_writer_that_waits_for_a_revocation_sees_that_it_lost(
    db_engine: Engine, committed: AuthEnv
) -> None:
    _, worker = grocery_pair(committed)
    outcome: list[bool] = []

    def late_writer() -> None:
        with Session(db_engine) as session:
            outcome.append(lock_grocery_authority(session, worker.id)[1])
            session.commit()

    with db_engine.connect() as revocation:
        revocation.execute(
            text("DELETE FROM staff_scope_assignments WHERE user_id = :u"), {"u": worker.id}
        )  # not committed yet
        thread = threading.Thread(target=late_writer, daemon=True)
        thread.start()
        wait_until(
            lambda: waiting_on_a_lock(db_engine, "%staff_scope_assignments%FOR SHARE%"),
            "the writer to queue behind the revocation",
        )
        assert outcome == []
        revocation.commit()
    thread.join(TIMEOUT)

    assert outcome == [False]


@pytest.mark.parametrize("first", ["decision", "swap"])
def test_swapping_a_listing_scope_for_grocery_races_a_moderation_decision_safely(
    db_engine: Engine, committed: AuthEnv, monkeypatch: pytest.MonkeyPatch, first: str
) -> None:
    """``food`` is replaced with ``grocery`` while that Moderator approves a Food listing. Either
    the decision holds its authority first and wins, or the swap commits first and the decision is
    refused — holding ``grocery`` never lets it through. The swap also revokes the Moderator's
    sessions, so the refusal is ``401`` (it was ``404`` before decisions re-checked the session,
    AUTH_RBAC.md §36; a scope removed WITHOUT a revocation is still ``404``)."""
    owner = signed_in(committed, "owner-race@example.org")
    listing = owner.request("POST", "/listings", json=food_body(name="Race Cafe")).json()["data"][
        "id"
    ]
    admin = make_account(committed.session, "sa-race@example.org", admin=True)
    acting = live_session(committed.session, admin.id)
    worker = make_account(committed.session, "swap@example.org", moderator_scopes=[FOOD])
    api = committed.client()
    assert api.login(worker.email).status_code == 200
    # "decision": pause AFTER it holds the scope lock. "swap": pause BEFORE it reads any authority.
    method = "share_moderator_scope" if first == "decision" else "share_user"
    gate = gate_at(monkeypatch, method, after=first == "decision")
    decision = Decision(api, listing)
    gate.wait_arrived()

    errors: list[BaseException] = []
    swapped = threading.Event()

    def swap() -> None:
        try:
            with Session(db_engine, expire_on_commit=False) as session:
                StaffAuthorityService(session, FakeClock(), policy()).replace_scopes(
                    admin.id, worker.id, [GROCERY], session_id=acting
                )
        except BaseException as error:
            errors.append(error)
        finally:
            swapped.set()

    thread = threading.Thread(target=swap, daemon=True)
    thread.start()
    if first == "decision":
        wait_until(lambda: waiting_on_a_lock(db_engine, "%FOR UPDATE%"), "the swap to queue")
        assert not swapped.is_set()
    else:
        assert swapped.wait(TIMEOUT), "the swap should not have to wait"
    gate.release.set()
    response = decision.finish()
    thread.join(TIMEOUT)

    assert not errors, errors
    assert response.status_code == (200 if first == "decision" else 401), response.text
    if first == "swap":
        assert response.json()["error"]["code"] == "session_expired"
    with Session(db_engine) as check:
        stored = check.execute(
            text("SELECT status FROM listings WHERE id = :i"), {"i": uuid.UUID(listing)}
        ).scalar_one()
    expected = ListingStatus.APPROVED if first == "decision" else ListingStatus.PENDING
    assert stored == expected.value
    assert api.get("/auth/me").status_code == 401  # the old session is revoked either way
