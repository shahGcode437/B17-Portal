"""RBAC-B: scoped listing moderation (docs/backend/AUTH_RBAC.md §27.3-§27.10, §28).

Real PostgreSQL, real login. Covers the authority matrix a Moderator unlocks for the first time:

* queue / counts restricted to the actor's scope — a client filter can narrow, never widen;
* detail is ``404`` for an out-of-scope id, indistinguishable from a missing one;
* approve / reject / takedown are scoped and self-moderation is denied, with one audited override
  for a Super Admin approving their own Service / Professional listing (reject / takedown excluded);
* ``actor_role`` in ``listing_status_history`` reflects the actor's role on each decision;
* a Moderator sees no raw precise coordinates, only what the public would see;
* forged scope / role headers / query / body claims never widen authority;
* taxonomy stays Super Admin only (covered in ``test_admin_security_api.py``);
* scope is derived from the LOCKED listing state, so an owner edit between queue and decision
  moves the listing between scopes correctly.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import func, select

from app.models import ListingStatusHistory, StaffAuditEvent
from app.models.enums import (
    ActorRole,
    HistoryAction,
    PlanCode,
    StaffScope,
)
from app.services.staff_scopes import LISTING_STAFF_SCOPES
from tests.db.admin_helpers import ADMIN_CATEGORIES, ADMIN_LISTINGS, pending
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.write_helpers import (
    business_body,
    food_body,
    property_body,
    provider_body,
    signed_in,
    tutor_body,
)
from tests.write_payloads import approximate, area_only, exact

REASON = "Please add your opening hours and a clearer description."

Body = dict[str, Any]


# -- helpers -----------------------------------------------------------------------------------


def super_admin(env: AuthEnv, email: str = "sa@example.org") -> AuthApi:
    return signed_in(env, email, professional=None, admin=True, display_name="Super Admin")


def moderator(
    env: AuthEnv,
    scopes: list[StaffScope],
    email: str = "mod@example.org",
    professional: PlanCode | None = None,
) -> AuthApi:
    return signed_in(
        env, email, professional=professional, moderator_scopes=scopes, display_name="Moderator"
    )


def owner(
    env: AuthEnv, email: str, plan: PlanCode | None = PlanCode.PREMIUM, admin: bool = False
) -> AuthApi:
    return signed_in(env, email, professional=plan, admin=admin, display_name="Owner")


def seed_one_of_each(env: AuthEnv) -> dict[str, str]:
    """A pending listing of each kind, owned by a third-party (admin where author must be staff)."""
    staff_author = owner(env, "staff-author@example.org", admin=True)
    general_owner = owner(env, "gen@example.org")
    food_owner = owner(env, "food@example.org")
    tutor_owner = owner(env, "tut@example.org")
    property_owner = owner(env, "prop@example.org")
    return {
        "services": pending(staff_author, provider_body(name="Prov One")),
        "directory": pending(general_owner, business_body(name="Gen Shop")),
        "food": pending(food_owner, food_body(name="Food Place")),
        "education": pending(tutor_owner, tutor_body(name="Tutor")),
        "property": pending(property_owner, property_body(title="A Flat")),
    }


def queue_ids(response: Any) -> list[str]:
    return [row["id"] for row in response.json()["data"]]


def counts(response: Any) -> dict[str, int]:
    return dict(response.json()["meta"]["counts"])


# -- the queue matrix --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("scopes", "visible_keys"),
    [
        (["services"], {"services"}),
        (["directory"], {"directory"}),
        (["food"], {"food"}),
        (["education"], {"education"}),
        (["property"], {"property"}),
        (["food", "directory"], {"food", "directory"}),
        (
            sorted(LISTING_STAFF_SCOPES),
            {"services", "directory", "food", "education", "property"},
        ),
    ],
)
def test_the_queue_shows_exactly_the_moderators_assigned_scopes(
    auth_env: AuthEnv, scopes: list[StaffScope], visible_keys: set[str]
) -> None:
    listings = seed_one_of_each(auth_env)
    mod = moderator(auth_env, [StaffScope(s) for s in scopes])

    response = mod.get(ADMIN_LISTINGS)

    assert response.status_code == 200
    expected = {listings[k] for k in visible_keys}
    assert set(queue_ids(response)) == expected
    assert response.json()["meta"]["total"] == len(expected)


def test_a_super_admin_sees_every_kind_in_the_queue(auth_env: AuthEnv) -> None:
    listings = seed_one_of_each(auth_env)

    response = super_admin(auth_env).get(ADMIN_LISTINGS)

    assert response.status_code == 200
    assert set(queue_ids(response)) == set(listings.values())


def test_a_client_filter_can_narrow_but_never_widen_authority(auth_env: AuthEnv) -> None:
    """A Food moderator adding ``?kind=tutor`` does not thereby see tutors."""
    seed_one_of_each(auth_env)
    mod = moderator(auth_env, [StaffScope.FOOD])

    out_of_scope = mod.get(f"{ADMIN_LISTINGS}?kind=tutor")

    assert out_of_scope.status_code == 200
    assert queue_ids(out_of_scope) == []
    assert out_of_scope.json()["meta"]["total"] == 0


def test_counts_are_scoped_for_moderator_and_global_for_super_admin(auth_env: AuthEnv) -> None:
    """``meta.counts`` is per status WITHIN the actor's scope."""
    seed_one_of_each(auth_env)
    sa_counts = counts(super_admin(auth_env).get(ADMIN_LISTINGS))
    assert sa_counts["pending"] == 5  # one of each kind

    mod_counts = counts(moderator(auth_env, [StaffScope.FOOD]).get(ADMIN_LISTINGS))
    assert mod_counts["pending"] == 1  # only Food


