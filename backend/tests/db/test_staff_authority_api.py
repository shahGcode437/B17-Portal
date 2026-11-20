"""RBAC-A authority primitives through the real app (docs/backend/AUTH_RBAC.md §27.2, §27.4, §27.7).

``require_super_admin`` and ``require_staff`` are exercised through a TEST-ONLY router (nothing like
it ships). The point of RBAC-A is what it must NOT change: no current ``/admin/*`` route accepts a
Moderator, the existing ``require_admin`` callers behave exactly as before, authority is read live
from the database on every request, and nothing a client sends can create a scope.
"""

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi import APIRouter
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from sqlalchemy import select, text

from app.api.v1 import admin as admin_routes
from app.api.v1 import auth as auth_routes
from app.api.v1 import (
    categories,
    health,
    listings,
    news,
    owner_listings,
    requests,
    saved,
    search,
    users,
)
from app.dependencies.auth import (
    AdminUser,
    CurrentUser,
    StaffUser,
    SuperAdminUser,
    require_admin,
    require_staff,
    require_super_admin,
)
from app.models import StaffScopeAssignment, UserRole
from app.models.enums import CategoryModule, PlanCode
from tests.db.auth_helpers import OTHER_PASSWORD, PASSWORD, AuthApi, AuthEnv, make_account

probe = APIRouter(prefix="/_probe")


