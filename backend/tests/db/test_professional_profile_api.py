"""PUT /users/me/professional-profile (Phase 12D): the idempotent, server-owned capability.

Professional is a PROFILE ROW, not a role: creating it grants no Admin power, writes no role row and
lets no client choose a plan. Real PostgreSQL, the real app, real login.
"""

import pytest
from sqlalchemy import func, select, text

from app.models import ProfessionalProfile, UserRole
from app.models.enums import PlanCode
from tests.db.auth_helpers import AuthEnv, make_account
from tests.db.write_helpers import PROFILE, codes, error_code, signed_in


def profile_rows(env: AuthEnv) -> list[ProfessionalProfile]:
    env.session.expire_all()
    return list(env.session.scalars(select(ProfessionalProfile)))


def test_a_verified_user_creates_the_profile_then_the_same_call_confirms_it(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env, professional=None)

    first = api.request("PUT", PROFILE, json={})
    second = api.request("PUT", PROFILE, json={})

    assert (first.status_code, second.status_code) == (201, 200)
    for response in (first, second):
        data = response.json()["data"]
        assert data["professional"] == {"planCode": "free"}
        assert data["roles"] == []  # a capability, not a role
        assert data["emailVerified"] is True
        assert data["csrfToken"] and data["session"]["expiresAt"]
        assert response.headers["Cache-Control"] == "no-store"
    assert len(profile_rows(auth_env)) == 1


def test_the_body_may_be_omitted(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)

    created = api.request("PUT", PROFILE)
    again = api.request("PUT", PROFILE)

    assert (created.status_code, again.status_code) == (201, 200)


def test_auth_me_reflects_the_profile_after_the_call(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)
    assert "professional" not in api.me().json()["data"]

    api.request("PUT", PROFILE, json={})

    assert api.me().json()["data"]["professional"] == {"planCode": "free"}


def test_creating_the_profile_grants_no_role_and_no_admin_power(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)

    api.request("PUT", PROFILE, json={})

    assert auth_env.session.scalar(select(func.count()).select_from(UserRole)) == 0
    assert api.get("/auth/me").json()["data"]["roles"] == []


def test_an_admin_keeps_exactly_their_roles(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None, admin=True)

    created = api.request("PUT", PROFILE, json={})

    assert created.status_code == 201
    assert created.json()["data"]["roles"] == ["admin"]
    assert created.json()["data"]["professional"] == {"planCode": "free"}


def test_an_existing_premium_profile_is_confirmed_not_downgraded(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=PlanCode.PREMIUM)

    response = api.request("PUT", PROFILE, json={})

    assert response.status_code == 200
    assert response.json()["data"]["professional"] == {"planCode": "premium"}
    assert profile_rows(auth_env)[0].plan_code is PlanCode.PREMIUM


def test_anonymous_is_unauthenticated(auth_env: AuthEnv) -> None:
    response = auth_env.client().request("PUT", PROFILE, json={})

    assert (response.status_code, error_code(response)) == (401, "unauthenticated")
    assert profile_rows(auth_env) == []


def test_an_unverified_user_cannot_create_it_and_stays_signed_in(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None, verified=False)

    response = api.request("PUT", PROFILE, json={})

    assert (response.status_code, error_code(response)) == (403, "email_not_verified")
    assert profile_rows(auth_env) == []
    assert api.me().status_code == 200  # no forced logout


@pytest.mark.parametrize(
    "field",
    [
        "planCode",
        "plan",
        "userId",
        "ownerId",
        "roles",
        "admin",
        "emailVerified",
        "status",
        "premium",
    ],
)
def test_no_privileged_field_is_accepted(auth_env: AuthEnv, field: str) -> None:
    api = signed_in(auth_env, professional=None)

    response = api.request("PUT", PROFILE, json={field: "premium"})

    assert response.status_code == 422
    assert (field, "not_allowed") in codes(response)
    assert profile_rows(auth_env) == []


def test_a_plan_cannot_be_chosen_even_when_the_profile_already_exists(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)

    response = api.request("PUT", PROFILE, json={"planCode": "premium"})

    assert response.status_code == 422
    assert profile_rows(auth_env)[0].plan_code is PlanCode.FREE


def test_origin_and_csrf_protect_the_write(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)

    no_origin = api.request("PUT", PROFILE, json={}, origin=None)
    bad_origin = api.request("PUT", PROFILE, json={}, origin="https://evil.example.org")
    no_token = api.request("PUT", PROFILE, json={}, csrf=None)
    wrong_token = api.request("PUT", PROFILE, json={}, csrf="not-the-token")

    for response in (no_origin, bad_origin, no_token, wrong_token):
        assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert profile_rows(auth_env) == []
    assert api.request("PUT", PROFILE, json={}).status_code == 201  # valid Origin + CSRF succeeds


def test_other_methods_are_not_offered(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)

    for method in ("POST", "PATCH", "DELETE"):
        response = api.request(method, PROFILE, json={})
        assert response.status_code == 405, method
    assert api.get(PROFILE).status_code == 405


def test_a_suspended_account_has_no_session_to_write_with(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)
    auth_env.session.execute(text("UPDATE users SET status = 'suspended'"))
    auth_env.session.commit()

    response = api.request("PUT", PROFILE, json={})

    assert response.status_code == 401
    assert profile_rows(auth_env) == []


def test_two_users_have_two_profiles(auth_env: AuthEnv) -> None:
    first = signed_in(auth_env, "one@example.org", professional=None, display_name="One")
    second = signed_in(auth_env, "two@example.org", professional=None, display_name="Two")

    first.request("PUT", PROFILE, json={})
    second.request("PUT", PROFILE, json={})

    assert len(profile_rows(auth_env)) == 2


def test_the_existing_helper_still_builds_a_professional(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session, "someone@example.org", professional=PlanCode.FREE)
    api = auth_env.client()
    api.login("someone@example.org")

    assert api.me().json()["data"]["professional"] == {"planCode": "free"}
    assert user.id is not None
