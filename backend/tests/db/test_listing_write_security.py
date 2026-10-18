"""The write-security matrix for the Phase 12D endpoints (docs/backend/AUTH_RBAC.md §22.6):
every actor × every endpoint, CSRF / Origin on every unsafe method, IDOR and mass assignment.

Each cell uses a FRESH actor and a FRESH target listing, so one cell cannot change another's setup.
"""

from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import text

from app.models.enums import PlanCode
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.test_listing_edit_api import snapshot
from tests.db.write_helpers import (
    LISTINGS,
    MINE,
    PROFILE,
    archive,
    created_id,
    error_code,
    mine,
    patch,
    provider_body,
    signed_in,
)

Actor = Callable[[AuthEnv], AuthApi]

OWNER_EMAIL = "owner@example.org"


def anonymous(env: AuthEnv) -> AuthApi:
    return env.client()


def unverified(env: AuthEnv) -> AuthApi:
    return signed_in(env, "unverified@example.org", verified=False, professional=None)


def unverified_professional(env: AuthEnv) -> AuthApi:
    return signed_in(env, "unverified-pro@example.org", verified=False)


def verified_resident(env: AuthEnv) -> AuthApi:
    return signed_in(env, "resident@example.org", professional=None)


def professional_other(env: AuthEnv) -> AuthApi:
    return signed_in(env, "other-pro@example.org")


def admin_without_profile(env: AuthEnv) -> AuthApi:
    return signed_in(env, "admin@example.org", professional=None, admin=True)


def admin_with_profile(env: AuthEnv) -> AuthApi:
    return signed_in(env, "admin-pro@example.org", admin=True)


def suspended(env: AuthEnv) -> AuthApi:
    api = signed_in(env, "suspended@example.org")
    env.session.execute(
        text("UPDATE users SET status = 'suspended' WHERE email = 'suspended@example.org'")
    )
    env.session.commit()
    return api


def owner_actor(env: AuthEnv) -> AuthApi:
    return env.client()  # replaced in the test: the owner is whoever created the target


# (actor, PUT profile, POST create, PATCH, archive, GET list, GET detail) expected HTTP statuses
MATRIX: list[tuple[str, Actor, tuple[int, ...]]] = [
    ("anonymous", anonymous, (401, 401, 401, 401, 401, 401)),
    ("unverified resident", unverified, (403, 403, 403, 403, 200, 404)),
    ("unverified professional", unverified_professional, (403, 403, 403, 403, 200, 404)),
    ("verified resident", verified_resident, (201, 403, 403, 403, 200, 404)),
    ("professional (other)", professional_other, (200, 201, 404, 404, 200, 404)),
    ("admin, no profile", admin_without_profile, (201, 403, 403, 403, 200, 404)),
    ("admin with profile (not the owner)", admin_with_profile, (200, 201, 404, 404, 200, 404)),
    ("suspended", suspended, (401, 401, 401, 401, 401, 401)),
]


@pytest.mark.parametrize(("label", "actor", "expected"), MATRIX, ids=[m[0] for m in MATRIX])
def test_every_actor_against_every_endpoint(
    auth_env: AuthEnv, label: str, actor: Actor, expected: tuple[int, ...]
) -> None:
    owner = signed_in(auth_env, OWNER_EMAIL, display_name="Own Er")
    target = created_id(owner, provider_body(name="Owner Target Provider"))
    before = snapshot(auth_env, target)
    api = actor(auth_env)

    # The profile PUT runs LAST: it changes what the actor is, so it must not colour the other cells.
    create_status = api.request(
        "POST", LISTINGS, json=provider_body(name="Probe Provider")
    ).status_code
    patch_status = api.request(
        "PATCH", f"{LISTINGS}/{target}", json={"revision": 1, "name": "Probe Rename"}
    ).status_code
    archive_status = api.request(
        "POST", f"{LISTINGS}/{target}/archive", json={"revision": 1}
    ).status_code
    list_status = api.get(MINE).status_code
    detail_status = api.get(f"{MINE}/{target}").status_code
    profile_status = api.request("PUT", PROFILE, json={}).status_code
    results = (
        profile_status,
        create_status,
        patch_status,
        archive_status,
        list_status,
        detail_status,
    )

    assert results == expected, label
    assert snapshot(auth_env, target) == before  # nobody but the owner ever changed it


def test_the_owner_column_of_the_matrix(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, OWNER_EMAIL, display_name="Own Er")
    target = created_id(owner, provider_body())

    results = (
        owner.request("PUT", PROFILE, json={}).status_code,
        owner.request("POST", LISTINGS, json=provider_body()).status_code,
        patch(owner, target, 1, name="Owner Rename").status_code,
        archive(owner, target, 2).status_code,
        owner.get(MINE).status_code,
        owner.get(f"{MINE}/{target}").status_code,
    )

    assert results == (200, 201, 200, 200, 200, 200)


# -- CSRF and Origin on every unsafe method -----------------------------------------------------------


def unsafe_calls(listing_id: str) -> list[tuple[str, str, dict[str, Any]]]:
    return [
        ("PUT", PROFILE, {}),
        ("POST", LISTINGS, provider_body(name="Csrf Probe")),
        ("PATCH", f"{LISTINGS}/{listing_id}", {"revision": 1, "name": "Csrf Rename"}),
        ("POST", f"{LISTINGS}/{listing_id}/archive", {"revision": 1}),
    ]