def test_a_moderator_with_no_effective_scope_sees_an_empty_queue_and_zero_counts(
    auth_env: AuthEnv,
) -> None:
    seed_one_of_each(auth_env)
    empty_mod = moderator(auth_env, [], email="empty-mod@example.org", professional=None)

    # `require_staff` refuses a Moderator with no effective scope at the dependency layer.
    response = empty_mod.get(ADMIN_LISTINGS)
    assert response.status_code == 403


# -- detail / IDOR -----------------------------------------------------------------------------


def test_detail_shows_in_scope_and_returns_404_out_of_scope_same_as_missing(
    auth_env: AuthEnv,
) -> None:
    listings = seed_one_of_each(auth_env)
    mod = moderator(auth_env, [StaffScope.FOOD])

    in_scope = mod.get(f"{ADMIN_LISTINGS}/{listings['food']}")
    out_of_scope = mod.get(f"{ADMIN_LISTINGS}/{listings['directory']}")
    missing = mod.get(f"{ADMIN_LISTINGS}/{uuid.uuid4()}")

    assert in_scope.status_code == 200
    # Out-of-scope is INDISTINGUISHABLE from a missing listing: identical status, identical body
    # modulo the request id.
    assert out_of_scope.status_code == 404 and missing.status_code == 404

    def strip(body: dict[str, Any]) -> dict[str, Any]:
        return {**body, "error": {**body["error"], "requestId": None}}

    assert strip(out_of_scope.json()) == strip(missing.json())


# -- mutations ---------------------------------------------------------------------------------


KIND_FOR_SCOPE: dict[str, tuple[Body, str]] = {
    "services": (provider_body(name="Svc"), "svc-mod@example.org"),
    "directory": (business_body(name="Gen"), "gen-mod@example.org"),
    "food": (food_body(name="Food"), "food-mod@example.org"),
    "education": (tutor_body(name="Tut"), "tut-mod@example.org"),
    "property": (property_body(title="Prop"), "prop-mod@example.org"),
}


