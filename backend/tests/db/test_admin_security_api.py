"""The security of the whole Admin surface (Phase 12E; docs/backend/AUTH_RBAC.md §4.4, §22):
who may call it, Origin / CSRF on every unsafe admin write, and the fresh-session rule.

Admin authority is the ``admin`` row in ``user_roles`` and nothing else — not a professional
profile, a plan, an e-mail address, a header or a query parameter. A non-admin is refused BEFORE the
body is validated or any row is read, so nothing about the data is learnt from the answer.
Real PostgreSQL, real app, real login.
"""

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import text

from app.models.enums import PlanCode
from tests.db.admin_helpers import (
    ADMIN_CATEGORIES,
    ADMIN_LISTINGS,
    admin_categories,
    admin_signed_in,
    approve,
    created_category,
    owner_signed_in,
    pending,
    reject,
)
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.test_listing_edit_api import snapshot
from tests.db.write_helpers import error_code, provider_body, signed_in

Call = Callable[[AuthApi, str, str], Any]
REASON = "Please add your opening hours and a clearer description."


def _calls(listing_id: str, category: str, group: list[str]) -> dict[str, Callable[[AuthApi], Any]]:
    return {
        "queue": lambda api: api.get(ADMIN_LISTINGS),
        "detail": lambda api: api.get(f"{ADMIN_LISTINGS}/{listing_id}"),
        "approve": lambda api: approve(api, listing_id, 1),
        "reject": lambda api: reject(api, listing_id, 1, REASON),
        "list categories": lambda api: api.get(ADMIN_CATEGORIES),
        "create category": lambda api: api.request(
            "POST", ADMIN_CATEGORIES, json={"module": "food", "name": "Probe Category"}
        ),
        "patch category": lambda api: api.request(
            "PATCH", f"{ADMIN_CATEGORIES}/{category}", json={"name": "Probe Renamed"}
        ),
        "reorder": lambda api: api.request(
            "POST",
            f"{ADMIN_CATEGORIES}/reorder",
            json={"module": "food", "parentId": None, "orderedIds": group},
        ),
    }


class World:
    """A pending listing, two categories, and every admin call bound to them."""

    def __init__(self, env: AuthEnv) -> None:
        self.env = env
        self.owner = owner_signed_in(env)
        self.listing_id = pending(self.owner, provider_body())
        setup = admin_signed_in(env, "setup-admin@example.org")
        self.category = created_category(setup, "food", "Security Probe A")["id"]
        self.sibling = created_category(setup, "food", "Security Probe B")["id"]
        # the WHOLE top-level food group (a reorder must list every sibling), reversed
        self.group = [
            str(row[0])
            for row in env.session.execute(
                text(
                    "SELECT id FROM categories WHERE module = 'food' AND parent_id IS NULL"
                    " ORDER BY display_order, slug"
                )
            )
        ][::-1]
        self.calls = _calls(self.listing_id, self.category, self.group)

    def state(self) -> tuple[Any, ...]:
        self.env.session.expire_all()
        rows = self.env.session.execute(
            text("SELECT id, name, display_order, is_active FROM categories ORDER BY id")
        ).all()
        return snapshot(self.env, self.listing_id)["status"], tuple(map(tuple, rows))


# -- who may call it ------------------------------------------------------------------------------------


NON_ADMIN_ACTORS: dict[str, tuple[Callable[[AuthEnv], AuthApi], int, str]] = {
    "anonymous": (lambda env: env.client(), 401, "unauthenticated"),
    "unverified resident": (
        lambda env: signed_in(env, "unv@example.org", verified=False, professional=None),
        403,
        "email_not_verified",
    ),
    "verified resident": (
        lambda env: signed_in(env, "res@example.org", professional=None),
        403,
        "forbidden",
    ),
    "free professional": (lambda env: signed_in(env, "free@example.org"), 403, "forbidden"),
    "premium professional": (
        lambda env: signed_in(env, "prem@example.org", professional=PlanCode.PREMIUM),
        403,
        "forbidden",
    ),
    "the listing's own owner": (lambda env: signed_in(env, "owner2@example.org"), 403, "forbidden"),
    "an admin-looking e-mail": (
        lambda env: signed_in(env, "admin@b17.pk", professional=PlanCode.PREMIUM),
        403,
        "forbidden",
    ),
    "an unverified admin": (
        lambda env: signed_in(
            env, "unvadmin@example.org", verified=False, professional=None, admin=True
        ),
        403,
        "email_not_verified",
    ),
}