@pytest.mark.parametrize(
    "tamper",
    [
        {"origin": None},
        {"origin": "https://evil.example.org"},
        {"origin": "null"},
        {"csrf": None},
        {"csrf": "wrong-token"},
        {"csrf": ""},
    ],
    ids=["no-origin", "foreign-origin", "null-origin", "no-csrf", "wrong-csrf", "empty-csrf"],
)
def test_every_unsafe_write_needs_the_exact_origin_and_the_csrf_token(
    auth_env: AuthEnv, tamper: dict[str, Any]
) -> None:
    api = signed_in(auth_env)
    target = created_id(api, provider_body())
    before = snapshot(auth_env, target)

    for method, path, body in unsafe_calls(target):
        response = api.request(method, path, json=body, **tamper)
        assert (response.status_code, error_code(response)) == (403, "csrf_failed"), (method, path)
    assert snapshot(auth_env, target) == before
    assert api.get(MINE).json()["meta"]["total"] == 1  # nothing was created either


def test_valid_origin_and_csrf_succeed_for_every_unsafe_write(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None)
    assert api.request("PUT", PROFILE, json={}).status_code == 201
    target = created_id(api, provider_body())

    assert (
        api.request("POST", LISTINGS, json=provider_body(name="Second Provider")).status_code == 201
    )
    assert patch(api, target, 1, name="Renamed Provider").status_code == 200
    assert archive(api, target, 2).status_code == 200


def test_another_browsers_csrf_token_does_not_work_for_this_session(auth_env: AuthEnv) -> None:
    mine_api = signed_in(auth_env, "a@example.org", display_name="A A")
    theirs = signed_in(auth_env, "b@example.org", display_name="B B")
    target = created_id(mine_api, provider_body())

    response = mine_api.request(
        "PATCH",
        f"{LISTINGS}/{target}",
        json={"revision": 1, "name": "Cross Session"},
        csrf=theirs.csrf,
    )

    assert (response.status_code, error_code(response)) == (403, "csrf_failed")


# -- IDOR ---------------------------------------------------------------------------------------------


def test_one_owner_cannot_read_edit_or_archive_anothers_listing(auth_env: AuthEnv) -> None:
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice")
    bob = signed_in(auth_env, "bob@example.org", display_name="Bo B")
    alices = created_id(alice, provider_body(name="Alice Provider"))
    created_id(bob, provider_body(name="Bob Provider"))
    before = snapshot(auth_env, alices)

    read = bob.get(f"{MINE}/{alices}")
    edit = patch(bob, alices, 1, name="Hijacked by Bob")
    narrow = patch(bob, alices, 1, location={"visibility": "area_only"})
    gone = archive(bob, alices, 1)

    for response in (read, edit, narrow, gone):
        assert (response.status_code, error_code(response)) == (404, "not_found")
    assert snapshot(auth_env, alices) == before
    assert [item["name"] for item in bob.get(MINE).json()["data"]] == ["Bob Provider"]
    assert mine(alice, alices)["name"] == "Alice Provider"


def test_an_owner_id_smuggled_anywhere_is_rejected(auth_env: AuthEnv) -> None:
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice")
    bob = signed_in(auth_env, "bob@example.org", display_name="Bo B")
    bobs_id = bob.me().json()["data"]["id"]
    target = created_id(alice, provider_body())

    for body in (
        {"revision": 1, "ownerId": bobs_id},
        {"revision": 1, "location": {"visibility": "area_only", "ownerId": bobs_id}},
        {"revision": 1, "name": "Mass Assignment", "owner": {"id": bobs_id}},
        {"revision": 1, "name": "Mass Assignment", "user_id": bobs_id},
    ):
        response = alice.request("PATCH", f"{LISTINGS}/{target}", json=body)
        assert response.status_code == 422, body
    assert mine(alice, target)["name"] == "Bright Spark Electricians"
    assert bob.get(MINE).json()["data"] == []


@pytest.mark.parametrize("plan", [PlanCode.FREE, PlanCode.PREMIUM])
def test_a_professional_has_no_admin_power_over_anyone_s_listing(
    auth_env: AuthEnv, plan: PlanCode
) -> None:
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice")
    pro = signed_in(auth_env, "pro@example.org", professional=plan, display_name="Pr O")
    target = created_id(alice, provider_body())

    for path in ("approve", "reject", "feature"):
        response = pro.request("POST", f"{LISTINGS}/{target}/{path}", json={"revision": 1})
        assert response.status_code in (404, 405), path
    assert pro.request("DELETE", f"{LISTINGS}/{target}").status_code == 405
    # Phase 12E: the admin surface exists, and a professional (either plan) is simply not an admin
    assert pro.request("GET", "/admin/listings").status_code == 403


def test_no_write_endpoint_leaks_the_listing_existence_through_timing_free_differences(
    auth_env: AuthEnv,
) -> None:
    """A foreign listing and a missing one produce byte-identical error bodies (modulo request id)."""
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice")
    bob = signed_in(auth_env, "bob@example.org", display_name="Bo B")
    alices = created_id(alice, provider_body())

    def bodies(listing_id: str) -> list[dict[str, Any]]:
        calls = (
            bob.get(f"{MINE}/{listing_id}"),
            patch(bob, listing_id, 1, name="Probe Name"),
            archive(bob, listing_id, 1),
        )
        out = []
        for response in calls:
            error = dict(response.json()["error"])
            error.pop("requestId")
            out.append({"status": response.status_code, **error})
        return out

    assert bodies(alices) == bodies("00000000-0000-4000-8000-000000000000")
