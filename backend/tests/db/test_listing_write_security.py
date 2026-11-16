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
    business_body,
    codes,
    create,
    created_id,
    error_code,
    food_body,
    mine,
    patch,
    property_body,
    provider_body,
    set_status,
    signed_in,
    tutor_body,
)
from app.models.enums import ListingStatus

Actor = Callable[[AuthEnv], AuthApi]

OWNER_EMAIL = "owner@example.org"


def anonymous(env: AuthEnv) -> AuthApi:
    return env.client()


def unverified(env: AuthEnv) -> AuthApi:
    return signed_in(
        env, "unverified@example.org", verified=False, professional=None, admin=False
    )


def unverified_professional(env: AuthEnv) -> AuthApi:
    return signed_in(env, "unverified-pro@example.org", verified=False, admin=False)


def verified_resident(env: AuthEnv) -> AuthApi:
    return signed_in(env, "resident@example.org", professional=None, admin=False)


def professional_other(env: AuthEnv) -> AuthApi:
    return signed_in(env, "other-pro@example.org", admin=False)


def admin_without_profile(env: AuthEnv) -> AuthApi:
    return signed_in(env, "admin@example.org", professional=None, admin=True)


def admin_with_profile(env: AuthEnv) -> AuthApi:
    return signed_in(env, "admin-pro@example.org", admin=True)


def suspended(env: AuthEnv) -> AuthApi:
    api = signed_in(env, "suspended@example.org", admin=False)
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
    owner = signed_in(auth_env, OWNER_EMAIL, display_name="Own Er", admin=False)
    target = created_id(owner, business_body(name="Owner Target Business"))
    before = snapshot(auth_env, target)
    api = actor(auth_env)

    # The profile PUT runs LAST: it changes what the actor is, so it must not colour the other cells.
    create_status = api.request(
        "POST", LISTINGS, json=business_body(name="Probe Business")
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
    owner = signed_in(auth_env, OWNER_EMAIL, display_name="Own Er", admin=False)
    target = created_id(owner, business_body())

    results = (
        owner.request("PUT", PROFILE, json={}).status_code,
        owner.request("POST", LISTINGS, json=business_body(name="Another Business")).status_code,
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
        ("POST", LISTINGS, business_body(name="Csrf Probe")),
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
    api = signed_in(auth_env, admin=False)
    target = created_id(api, business_body())
    before = snapshot(auth_env, target)

    for method, path, body in unsafe_calls(target):
        response = api.request(method, path, json=body, **tamper)
        assert (response.status_code, error_code(response)) == (403, "csrf_failed"), (method, path)
    assert snapshot(auth_env, target) == before
    assert api.get(MINE).json()["meta"]["total"] == 1  # nothing was created either


def test_valid_origin_and_csrf_succeed_for_every_unsafe_write(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, professional=None, admin=False)
    assert api.request("PUT", PROFILE, json={}).status_code == 201
    target = created_id(api, business_body())

    assert (
        api.request("POST", LISTINGS, json=business_body(name="Second Shop")).status_code == 201
    )
    assert patch(api, target, 1, name="Renamed Shop").status_code == 200
    assert archive(api, target, 2).status_code == 200


def test_another_browsers_csrf_token_does_not_work_for_this_session(auth_env: AuthEnv) -> None:
    mine_api = signed_in(auth_env, "a@example.org", display_name="A A", admin=False)
    theirs = signed_in(auth_env, "b@example.org", display_name="B B", admin=False)
    target = created_id(mine_api, business_body())

    response = mine_api.request(
        "PATCH",
        f"{LISTINGS}/{target}",
        json={"revision": 1, "name": "Cross Session"},
        csrf=theirs.csrf,
    )

    assert (response.status_code, error_code(response)) == (403, "csrf_failed")


# -- IDOR ---------------------------------------------------------------------------------------------


def test_one_owner_cannot_read_edit_or_archive_anothers_listing(auth_env: AuthEnv) -> None:
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice", admin=False)
    bob = signed_in(auth_env, "bob@example.org", display_name="Bo B", admin=False)
    alices = created_id(alice, business_body(name="Alice Shop"))
    created_id(bob, business_body(name="Bob Shop"))
    before = snapshot(auth_env, alices)

    read = bob.get(f"{MINE}/{alices}")
    edit = patch(bob, alices, 1, name="Hijacked by Bob")
    narrow = patch(bob, alices, 1, location={"visibility": "area_only"})
    gone = archive(bob, alices, 1)

    for response in (read, edit, narrow, gone):
        assert (response.status_code, error_code(response)) == (404, "not_found")
    assert snapshot(auth_env, alices) == before
    assert [item["name"] for item in bob.get(MINE).json()["data"]] == ["Bob Shop"]
    assert mine(alice, alices)["name"] == "Alice Shop"


def test_an_owner_id_smuggled_anywhere_is_rejected(auth_env: AuthEnv) -> None:
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice", admin=False)
    bob = signed_in(auth_env, "bob@example.org", display_name="Bo B", admin=False)
    bobs_id = bob.me().json()["data"]["id"]
    target = created_id(alice, business_body())

    for body in (
        {"revision": 1, "ownerId": bobs_id},
        {"revision": 1, "location": {"visibility": "area_only", "ownerId": bobs_id}},
        {"revision": 1, "name": "Mass Assignment", "owner": {"id": bobs_id}},
        {"revision": 1, "name": "Mass Assignment", "user_id": bobs_id},
    ):
        response = alice.request("PATCH", f"{LISTINGS}/{target}", json=body)
        assert response.status_code == 422, body
    assert mine(alice, target)["name"] == "Capital Stationers"
    assert bob.get(MINE).json()["data"] == []


@pytest.mark.parametrize("plan", [PlanCode.FREE, PlanCode.PREMIUM])
def test_a_professional_has_no_admin_power_over_anyone_s_listing(
    auth_env: AuthEnv, plan: PlanCode
) -> None:
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice", admin=False)
    pro = signed_in(auth_env, "pro@example.org", professional=plan, display_name="Pr O", admin=False)
    target = created_id(alice, business_body())

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
    alice = signed_in(auth_env, "alice@example.org", display_name="Al Ice", admin=False)
    bob = signed_in(auth_env, "bob@example.org", display_name="Bo B", admin=False)
    alices = created_id(alice, business_body())

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


# -- Service / Professional listings are portal-managed (admin-only) --------------------------------
#
# Product rule: the public "Services" section is NOT a marketplace — only an admin may create, edit
# or archive a listing with ``kind="provider"``. The endpoint's dependency is still
# ``ProfessionalUser`` (verified + a professional profile), so an admin needs a professional profile
# to OWN what they create; the extra admin check is a service-level gate on provider kind only.


def test_a_non_admin_professional_cannot_create_a_provider_listing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, "ordinary@example.org", admin=False)

    response = api.request("POST", LISTINGS, json=provider_body(name="Should Not Create"))

    assert response.status_code == 403
    assert error_code(response) == "forbidden"
    assert ("kind", "provider_admin_only") in codes(response)
    # Nothing was written: the listing list is empty, and no rate-limit slot was burned either.
    assert api.get(MINE).json()["meta"]["total"] == 0


@pytest.mark.parametrize(
    "builder", [business_body, food_body, tutor_body, property_body], ids=lambda f: f.__name__
)
def test_a_non_admin_professional_can_still_create_the_other_kinds(
    auth_env: AuthEnv, builder: Any
) -> None:
    """The gate is kind-specific: non-admins keep their normal workspace for every other kind."""
    api = signed_in(auth_env, "ordinary@example.org", admin=False)

    response = api.request("POST", LISTINGS, json=builder())

    assert response.status_code == 201, response.text


def test_an_admin_professional_can_create_a_provider_listing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env, "service-manager@example.org", admin=True)

    response = api.request("POST", LISTINGS, json=provider_body(name="Portal Managed Service"))

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["kind"] == "provider" and data["name"] == "Portal Managed Service"