@pytest.mark.parametrize("actor", list(NON_ADMIN_ACTORS))
@pytest.mark.parametrize(
    "call",
    [
        "queue",
        "detail",
        "approve",
        "reject",
        "list categories",
        "create category",
        "patch category",
        "reorder",
    ],
)
def test_only_an_admin_reaches_any_admin_route(auth_env: AuthEnv, actor: str, call: str) -> None:
    world = World(auth_env)
    make, status, code = NON_ADMIN_ACTORS[actor]
    api = make(auth_env)
    before = world.state()

    response = world.calls[call](api)

    assert (response.status_code, error_code(response)) == (status, code), (actor, call)
    assert response.headers["Cache-Control"] == "no-store"
    assert world.state() == before  # nothing was read into a response and nothing was written


def test_a_non_admin_learns_nothing_from_a_bad_body_or_an_unknown_id(auth_env: AuthEnv) -> None:
    World(auth_env)
    pro = signed_in(auth_env, "pro@example.org")
    ghost = str(uuid.uuid4())

    probes = [
        pro.request("POST", f"{ADMIN_LISTINGS}/{ghost}/approve", json={"wrong": "body"}),
        pro.request("POST", f"{ADMIN_LISTINGS}/not-a-uuid/reject", json={}),
        pro.request("PATCH", f"{ADMIN_CATEGORIES}/{ghost}", json={"module": "services"}),
        pro.request("POST", ADMIN_CATEGORIES, json={"module": "marketplace"}),
        pro.get(f"{ADMIN_LISTINGS}/{ghost}"),
    ]

    # 403 for every one of them: never 404 (existence) and never 422 (validation internals)
    assert {(r.status_code, error_code(r)) for r in probes} == {(403, "forbidden")}


