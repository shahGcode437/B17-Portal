"""The authorization dependencies, exercised through a TEST-ONLY router (nothing like it ships).

Matrix: {anonymous, unverified resident, verified resident, professional, unverified professional,
admin, stale admin} x {optional, current, verified, professional, admin}. Also: Resident has no
role row, Professional is a profile (not a role), nobody can grant themselves Admin, and the
production OpenAPI exposes only the intended routes.
"""

import uuid

import pytest
from fastapi import APIRouter
from sqlalchemy import select, text

from app.dependencies.auth import (
    AdminUser,
    CurrentUser,
    OptionalUser,
    ProfessionalUser,
    VerifiedUser,
)
from app.models import UserRole
from app.models.enums import PlanCode
from tests.db.auth_helpers import PASSWORD, AuthEnv, make_account

probe = APIRouter(prefix="/_probe")


@probe.get("/optional")
def optional_probe(user: OptionalUser) -> dict[str, str | None]:
    return {"user": str(user.user_id) if user else None}


@probe.get("/current")
def current_probe(user: CurrentUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@probe.get("/verified")
def verified_probe(user: VerifiedUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@probe.get("/professional")
def professional_probe(user: ProfessionalUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@probe.get("/admin")
def admin_probe(user: AdminUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@probe.post("/mutate")
def mutate_probe(user: CurrentUser) -> dict[str, str]:
    return {"user": str(user.user_id)}


@pytest.fixture
def env(auth_env: AuthEnv) -> AuthEnv:
    auth_env.app.include_router(probe, prefix="/api/v1")
    return auth_env


def as_actor(env: AuthEnv, actor: str):  # type: ignore[no-untyped-def]
    """A browser signed in as the named kind of account (or anonymous)."""
    api = env.client()
    accounts: dict[str, dict[str, object]] = {
        "unverified": {"verified": False},
        "resident": {},
        "professional": {"professional": PlanCode.FREE},
        "unverified_professional": {"verified": False, "professional": PlanCode.FREE},
        "admin": {"admin": True},
        "admin_professional": {"admin": True, "professional": PlanCode.PREMIUM},
    }
    if actor != "anonymous":
        email = f"{actor}-{uuid.uuid4().hex[:8]}@example.org"  # several actors per test
        make_account(env.session, email, **accounts[actor])  # type: ignore[arg-type]
        assert api.login(email=email).status_code == 200
    return api


# (actor, optional, current, verified, professional, admin) expected status codes
MATRIX = [
    ("anonymous", 200, 401, 401, 401, 401),
    ("unverified", 200, 200, 403, 403, 403),
    ("resident", 200, 200, 200, 403, 403),
    ("professional", 200, 200, 200, 200, 403),
    ("unverified_professional", 200, 200, 403, 403, 403),
    ("admin", 200, 200, 200, 403, 200),
    ("admin_professional", 200, 200, 200, 200, 200),
]
GUARDS = ["optional", "current", "verified", "professional", "admin"]


@pytest.mark.parametrize(("actor", "expected"), [(row[0], row[1:]) for row in MATRIX])
def test_authorization_matrix(env: AuthEnv, actor: str, expected: tuple[int, ...]) -> None:
    api = as_actor(env, actor)

    statuses = tuple(api.get(f"/_probe/{guard}").status_code for guard in GUARDS)

    assert statuses == expected


def test_denial_reasons_use_the_documented_codes(env: AuthEnv) -> None:
    anonymous = as_actor(env, "anonymous").get("/_probe/current")
    unverified = as_actor(env, "unverified").get("/_probe/verified")
    resident = as_actor(env, "resident").get("/_probe/professional")
    not_admin = as_actor(env, "resident").get("/_probe/admin")

    assert (anonymous.status_code, anonymous.json()["error"]["code"]) == (401, "unauthenticated")
    assert (unverified.status_code, unverified.json()["error"]["code"]) == (
        403,
        "email_not_verified",
    )
    assert (resident.status_code, resident.json()["error"]["code"]) == (403, "forbidden")
    assert (not_admin.status_code, not_admin.json()["error"]["code"]) == (403, "forbidden")


def test_the_optional_dependency_never_raises_and_clears_a_dead_cookie(env: AuthEnv) -> None:
    api = as_actor(env, "resident")
    token = api.session_cookie
    api.logout()

    response = api.get("/_probe/optional", headers={"Cookie": f"{api.cookie_name}={token}"})

    assert response.status_code == 200 and response.json() == {"user": None}
    assert "max-age=0" in response.headers["set-cookie"].lower()


def test_non_auth_mutations_are_csrf_protected_too(env: AuthEnv) -> None:
    api = as_actor(env, "resident")

    assert api.post("/_probe/mutate").status_code == 200
    assert api.post("/_probe/mutate", csrf=None).status_code == 403
    assert api.post("/_probe/mutate", origin=None).status_code == 403


# -- admin recency -----------------------------------------------------------------------------------------


def test_an_admin_session_must_have_been_used_within_two_hours(env: AuthEnv) -> None:
    api = as_actor(env, "admin")
    assert api.get("/_probe/admin").status_code == 200

    env.clock.advance(hours=1, minutes=59)
    assert api.get("/_probe/admin").status_code == 200  # still fresh (and refreshed by this use)

    env.clock.advance(hours=2, minutes=1)
    stale = api.get("/_probe/admin")

    assert stale.status_code == 401 and stale.json()["error"]["code"] == "session_expired"
    # the refused request must not have counted as activity: a retry is refused as well
    assert api.get("/_probe/admin").status_code == 401
    # ...but the same session still works for ordinary (non-admin) use
    assert api.get("/_probe/current").status_code == 200
    # and a fresh sign-in restores admin access
    again = env.client()
    again.login(email=api.me().json()["data"]["email"])
    assert again.get("/_probe/admin").status_code == 200


def test_ordinary_activity_keeps_an_admin_session_fresh(env: AuthEnv) -> None:
    api = as_actor(env, "admin")
    for _ in range(4):
        env.clock.advance(hours=1, minutes=30)
        assert api.get("/_probe/current").status_code == 200  # resident-style use

    assert api.get("/_probe/admin").status_code == 200  # 6h in, last used a moment ago


def test_an_admin_session_older_than_twelve_hours_is_refused(env: AuthEnv) -> None:
    api = as_actor(env, "admin")
    for _ in range(8):  # stay active every 1.5h for 12h
        env.clock.advance(hours=1, minutes=30)
        assert api.get("/_probe/current").status_code == 200

    env.clock.advance(minutes=1)
    response = api.get("/_probe/admin")  # just over 12h since the session was created

    assert response.status_code == 401 and response.json()["error"]["code"] == "session_expired"
    assert api.get("/_probe/current").status_code == 200


def test_admin_rights_are_read_live_not_cached_in_the_session(env: AuthEnv) -> None:
    api = as_actor(env, "admin")
    assert api.get("/_probe/admin").status_code == 200
    env.session.execute(text("DELETE FROM user_roles"))
    env.session.commit()

    assert api.get("/_probe/admin").status_code == 403


# -- roles ------------------------------------------------------------------------------------------------------


def test_a_resident_has_no_role_row_and_a_professional_is_a_profile(env: AuthEnv) -> None:
    resident = as_actor(env, "resident")
    professional = as_actor(env, "professional")

    assert env.session.scalars(select(UserRole)).all() == []  # nobody is "resident" by a row
    assert resident.me().json()["data"]["roles"] == []
    data = professional.me().json()["data"]
    assert data["roles"] == [] and data["professional"] == {"planCode": "free"}


@pytest.mark.parametrize("field", ["role", "roles", "admin", "isAdmin", "professional", "planCode"])
def test_a_client_cannot_assign_itself_a_role_at_registration(env: AuthEnv, field: str) -> None:
    body = {
        "email": "x@example.org",
        "password": PASSWORD,
        "displayName": "Mallory",
        field: "admin",
    }

    response = env.client().post("/auth/register", body)

    assert response.status_code == 422
    assert env.session.scalars(select(UserRole)).all() == []


def test_the_production_api_has_no_role_or_probe_routes(auth_env: AuthEnv) -> None:
    paths = list(auth_env.app.openapi()["paths"])

    assert not any("role" in p or "admin" in p or "_probe" in p for p in paths)
    assert [p for p in paths if "/auth/" in p] == [
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/auth/logout",
        "/api/v1/auth/logout-all",
        "/api/v1/auth/verify-email",
        "/api/v1/auth/resend-verification",
        "/api/v1/auth/forgot-password",
        "/api/v1/auth/reset-password",
        "/api/v1/auth/change-password",
    ]
    assert not any("oauth" in p or "refresh" in p or "google" in p for p in paths)