def test_a_non_admin_cannot_edit_or_archive_a_legacy_provider_listing_they_own(
    auth_env: AuthEnv,
) -> None:
    """Pre-existing (legacy) non-admin-owned provider rows remain in the database — ownership is
    never silently transferred. The owner can still READ the row through the usual owner endpoints,
    but every WRITE on it (edit, visibility narrow, archive) returns ``403 provider_admin_only``.

    Setup: the owner created the row while an admin, then the admin role was later revoked (sessions
    are rotated on role change — ``AUTH_RBAC.md §9``, so the account logs in fresh and keeps the row)."""
    # Create as admin, then drop the admin role on the user so they are a plain professional owner.
    owner = signed_in(auth_env, "legacy@example.org", admin=True, display_name="Lega Cy")
    legacy_id = created_id(owner, provider_body(name="Legacy Provider"))
    auth_env.session.execute(
        text(
            "DELETE FROM user_roles ur USING users u"
            " WHERE ur.user_id = u.id AND u.email = 'legacy@example.org'"
        )
    )
    auth_env.session.commit()
    # Fresh browser, same account — a role change rotates the session, so the next request must log
    # in again to pick up the (now-empty) role set.
    owner = auth_env.client()
    assert owner.login("legacy@example.org").status_code == 200

    # The row is still readable through the owner endpoints (no silent takedown or transfer).
    assert mine(owner, legacy_id)["name"] == "Legacy Provider"

    # Every WRITE on it fails with the dedicated 403.
    for response in (
        patch(owner, legacy_id, 1, name="Try to rename"),
        patch(owner, legacy_id, 1, location={"visibility": "area_only"}),
        archive(owner, legacy_id, 1),
    ):
        assert response.status_code == 403
        assert error_code(response) == "forbidden"
        assert ("kind", "provider_admin_only") in codes(response)
    # The row was not touched.
    assert mine(owner, legacy_id)["name"] == "Legacy Provider"