def test_admin_authority_is_the_role_row_and_nothing_the_request_says(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    pro = signed_in(auth_env, "pro@example.org")

    for kwargs in (
        {"params": {"admin": "true", "role": "admin"}},
        {"headers": {"X-Role": "admin", "X-Admin": "1", "X-Forwarded-User": "admin"}},
    ):
        assert pro.get(ADMIN_LISTINGS, **kwargs).status_code == 403
    body_claim = pro.request(
        "POST",
        f"{ADMIN_LISTINGS}/{world.listing_id}/approve",
        json={"revision": 1, "role": "admin"},
    )
    assert body_claim.status_code == 403
    assert world.state()[0] == "pending"


def test_a_professional_who_is_also_an_admin_passes_by_the_role_and_a_plain_admin_needs_no_plan(
    auth_env: AuthEnv,
) -> None:
    world = World(auth_env)
    both = signed_in(auth_env, "both@example.org", admin=True)  # role AND profile
    plain = admin_signed_in(auth_env)  # role only: no profile, no plan

    assert both.get(ADMIN_LISTINGS).status_code == 200
    assert plain.get(ADMIN_LISTINGS).status_code == 200
    assert world.calls["queue"](plain).json()["meta"]["total"] == 1


def test_revoking_the_admin_role_takes_effect_on_the_very_next_request(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    assert world.calls["approve"](admin).status_code == 200
    auth_env.session.execute(text("DELETE FROM user_roles"))
    auth_env.session.commit()

    for name in ("queue", "reject", "create category", "reorder"):
        assert world.calls[name](admin).status_code == 403, name


def test_a_suspended_admin_is_locked_out_of_everything(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    auth_env.session.execute(
        text("UPDATE users SET status = 'suspended' WHERE email = 'admin@example.org'")
    )
    auth_env.session.commit()

    for name, call in world.calls.items():
        assert call(admin).status_code == 401, name


# -- Origin and CSRF on every unsafe admin write -----------------------------------------------------------


UNSAFE = ["approve", "reject", "create category", "patch category", "reorder"]
TAMPERINGS: dict[str, dict[str, Any]] = {
    "no origin": {"origin": None},
    "foreign origin": {"origin": "https://evil.example.org"},
    "null origin": {"origin": "null"},
    "no csrf": {"csrf": None},
    "wrong csrf": {"csrf": "not-the-token"},
    "empty csrf": {"csrf": ""},
}


def _send(api: AuthApi, world: World, call: str, **tamper: Any) -> Any:
    listing, category = world.listing_id, world.category
    requests = {
        "approve": ("POST", f"{ADMIN_LISTINGS}/{listing}/approve", {"revision": 1}),
        "reject": ("POST", f"{ADMIN_LISTINGS}/{listing}/reject", {"revision": 1, "reason": REASON}),
        "create category": ("POST", ADMIN_CATEGORIES, {"module": "food", "name": "Csrf Probe"}),
        "patch category": ("PATCH", f"{ADMIN_CATEGORIES}/{category}", {"name": "Csrf Renamed"}),
        "reorder": (
            "POST",
            f"{ADMIN_CATEGORIES}/reorder",
            {"module": "food", "parentId": None, "orderedIds": world.group},
        ),
    }
    method, path, body = requests[call]
    return api.request(method, path, json=body, **tamper)


@pytest.mark.parametrize("tamper", list(TAMPERINGS))
@pytest.mark.parametrize("call", UNSAFE)
def test_origin_and_csrf_protect_every_admin_write(
    auth_env: AuthEnv, call: str, tamper: str
) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    before = world.state()

    response = _send(admin, world, call, **TAMPERINGS[tamper])

    assert (response.status_code, error_code(response)) == (403, "csrf_failed"), (call, tamper)
    assert world.state() == before


@pytest.mark.parametrize("call", UNSAFE)
def test_a_valid_origin_and_csrf_token_succeed(auth_env: AuthEnv, call: str) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)

    response = _send(admin, world, call)

    assert response.status_code in (200, 201), (call, response.text)


def test_another_browsers_csrf_token_is_not_accepted(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    mine = admin_signed_in(auth_env, "a1@example.org")
    theirs = admin_signed_in(auth_env, "a2@example.org")

    response = _send(mine, world, "approve", csrf=theirs.csrf)

    assert (response.status_code, error_code(response)) == (403, "csrf_failed")
    assert world.state()[0] == "pending"


# -- the fresh-session rule ------------------------------------------------------------------------------------


ALL_CALLS = [
    "queue", "detail", "approve", "reject", "list categories", "create category", "patch category", "reorder",
]  # fmt: skip


@pytest.mark.parametrize("call", ALL_CALLS)
def test_an_admin_session_idle_for_over_two_hours_is_refused_on_every_route(
    auth_env: AuthEnv, call: str
) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    before = world.state()
    auth_env.clock.advance(hours=2, minutes=1)

    response = world.calls[call](admin)

    assert (response.status_code, error_code(response)) == (401, "session_expired"), call
    assert world.state() == before  # a stale session writes nothing


def test_a_refused_stale_attempt_does_not_count_as_activity(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    auth_env.clock.advance(hours=2, minutes=1)

    first = world.calls["approve"](admin)
    second = world.calls["approve"](admin)  # a retry must not pass just because the first "used" it

    assert first.status_code == second.status_code == 401
    assert world.state()[0] == "pending"


def test_the_stale_session_still_works_for_ordinary_use_and_a_fresh_login_restores_admin_access(
    auth_env: AuthEnv,
) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    auth_env.clock.advance(hours=3)

    assert world.calls["queue"](admin).status_code == 401
    assert (
        admin.get("/auth/me").status_code == 200
    )  # not logged out: only the admin action is refused
    assert admin.get("/users/me/listings").status_code == 200
    again = auth_env.client()
    assert again.login("admin@example.org").status_code == 200
    assert world.calls["approve"](again).status_code == 200


def test_ordinary_activity_keeps_an_admin_session_fresh(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    for _ in range(5):  # six hours of regular use, never idle for two
        auth_env.clock.advance(hours=1, minutes=10)
        assert admin.get("/auth/me").status_code == 200

    assert world.calls["approve"](admin).status_code == 200


def test_an_admin_session_older_than_twelve_hours_is_refused_even_if_in_constant_use(
    auth_env: AuthEnv,
) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    for _ in range(6):
        auth_env.clock.advance(hours=2)
        assert admin.get("/auth/me").status_code == 200  # last used a moment ago, every time
    auth_env.clock.advance(minutes=1)  # 12 h 1 min since the session was created

    response = world.calls["approve"](admin)

    assert (response.status_code, error_code(response)) == (401, "session_expired")
    assert world.state()[0] == "pending"


def test_just_inside_both_limits_is_still_fresh(auth_env: AuthEnv) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    auth_env.clock.advance(hours=1, minutes=59)

    assert world.calls["approve"](admin).status_code == 200


def test_a_session_past_its_absolute_lifetime_is_dead_for_everything_not_just_admin(
    auth_env: AuthEnv,
) -> None:
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    auth_env.clock.advance(days=31)

    first = world.calls["queue"](admin)
    assert (first.status_code, error_code(first)) == (
        401,
        "session_expired",
    )  # and the cookie is cleared
    for call in ("approve", "create category"):
        assert world.calls[call](admin).status_code == 401, call  # now simply unauthenticated
    assert admin.get("/auth/me").status_code == 401


def test_admin_reads_and_writes_do_not_change_the_other_admins_listing_state(
    auth_env: AuthEnv,
) -> None:
    """A smoke check that the surface is idempotent for reads and counted for writes."""
    world = World(auth_env)
    admin = admin_signed_in(auth_env)
    before = world.state()

    for name in ("queue", "detail", "list categories"):
        assert world.calls[name](admin).status_code == 200
    assert world.state() == before
    assert len(admin_categories(admin, "food")) >= 13  # 11 seeded + the two probes