@pytest.mark.parametrize("scope_value", list(KIND_FOR_SCOPE))
def test_an_in_scope_moderator_can_approve_a_third_partys_listing(
    auth_env: AuthEnv, scope_value: str
) -> None:
    body, mod_email = KIND_FOR_SCOPE[scope_value]
    author = owner(
        auth_env,
        f"author-{scope_value}@example.org",
        admin=scope_value == "services",  # provider authoring is admin-only pre-RBAC-D
    )
    listing_id = pending(author, body)
    mod = moderator(auth_env, [StaffScope(scope_value)], email=mod_email)

    response = mod.request("POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1})

    assert response.status_code == 200, response.text


@pytest.mark.parametrize("scope_value", list(KIND_FOR_SCOPE))
def test_a_wrong_scope_moderator_gets_404_on_mutation(auth_env: AuthEnv, scope_value: str) -> None:
    body, _ = KIND_FOR_SCOPE[scope_value]
    author = owner(auth_env, f"author2-{scope_value}@example.org", admin=scope_value == "services")
    listing_id = pending(author, body)
    other_scope = {
        "services": StaffScope.FOOD,
        "directory": StaffScope.FOOD,
        "food": StaffScope.EDUCATION,
        "education": StaffScope.PROPERTY,
        "property": StaffScope.DIRECTORY,
    }[scope_value]
    wrong = moderator(auth_env, [other_scope], email=f"wrong-{scope_value}@example.org")

    response = wrong.request("POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1})

    assert response.status_code == 404


# -- self-moderation (Moderator) ---------------------------------------------------------------


def test_a_moderator_cannot_approve_reject_or_takedown_their_own_content(auth_env: AuthEnv) -> None:
    """A Moderator with ``food`` scope who also owns a Food listing is refused on every action."""
    mod_owner = signed_in(
        auth_env,
        "modown@example.org",
        professional=PlanCode.FREE,
        moderator_scopes=[StaffScope.FOOD],
    )
    listing_id = pending(mod_owner, food_body(name="Own Food"))

    approve_resp = mod_owner.request(
        "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}
    )
    reject_resp = mod_owner.request(
        "POST",
        f"{ADMIN_LISTINGS}/{listing_id}/reject",
        json={"revision": 1, "reason": REASON},
    )

    assert approve_resp.status_code == 403
    assert approve_resp.json()["error"]["details"][0]["code"] == "self_moderation_forbidden"
    assert reject_resp.status_code == 403
    assert reject_resp.json()["error"]["details"][0]["code"] == "self_moderation_forbidden"


# -- actor_role in history ---------------------------------------------------------------------


def test_history_records_moderator_vs_super_admin_actor_role(auth_env: AuthEnv) -> None:
    author = owner(auth_env, "history-owner@example.org")
    food_id = pending(author, food_body(name="Food For History"))
    other_id = pending(author, food_body(name="Food For SA"))

    mod = moderator(auth_env, [StaffScope.FOOD], email="food-mod@example.org")
    sa = super_admin(auth_env, email="sa-hist@example.org")

    assert (
        mod.request("POST", f"{ADMIN_LISTINGS}/{food_id}/approve", json={"revision": 1}).status_code
        == 200
    )
    assert (
        sa.request("POST", f"{ADMIN_LISTINGS}/{other_id}/approve", json={"revision": 1}).status_code
        == 200
    )

    def last_actor_role(listing_id: str) -> ActorRole:
        entry = auth_env.session.execute(
            select(ListingStatusHistory).where(
                ListingStatusHistory.listing_id == uuid.UUID(listing_id),
                ListingStatusHistory.action == HistoryAction.APPROVED,
            )
        ).scalar_one()
        return entry.actor_role

    assert last_actor_role(food_id) is ActorRole.MODERATOR
    assert last_actor_role(other_id) is ActorRole.ADMIN


# -- scope flip (owner edit between queue and decision) ----------------------------------------


def test_scope_derivation_at_decision_time_follows_the_current_listing_state(
    auth_env: AuthEnv,
) -> None:
    """A Directory Moderator sees a General Business in their queue; owner flips it to Food (via a
    direct state change — the write API's PATCH goes through the same lock); the Moderator's stale
    approval is refused as "not found" because the derived scope is now Food."""
    from sqlalchemy import text

    listing_owner = owner(auth_env, "flip-owner@example.org")
    listing_id = pending(listing_owner, business_body(name="General Shop"))
    # Now flip the vertical directly in the database (equivalent to an owner edit that commits
    # before the Moderator's decision runs).
    auth_env.session.execute(
        text("UPDATE business_profiles SET vertical = 'food' WHERE listing_id = :i"),
        {"i": uuid.UUID(listing_id)},
    )
    auth_env.session.commit()

    directory_mod = moderator(auth_env, [StaffScope.DIRECTORY], email="dir-mod@example.org")

    response = directory_mod.request(
        "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}
    )

    assert response.status_code == 404  # same as a missing listing


# -- location privacy --------------------------------------------------------------------------

#: Distinguishable private values: more precise than the 2-decimal public point, and text that a
#: public listing would never carry unless the listing is ``exact``.
PRIVATE = {
    "block": "C",
    "address": "House 7, Private Lane",
    "landmark": "Opposite the hidden gate",
    "latitude": 33.681234,
    "longitude": 72.845678,
}
LOCATION_FIELDS = {"visibility", "block", "address", "landmark", "latitude", "longitude"}


def present(values: dict[str, Any]) -> dict[str, Any]:
    """Drop ``None`` (the API sends nulls) so shapes compare on what is actually disclosed."""
    return {key: value for key, value in values.items() if value is not None}


def as_public(location: dict[str, Any]) -> dict[str, Any]:
    """An admin ``location`` (flat) re-shaped as the PUBLIC ``location`` (nested ``coordinates``)."""
    point = None
    if location.get("latitude") is not None:
        precision = "exact" if location["visibility"] == "exact" else "approximate"
        point = {
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "precision": precision,
        }
    return present(
        {
            "visibility": location["visibility"],
            "block": location.get("block"),
            "address": location.get("address"),
            "landmark": location.get("landmark"),
            "coordinates": point,
        }
    )


@pytest.mark.parametrize("visibility", ["exact", "approximate", "area_only"])
def test_a_moderators_location_is_exactly_the_public_projection(
    auth_env: AuthEnv, visibility: str
) -> None:
    """For EVERY visibility the Moderator's ``location`` carries nothing the public would not see
    for the same listing — compared field by field with what the real public endpoint returns once
    the listing is approved, and with the ``publicLocation`` in the same response. Not the stored
    point, not ``address`` / ``landmark`` of a non-exact listing, no private-only field. A Super
    Admin keeps the full private location."""
    builders = {"exact": exact, "approximate": approximate, "area_only": area_only}
    location = builders[visibility](**(PRIVATE if visibility != "area_only" else {"block": "C"}))
    listing_id = pending(
        owner(auth_env, "loc-owner@example.org"), business_body(name="Shop", location=location)
    )
    mod = moderator(auth_env, [StaffScope.DIRECTORY], email="dir-loc-mod@example.org")
    sa = super_admin(auth_env, email="sa-loc@example.org")

    pending_detail = mod.get(f"{ADMIN_LISTINGS}/{listing_id}").json()["data"]
    approved = mod.request("POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1})
    assert approved.status_code == 200, approved.text
    approved_detail = approved.json()["data"]
    public = auth_env.client().get(f"/listings/{listing_id}").json()["data"]["location"]
    sa_location = sa.get(f"{ADMIN_LISTINGS}/{listing_id}").json()["data"]["location"]

    for detail in (pending_detail, approved_detail):  # the read AND the decision response
        mod_location = detail["location"]
        assert set(mod_location) <= LOCATION_FIELDS  # no hidden / raw / private-only field
        assert as_public(mod_location) == present(public)  # equal to the real public projection
        assert as_public(mod_location) == present(detail["publicLocation"])  # ...and to its own

    # The Super Admin's moderation view keeps the stored private location.
    if visibility == "area_only":
        assert present(sa_location) == present(
            approved_detail["location"]
        )  # nothing private exists
    else:
        assert sa_location["latitude"] == pytest.approx(PRIVATE["latitude"], abs=1e-9)
        assert sa_location["longitude"] == pytest.approx(PRIVATE["longitude"], abs=1e-9)
        assert sa_location["address"] == PRIVATE["address"]
        assert sa_location["landmark"] == PRIVATE["landmark"]
    if visibility == "approximate":  # the one case where the private view is strictly more precise
        mod_location = approved_detail["location"]
        assert (mod_location["latitude"], mod_location["longitude"]) == (33.68, 72.85)
        assert mod_location.get("address") is None and mod_location.get("landmark") is None
        assert sa_location["latitude"] != mod_location["latitude"]


# -- the queue ignores ``module`` / ``scope`` ----------------------------------------------------


def test_module_and_scope_query_keys_are_not_queue_parameters_and_change_nothing(
    auth_env: AuthEnv,
) -> None:
    """``module`` / ``scope`` / ``staffScopes`` / ``role`` are not fields of the queue query, and the
    query model does not forbid extra keys, so they are IGNORED: the answer is the actor's normal
    scoped queue — neither widened (a ``[directory, food]`` Moderator asking ``module=education``
    gets no tutor) nor narrowed (``module=directory`` does not drop the Food listing)."""
    listings = seed_one_of_each(auth_env)
    mod = moderator(auth_env, [StaffScope.DIRECTORY, StaffScope.FOOD])
    baseline = mod.get(ADMIN_LISTINGS)
    expected = {listings["directory"], listings["food"]}
    assert baseline.status_code == 200 and set(queue_ids(baseline)) == expected

    for params in (
        "module=education",
        "module=directory",
        "scope=education",
        "module=education&scope=services",
        "staffScopes=education",
        "role=admin",
    ):
        response = mod.get(f"{ADMIN_LISTINGS}?{params}")
        assert response.status_code == 200, params  # ignored, not a 422
        assert set(queue_ids(response)) == expected, params
        assert counts(response) == counts(baseline), params

    sa_queue = super_admin(auth_env).get(f"{ADMIN_LISTINGS}?module=food")
    assert sa_queue.status_code == 200
    assert set(queue_ids(sa_queue)) == set(listings.values())  # not narrowed to food either


# -- forged claims -----------------------------------------------------------------------------


def test_forged_scope_claims_do_not_widen_a_moderators_authority(auth_env: AuthEnv) -> None:
    """Headers, query and body ``module`` / ``scope`` / ``staffScopes`` / ``role`` are never
    authority: a Food Moderator pointing a request at a Directory listing with ``?module=directory``
    and headers like ``X-Staff-Scopes: directory`` is still refused (``404``)."""
    listings = seed_one_of_each(auth_env)
    mod = moderator(auth_env, [StaffScope.FOOD], email="food-forge@example.org")
    headers = {"X-Staff-Scopes": "directory,food", "X-Role": "admin"}

    detail = mod.get(
        f"{ADMIN_LISTINGS}/{listings['directory']}?module=directory&scope=directory",
        headers=headers,
    )
    approve_resp = mod.request(
        "POST",
        f"{ADMIN_LISTINGS}/{listings['directory']}/approve",
        json={"revision": 1, "module": "directory", "staffScopes": ["directory"], "role": "admin"},
        headers=headers,
    )

    assert detail.status_code == 404
    # The approve body carries extra keys — those are rejected by Pydantic's strict request shape.
    assert approve_resp.status_code == 422


def test_forged_scope_claims_do_not_grant_access_to_an_unverified_or_non_staff_account(
    auth_env: AuthEnv,
) -> None:
    listings = seed_one_of_each(auth_env)
    resident = signed_in(auth_env, "res-forge@example.org", professional=None)

    response = resident.get(
        f"{ADMIN_LISTINGS}/{listings['food']}",
        headers={"X-Staff-Scopes": "food", "X-Role": "moderator"},
    )

    assert response.status_code == 403


# -- audit coverage ----------------------------------------------------------------------------


def test_normal_moderation_decisions_do_not_write_staff_audit_rows(auth_env: AuthEnv) -> None:
    """Routine listing moderation lives in ``listing_status_history``; the staff audit is reserved
    for exceptional events (RBAC-A §27.11)."""
    listing_owner = owner(auth_env, "ord-owner@example.org")
    listing_id = pending(listing_owner, food_body(name="Routine Food"))
    mod = moderator(auth_env, [StaffScope.FOOD], email="food-ord-mod@example.org")

    assert (
        mod.request(
            "POST", f"{ADMIN_LISTINGS}/{listing_id}/approve", json={"revision": 1}
        ).status_code
        == 200
    )

    audit_rows = auth_env.session.scalar(select(func.count(StaffAuditEvent.id)))
    assert audit_rows == 0


# -- taxonomy guard (safety net; the detailed matrix lives in test_admin_security_api.py) ------


def test_moderators_are_never_allowed_to_touch_taxonomy(auth_env: AuthEnv) -> None:
    sa = super_admin(auth_env, email="sa-tax@example.org")
    sa.get(ADMIN_CATEGORIES)  # warm-up / no-op
    mod_all = moderator(auth_env, sorted(LISTING_STAFF_SCOPES), email="mod-all-tax@example.org")

    list_resp = mod_all.get(ADMIN_CATEGORIES)
    create_resp = mod_all.request(
        "POST", ADMIN_CATEGORIES, json={"module": "food", "name": "Mod Attempted"}
    )

    assert list_resp.status_code == 403
    assert create_resp.status_code == 403