@probe.get("/super-admin")
def super_admin_probe(user: SuperAdminUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@probe.get("/staff")
def staff_probe(user: StaffUser) -> dict[str, Any]:
    return {"user": str(user.user_id), "scopes": sorted(user.staff_scopes)}


@probe.get("/admin")
def admin_probe(user: AdminUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@probe.get("/current")
def current_probe(user: CurrentUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


GUARDS = ["super-admin", "staff", "admin"]
FOOD, DIRECTORY, NEWS = CategoryModule.FOOD, CategoryModule.DIRECTORY, CategoryModule.NEWS
ALL_SCOPES = [
    CategoryModule.SERVICES,
    CategoryModule.DIRECTORY,
    CategoryModule.FOOD,
    CategoryModule.EDUCATION,
    CategoryModule.PROPERTY,
]

ACCOUNTS: dict[str, dict[str, Any]] = {
    "unverified": {"verified": False},
    "resident": {},
    "professional": {"professional": PlanCode.FREE},
    "admin": {"admin": True},
    "admin_professional": {"admin": True, "professional": PlanCode.PREMIUM},
    "unverified_admin": {"admin": True, "verified": False},
    "moderator_one": {"moderator_scopes": [FOOD]},
    "moderator_all": {"moderator_scopes": ALL_SCOPES},
    "moderator_professional": {"moderator_scopes": [FOOD], "professional": PlanCode.FREE},
    "moderator_zero": {"moderator_scopes": []},
    "moderator_news_only": {"moderator_scopes": [NEWS]},
    "unverified_moderator": {"moderator_scopes": [FOOD], "verified": False},
}


@pytest.fixture
def env(auth_env: AuthEnv) -> AuthEnv:
    auth_env.app.include_router(probe, prefix="/api/v1")
    return auth_env


def as_actor(env: AuthEnv, actor: str) -> AuthApi:
    api = env.client()
    if actor != "anonymous":
        email = f"{actor}-{uuid.uuid4().hex[:8]}@example.org"
        make_account(env.session, email, **ACCOUNTS[actor])
        assert api.login(email=email).status_code == 200
    return api


# (actor, super-admin, staff, admin-alias)
MATRIX = [
    ("anonymous", 401, 401, 401),
    ("unverified", 403, 403, 403),
    ("resident", 403, 403, 403),
    ("professional", 403, 403, 403),
    ("admin", 200, 200, 200),
    ("admin_professional", 200, 200, 200),
    ("unverified_admin", 403, 403, 403),
    # a Moderator with scopes is staff and nothing more: never a Super Admin, never a current admin
    ("moderator_one", 403, 200, 403),
    ("moderator_all", 403, 200, 403),
    ("moderator_professional", 403, 200, 403),
    # a Moderator with zero scopes — or holding only the reserved ``news`` scope — has NO authority
    ("moderator_zero", 403, 403, 403),
    ("moderator_news_only", 403, 403, 403),
    ("unverified_moderator", 403, 403, 403),
]


@pytest.mark.parametrize(("actor", "expected"), [(row[0], row[1:]) for row in MATRIX])
def test_authority_matrix(env: AuthEnv, actor: str, expected: tuple[int, ...]) -> None:
    api = as_actor(env, actor)

    statuses = tuple(api.get(f"/_probe/{guard}").status_code for guard in GUARDS)

    assert statuses == expected


def test_denial_reasons_use_the_documented_codes(env: AuthEnv) -> None:
    anonymous = as_actor(env, "anonymous").get("/_probe/staff")
    unverified = as_actor(env, "unverified_moderator").get("/_probe/staff")
    zero = as_actor(env, "moderator_zero").get("/_probe/staff")
    moderator = as_actor(env, "moderator_one").get("/_probe/super-admin")

    assert (anonymous.status_code, anonymous.json()["error"]["code"]) == (401, "unauthenticated")
    assert (unverified.status_code, unverified.json()["error"]["code"]) == (
        403,
        "email_not_verified",
    )
    assert (zero.status_code, zero.json()["error"]["code"]) == (403, "forbidden")
    assert (moderator.status_code, moderator.json()["error"]["code"]) == (403, "forbidden")


def test_a_moderator_sees_exactly_their_own_effective_scopes(env: AuthEnv) -> None:
    api = as_actor(env, "moderator_all")

    assert api.get("/_probe/staff").json()["scopes"] == sorted(s.value for s in ALL_SCOPES)


def test_a_super_admin_needs_no_scope_rows_and_is_never_given_any(env: AuthEnv) -> None:
    api = as_actor(env, "admin")

    assert api.get("/_probe/staff").json()["scopes"] == []  # authority is the role itself
    assert env.session.scalars(select(StaffScopeAssignment)).all() == []


# -- freshness (the existing strong staff policy, for Moderators too) ------------------------------


@pytest.mark.parametrize("actor", ["admin", "moderator_one"])
def test_a_staff_session_idle_for_over_two_hours_is_refused_and_does_not_count_as_activity(
    env: AuthEnv, actor: str
) -> None:
    api = as_actor(env, actor)
    assert api.get("/_probe/staff").status_code == 200

    env.clock.advance(hours=1, minutes=59)
    assert api.get("/_probe/staff").status_code == 200  # still fresh (and refreshed by this use)
    env.clock.advance(hours=2, minutes=1)
    stale = api.get("/_probe/staff")

    assert stale.status_code == 401 and stale.json()["error"]["code"] == "session_expired"
    assert api.get("/_probe/staff").status_code == 401  # the refused attempt did not refresh it
    assert api.get("/_probe/current").status_code == 200  # ordinary use of the session still works
    again = env.client()
    assert again.login(email=api.me().json()["data"]["email"]).status_code == 200
    assert again.get("/_probe/staff").status_code == 200  # a fresh sign-in restores authority


@pytest.mark.parametrize("actor", ["admin", "moderator_one"])
def test_a_staff_session_older_than_twelve_hours_is_refused_even_in_constant_use(
    env: AuthEnv, actor: str
) -> None:
    api = as_actor(env, actor)
    for _ in range(8):  # stay active every 1.5 h for 12 h
        env.clock.advance(hours=1, minutes=30)
        assert api.get("/_probe/current").status_code == 200

    env.clock.advance(minutes=1)
    response = api.get("/_probe/staff")

    assert response.status_code == 401 and response.json()["error"]["code"] == "session_expired"


# -- authority is read live, from the database, every request -------------------------------------


def delete_sql(env: AuthEnv, sql: str, **params: Any) -> None:
    env.session.execute(text(sql), params)
    env.session.commit()


def test_a_removed_scope_ends_staff_access_on_the_very_next_request(env: AuthEnv) -> None:
    api = as_actor(env, "moderator_one")
    assert api.get("/_probe/staff").status_code == 200

    delete_sql(env, "DELETE FROM staff_scope_assignments")  # the only scope, e.g. a "pause"

    assert api.get("/_probe/staff").status_code == 403  # same session, no re-login needed


def test_a_removed_moderator_role_ends_staff_access_immediately(env: AuthEnv) -> None:
    api = as_actor(env, "moderator_all")
    assert api.get("/_probe/staff").status_code == 200

    delete_sql(env, "DELETE FROM user_roles")  # the role; its scopes cascade away with it

    assert api.get("/_probe/staff").status_code == 403
    assert env.session.scalars(select(StaffScopeAssignment)).all() == []


def test_one_removed_scope_of_two_narrows_the_scopes_immediately(env: AuthEnv) -> None:
    email = f"narrow-{uuid.uuid4().hex[:8]}@example.org"
    make_account(env.session, email, moderator_scopes=[FOOD, DIRECTORY])
    api = env.client()
    assert api.login(email=email).status_code == 200
    assert api.get("/_probe/staff").json()["scopes"] == ["directory", "food"]

    delete_sql(env, "DELETE FROM staff_scope_assignments WHERE scope = 'directory'")

    assert api.get("/_probe/staff").json()["scopes"] == ["food"]


def test_a_removed_super_admin_role_ends_every_admin_route_immediately(env: AuthEnv) -> None:
    api = as_actor(env, "admin")
    assert [api.get(f"/_probe/{g}").status_code for g in GUARDS] == [200, 200, 200]

    delete_sql(env, "DELETE FROM user_roles")

    assert [api.get(f"/_probe/{g}").status_code for g in GUARDS] == [403, 403, 403]


@pytest.mark.parametrize("actor", ["admin", "moderator_one"])
def test_a_suspended_staff_account_loses_its_session_at_once(env: AuthEnv, actor: str) -> None:
    api = as_actor(env, actor)
    assert api.get("/_probe/staff").status_code == 200

    delete_sql(env, "UPDATE users SET status = 'suspended'")

    assert api.get("/_probe/staff").status_code == 401


# -- nothing a client says can create authority -----------------------------------------------------


FORGED = {
    "X-Staff-Scopes": "food,directory",
    "X-Roles": "moderator",
    "X-Staff": "true",
    "X-Role": "admin",
}


def test_forged_headers_and_query_claims_never_create_scopes(env: AuthEnv) -> None:
    api = as_actor(env, "resident")

    staff = api.get("/_probe/staff?staffScopes=food&roles=moderator&scope=food", headers=FORGED)
    me = api.get("/auth/me?staffScopes=food&roles=moderator", headers=FORGED)

    assert staff.status_code == 403
    data = me.json()["data"]
    assert (data["roles"], data["staffScopes"]) == ([], [])


@pytest.mark.parametrize("field", ["staffScopes", "scopes", "roles", "role", "moderator"])
def test_a_client_cannot_assign_itself_staff_authority_at_registration(
    env: AuthEnv, field: str
) -> None:
    body = {
        "email": "x@example.org",
        "password": PASSWORD,
        "displayName": "Mallory",
        field: ["food"],
    }

    response = env.client().post("/auth/register", body)

    assert response.status_code == 422
    assert env.session.scalars(select(UserRole)).all() == []
    assert env.session.scalars(select(StaffScopeAssignment)).all() == []


# -- /auth/me: the additive ``staffScopes`` contract ------------------------------------------------

ME_SCOPES = [
    ("resident", [], []),
    ("professional", [], []),
    ("admin", ["admin"], []),  # a Super Admin: global authority is the role, no "all scopes"
    ("admin_professional", ["admin"], []),
    ("moderator_one", ["moderator"], ["food"]),
    ("moderator_all", ["moderator"], sorted(s.value for s in ALL_SCOPES)),
    ("moderator_zero", ["moderator"], []),
    ("moderator_news_only", ["moderator"], []),  # the reserved scope is stored but confers nothing
]


@pytest.mark.parametrize(("actor", "roles", "scopes"), ME_SCOPES)
def test_auth_me_exposes_the_effective_staff_scopes(
    env: AuthEnv, actor: str, roles: list[str], scopes: list[str]
) -> None:
    data = as_actor(env, actor).me().json()["data"]

    assert data["roles"] == roles
    assert data["staffScopes"] == scopes


def test_a_moderators_scopes_are_sorted_and_the_reserved_one_is_filtered(env: AuthEnv) -> None:
    email = f"mix-{uuid.uuid4().hex[:8]}@example.org"
    make_account(env.session, email, moderator_scopes=[FOOD, NEWS, DIRECTORY])
    api = env.client()

    assert api.login(email=email).json()["data"]["staffScopes"] == ["directory", "food"]
    assert api.me().json()["data"]["staffScopes"] == ["directory", "food"]


def test_auth_me_stays_compatible_with_every_existing_field(env: AuthEnv) -> None:
    data = as_actor(env, "moderator_one").me().json()["data"]

    assert {
        "id",
        "displayName",
        "email",
        "emailVerified",
        "roles",
        "authMethods",
        "session",
        "csrfToken",
    } <= set(data)
    assert data["emailVerified"] is True and data["authMethods"]["password"] is True


def test_login_register_and_change_password_all_carry_staff_scopes(env: AuthEnv) -> None:
    fresh = env.client().register(email="newcomer@example.org")
    assert fresh.status_code == 201 and fresh.json()["data"]["staffScopes"] == []

    email = f"pw-{uuid.uuid4().hex[:8]}@example.org"
    make_account(env.session, email, moderator_scopes=[FOOD])
    api = env.client()
    assert api.login(email=email).json()["data"]["staffScopes"] == ["food"]
    changed = api.post(
        "/auth/change-password", {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD}
    )

    assert changed.status_code == 200
    assert changed.json()["data"]["staffScopes"] == ["food"]  # the rotated principal keeps them


def test_the_openapi_contract_documents_staff_scopes_as_a_closed_list(auth_env: AuthEnv) -> None:
    schema = auth_env.app.openapi()["components"]["schemas"]["AuthUser"]

    assert "staffScopes" in schema["required"]
    items = schema["properties"]["staffScopes"]["items"]
    assert items == {"$ref": "#/components/schemas/CategoryModule"}
    module = auth_env.app.openapi()["components"]["schemas"]["CategoryModule"]
    assert set(module["enum"]) == {m.value for m in CategoryModule}


# -- the current /admin surface was NOT widened -----------------------------------------------------


def _calls(dependant: Dependant) -> set[Callable[..., Any]]:
    found: set[Callable[..., Any]] = set()
    for sub in dependant.dependencies:
        if sub.call is not None:
            found.add(sub.call)
        found |= _calls(sub)
    return found


#: Every production router module. Walked through each module's own (public) ``router.routes``,
#: where router-level dependencies are already merged into each route's dependency tree.
ROUTER_MODULES = [
    health,
    auth_routes,
    categories,
    search,
    listings,
    owner_listings,
    users,
    saved,
    requests,
    admin_routes,
    news,
]


def _routes(module: Any) -> list[APIRoute]:
    return [route for route in module.router.routes if isinstance(route, APIRoute)]


def test_every_current_admin_route_is_still_super_admin_only_and_none_uses_require_staff() -> None:
    admin = _routes(admin_routes)

    assert len(admin) == 8  # queue, detail, approve, reject, categories x4 — nothing new
    for route in admin:
        calls = _calls(route.dependant)
        assert require_super_admin in calls, route.path
        assert require_staff not in calls, route.path


def test_require_admin_is_exactly_the_super_admin_dependency() -> None:
    assert require_admin is require_super_admin  # every existing caller keeps its behaviour


def test_require_staff_is_attached_to_no_production_route(auth_env: AuthEnv) -> None:
    attached = [
        route.path
        for module in ROUTER_MODULES
        for route in _routes(module)
        if require_staff in _calls(route.dependant)
    ]

    assert attached == []
    assert sum(len(_routes(module)) for module in ROUTER_MODULES) > 30  # the walk is not vacuous
    assert not any("staff" in path for path in auth_env.app.openapi()["paths"])