def test_an_admin_can_edit_and_archive_a_provider_listing(auth_env: AuthEnv) -> None:
    admin = signed_in(auth_env, "service-manager@example.org", admin=True)
    listing_id = created_id(admin, provider_body(name="Managed Service"))

    assert patch(admin, listing_id, 1, name="Managed Service — V2").status_code == 200
    assert archive(admin, listing_id, 2).status_code == 200


# -- Quota behaviour for provider listings ----------------------------------------------------------
#
# Product rule (Task 2 follow-up #1): there are ~10 owned service categories, so an admin running
# the portal's internal Service / Professional listings cannot be constrained by the ordinary Free
# professional quota (3 active). The exemption is narrow:
#   - providers never consume the owner's quota (``count_active`` filters them out);
#   - creating / resubmitting a provider skips the quota check entirely;
#   - business / tutor / property still count and still enforce.


def test_an_admin_can_create_more_provider_listings_than_the_free_quota_allows(
    auth_env: AuthEnv,
) -> None:
    """Portal manages ~10 services; the Free-plan ceiling of 3 must not block an admin from doing
    their job. Create many providers in a row on a Free plan and prove they all land as pending."""
    admin = signed_in(auth_env, "service-manager@example.org", admin=True, professional=PlanCode.FREE)

    responses = [
        create(admin, provider_body(name=f"Managed Service {n}")) for n in range(6)
    ]

    assert [r.status_code for r in responses] == [201] * 6
    assert admin.get(MINE).json()["meta"]["total"] == 6


def test_provider_listings_do_not_consume_the_owner_s_ordinary_quota(auth_env: AuthEnv) -> None:
    """Admin has 3 provider listings active (pending + approved). The quota for Business /
    Tutor / Property is still 3 for the Free plan — those 3 providers must not have taken the
    slots away."""
    admin = signed_in(auth_env, "service-manager@example.org", admin=True, professional=PlanCode.FREE)
    provider_ids = [created_id(admin, provider_body(name=f"Service {n}")) for n in range(3)]
    set_status(auth_env.session, provider_ids[0], ListingStatus.APPROVED)

    # All three ordinary slots are available despite the three active providers.
    for n in range(3):
        assert create(admin, business_body(name=f"Business {n}")).status_code == 201, n

    # The fourth business now hits the quota — because business slots are what the plan limits.
    fourth = create(admin, business_body(name="Business Four"))
    assert (fourth.status_code, error_code(fourth)) == (403, "plan_limit_reached")

    # The providers are untouched by the plan_limit_reached flow.
    assert admin.get(f"{MINE}?kind=provider").json()["meta"]["total"] == 3


def test_an_ordinary_business_listing_still_consumes_and_enforces_the_quota(
    auth_env: AuthEnv,
) -> None:
    """Belt-and-braces for the inverse: Free professional with 3 business listings cannot create
    a fourth one. The admin status of the signer is irrelevant to this rule — the exemption is
    kind-specific (provider only)."""
    admin = signed_in(auth_env, "service-manager@example.org", admin=True, professional=PlanCode.FREE)
    for n in range(3):
        assert create(admin, business_body(name=f"Business {n}")).status_code == 201, n

    fourth = create(admin, business_body(name="Business Four"))

    assert (fourth.status_code, error_code(fourth)) == (403, "plan_limit_reached")


@pytest.mark.parametrize(
    "builder, label_key", [(business_body, "name"), (tutor_body, "name"), (property_body, "title")]
)
def test_ordinary_kinds_still_enforce_quota_for_a_non_admin(
    auth_env: AuthEnv, builder: Any, label_key: str
) -> None:
    """Non-admins keep their normal workspace intact: the Free plan limit (3) still enforces for
    every kind they're allowed to author. (Provider is not reachable for a non-admin by design.)"""
    owner = signed_in(auth_env, "ordinary@example.org", admin=False, professional=PlanCode.FREE)
    for n in range(3):
        body = builder(**{label_key: f"Listing {n}"})
        assert create(owner, body).status_code == 201, n

    fourth = create(owner, builder(**{label_key: "Listing Four"}))

    assert (fourth.status_code, error_code(fourth)) == (403, "plan_limit_reached")


def test_an_admin_resubmitting_a_rejected_provider_is_not_blocked_by_the_quota(
    auth_env: AuthEnv,
) -> None:
    """A rejected listing is re-checked against the quota when resubmitted (API_CONTRACT §10.9);
    for providers that re-check is a no-op, so an admin can edit a rejected provider freely even
    if their other active listings are at the plan cap."""
    admin = signed_in(auth_env, "service-manager@example.org", admin=True, professional=PlanCode.FREE)
    # Fill the non-provider quota.
    for n in range(3):
        assert create(admin, business_body(name=f"Business {n}")).status_code == 201, n
    # One provider, taken through rejected.
    provider_id = created_id(admin, provider_body(name="Rejected Service"))
    set_status(auth_env.session, provider_id, ListingStatus.REJECTED)

    # Resubmission with a material change must not hit plan_limit_reached — provider skips quota.
    response = patch(admin, provider_id, 1, name="Rejected Service — Revised")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "pending"
