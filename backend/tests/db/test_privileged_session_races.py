"""A privileged change is made only by a session that is still alive when it is applied
(AUTH_RBAC.md §36).

The route guards authenticate BEFORE the change's transaction. A password reset, a sign-out or a
suspension can commit in between, so the change re-reads and locks the acting session inside its
transaction. Every staff mutation of the application is staged here in both arrival orders:

* **revoked first** — the request is paused just after authentication, the revocation commits, the
  request goes on: it must be refused and leave nothing behind;
* **change first** — the request is paused just before COMMIT; the revocation is OBSERVED waiting,
  the change commits, then the revocation applies.

Real endpoints, separate PostgreSQL connections, committed rows. Nothing depends on timing.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from types import ModuleType
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models.enums import PlanCode, StaffScope
from app.repositories.staff import StaffManagementRepository
from app.services import (
    grocery_settings,
    grocery_staff_orders,
    moderation,
    portal_requests,
    provider_authoring,
    staff_authority,
    taxonomy_admin,
)
from app.services.auth_sessions import SessionService
from tests.db.admin_helpers import ADMIN_CATEGORIES, ADMIN_LISTINGS, category_body
from tests.db.auth_helpers import (
    OTHER_PASSWORD,
    PASSWORD,
    AuthApi,
    AuthEnv,
    last_token,
    make_account,
)
from tests.db.grocery_helpers import (
    BLOCKS,
    SETTINGS,
    advance,
    configure,
    purge_grocery,
    staff_order,
    staff_post,
    submitted,
)
from tests.db.request_helpers import PORTAL_REQUESTS, REQUESTS, request_body
from tests.db.staff_helpers import MODERATORS, purge_staff_audit
from tests.db.test_auth_concurrency import same_session
from tests.db.test_grocery_concurrency import Running, browser, gate_method, user_id, waiting
from tests.db.test_grocery_staff_api import body_for
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_scoped_moderation_concurrency import Gate, scalar, wait_until
from tests.write_payloads import LISTINGS, business_body, staff_provider_body

BOSS = "boss@example.org"
PROVIDERS = "/admin/providers"


@pytest.fixture
def world(db_engine: Engine) -> Iterator[AuthEnv]:
    try:
        with (
            purge_staff_audit(db_engine),
            purge_grocery(db_engine),
            committed_world(db_engine) as env,
        ):
            yield env
    finally:
        with db_engine.begin() as connection:  # categories are not reached by TRUNCATE users
            connection.execute(
                text("DELETE FROM categories WHERE slug LIKE 'cc-%' AND parent_id IS NOT NULL")
            )
            connection.execute(text("DELETE FROM categories WHERE slug LIKE 'cc-%'"))


# -- what a privileged change can leave behind ------------------------------------------------------

FINGERPRINT = (
    "SELECT * FROM listings ORDER BY id",
    "SELECT * FROM listing_status_history ORDER BY id",
    "SELECT * FROM service_requests ORDER BY id",
    "SELECT * FROM service_request_status_history ORDER BY id",
    "SELECT * FROM categories WHERE slug LIKE 'cc-%' ORDER BY slug",
    "SELECT user_id, role FROM user_roles ORDER BY 1, 2",
    "SELECT user_id, scope FROM staff_scope_assignments ORDER BY 1, 2",
    "SELECT * FROM staff_audit_events ORDER BY id",
    "SELECT * FROM grocery_settings_revisions ORDER BY revision",
    "SELECT * FROM grocery_orders ORDER BY id",
    "SELECT * FROM grocery_order_status_history ORDER BY id",
    "SELECT * FROM grocery_order_confirmations ORDER BY id",
    "SELECT * FROM grocery_payments ORDER BY id",
    "SELECT * FROM grocery_order_events ORDER BY id",
)


def fingerprint(engine: Engine) -> list[list[str]]:
    with engine.connect() as connection:
        return [[str(row) for row in connection.execute(text(sql))] for sql in FINGERPRINT]


def active_sessions_of_email(engine: Engine, email: str) -> int:
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM auth_sessions s JOIN users u ON u.id = s.user_id "
            "WHERE u.email = :e AND s.revoked_at IS NULL",
            e=email,
        )
    )


def run_sql(engine: Engine, statement: str, **params: Any) -> None:
    with engine.begin() as connection:
        connection.execute(text(statement), params)


def error_code(response: Response) -> tuple[int, str]:
    body = response.json() if response.content else {}
    return response.status_code, body.get("error", {}).get("code", "(it succeeded)")


# -- every staff mutation of the application --------------------------------------------------------


@dataclass
class Prepared:
    """One privileged request, ready to be sent by the signed-in Super Admin ``boss``."""

    boss: AuthApi
    send: Callable[[], Response]
    module: ModuleType  # whose transaction applies the change
    ok: int


def _boss(env: AuthEnv) -> AuthApi:
    make_account(env.session, BOSS, admin=True)
    return browser(env, BOSS)


def _created(response: Response) -> str:
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


def _pending_listing(env: AuthEnv) -> str:
    make_account(env.session, "owner@example.org", professional=PlanCode.PREMIUM)
    owner = browser(env, "owner@example.org")
    return _created(owner.post(LISTINGS, business_body()))


def _provider(env: AuthEnv, boss: AuthApi) -> str:
    return _created(boss.post(PROVIDERS, staff_provider_body()))


def _category(boss: AuthApi, name: str, **extra: Any) -> str:
    body = category_body("food", name, slug="cc-" + name.lower().replace(" ", "-"), **extra)
    return _created(boss.post(ADMIN_CATEGORIES, body))


def _staff_target(env: AuthEnv, scopes: list[StaffScope] | None) -> uuid.UUID:
    return make_account(env.session, "target@example.org", moderator_scopes=scopes).id


def op_approve(env: AuthEnv, engine: Engine) -> Prepared:
    boss, listing = _boss(env), _pending_listing(env)
    url = f"{ADMIN_LISTINGS}/{listing}/approve"
    return Prepared(boss, lambda: boss.post(url, {"revision": 1}), moderation, 200)


def op_reject(env: AuthEnv, engine: Engine) -> Prepared:
    boss, listing = _boss(env), _pending_listing(env)
    url = f"{ADMIN_LISTINGS}/{listing}/reject"
    body = {"revision": 1, "reason": "Please add the opening hours."}
    return Prepared(boss, lambda: boss.post(url, body), moderation, 200)


def op_category_create(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    body = category_body("food", "CC Sweet Shops", slug="cc-sweets")
    return Prepared(boss, lambda: boss.post(ADMIN_CATEGORIES, body), taxonomy_admin, 201)


def op_category_patch(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    category = _category(boss, "CC Old")
    url = f"{ADMIN_CATEGORIES}/{category}"
    return Prepared(
        boss, lambda: boss.request("PATCH", url, json={"name": "CC New"}), taxonomy_admin, 200
    )


def op_category_reorder(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    parent = _category(boss, "CC Parent")
    first = _category(boss, "CC One", parentId=parent)
    second = _category(boss, "CC Two", parentId=parent)
    body = {"module": "food", "parentId": parent, "orderedIds": [second, first]}
    return Prepared(
        boss, lambda: boss.post(f"{ADMIN_CATEGORIES}/reorder", body), taxonomy_admin, 200
    )


def op_appoint(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    _staff_target(env, None)
    body = {"email": "target@example.org", "scopes": ["food"], "revision": 0}
    return Prepared(boss, lambda: boss.post(MODERATORS, body), staff_authority, 201)


def op_replace_scopes(env: AuthEnv, engine: Engine) -> Prepared:
    boss, target = _boss(env), _staff_target(env, [StaffScope.FOOD])
    url = f"{MODERATORS}/{target}/scopes"
    return Prepared(
        boss,
        lambda: boss.request("PUT", url, json={"scopes": ["education"], "revision": 0}),
        staff_authority,
        200,
    )


def op_pause(env: AuthEnv, engine: Engine) -> Prepared:
    boss, target = _boss(env), _staff_target(env, [StaffScope.FOOD])
    return Prepared(
        boss,
        lambda: boss.post(f"{MODERATORS}/{target}/pause", {"revision": 0}),
        staff_authority,
        200,
    )


def op_resume(env: AuthEnv, engine: Engine) -> Prepared:
    boss, target = _boss(env), _staff_target(env, [])
    url = f"{MODERATORS}/{target}/resume"
    return Prepared(
        boss, lambda: boss.post(url, {"scopes": ["food"], "revision": 0}), staff_authority, 200
    )


def op_remove(env: AuthEnv, engine: Engine) -> Prepared:
    boss, target = _boss(env), _staff_target(env, [StaffScope.FOOD])
    return Prepared(
        boss,
        lambda: boss.request("DELETE", f"{MODERATORS}/{target}?revision=0"),
        staff_authority,
        204,
    )


def op_provider_create(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    body = staff_provider_body()
    return Prepared(boss, lambda: boss.post(PROVIDERS, body), provider_authoring, 201)


def op_provider_edit(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    url = f"{PROVIDERS}/{_provider(env, boss)}"
    body = {"revision": 1, "name": "Brighter Spark Electricians"}
    return Prepared(boss, lambda: boss.request("PATCH", url, json=body), provider_authoring, 200)


def op_provider_archive(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    url = f"{PROVIDERS}/{_provider(env, boss)}/archive"
    return Prepared(boss, lambda: boss.post(url, {"revision": 1}), provider_authoring, 200)


def op_staff_request(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    provider = _provider(env, boss)
    run_sql(engine, "UPDATE listings SET status = 'approved' WHERE id = :i", i=provider)
    make_account(env.session, "customer@example.org")
    customer = browser(env, "customer@example.org")
    request = _created(customer.post(REQUESTS, request_body(provider)))
    url = f"{PORTAL_REQUESTS}/{request}/accept"
    return Prepared(boss, lambda: boss.post(url), portal_requests, 200)


def op_grocery_settings(env: AuthEnv, engine: Engine) -> Prepared:
    boss = _boss(env)
    return Prepared(
        boss,
        lambda: boss.request("PATCH", SETTINGS, json={"revision": 1, "dailyCapacity": 11}),
        grocery_settings,
        200,
    )


def _grocery_change(action: str, needs: str | None) -> Callable[[AuthEnv, Engine], Prepared]:
    """One Grocery staff change, on a customer's order brought to the status it needs. ``needs``
    is ``None`` for the claim itself; every other order is claimed by ``boss``."""

    def prepare(env: AuthEnv, engine: Engine) -> Prepared:
        boss = _boss(env)
        configure(boss, enabled=True, serviceableBlocks=BLOCKS)
        make_account(env.session, "customer@example.org")
        order = submitted(browser(env, "customer@example.org"))["id"]
        if needs is not None:
            advance(boss, order, needs)
        body = body_for(action, staff_order(boss, order)["revision"])
        return Prepared(
            boss, lambda: staff_post(boss, order, action, body), grocery_staff_orders, 200
        )

    return prepare


#: Every Grocery staff change, with the status it needs (AUTH_RBAC.md §37).
GROCERY_CHANGES: dict[str, str | None] = {
    "claim": None,
    "release": "submitted",
    "confirm": "submitted",
    "reconfirm": "confirmed",
    "reduce-amount": "confirmed",
    "start-preparing": "confirmed",
    "dispatch": "preparing",
    "delivery-failed": "out_for_delivery",
    "complete": "out_for_delivery",
    "cancel": "preparing",
    "issues": "submitted",
}

OPERATIONS: dict[str, Callable[[AuthEnv, Engine], Prepared]] = {
    "listing approve": op_approve,
    "listing reject": op_reject,
    "category create": op_category_create,
    "category patch": op_category_patch,
    "category reorder": op_category_reorder,
    "moderator appoint": op_appoint,
    "moderator scopes": op_replace_scopes,
    "moderator pause": op_pause,
    "moderator resume": op_resume,
    "moderator remove": op_remove,
    "provider create": op_provider_create,
    "provider edit": op_provider_edit,
    "provider archive": op_provider_archive,
    "staff request action": op_staff_request,
    "grocery settings": op_grocery_settings,
    **{
        f"grocery order {action}": _grocery_change(action, needs)
        for action, needs in GROCERY_CHANGES.items()
    },
}
STAFF_MANAGEMENT = {name for name in OPERATIONS if name.startswith("moderator ")}


# -- what ends the acting session -------------------------------------------------------------------


def by_password_reset(env: AuthEnv, engine: Engine, boss: AuthApi) -> Callable[[], None]:
    anonymous = env.client()
    assert anonymous.post("/auth/forgot-password", {"email": BOSS}).status_code == 202
    token = last_token(env, "password_reset")

    def revoke() -> None:
        body = {"token": token, "newPassword": OTHER_PASSWORD}
        assert anonymous.post("/auth/reset-password", body).status_code == 204

    return revoke


def by_logout(env: AuthEnv, engine: Engine, boss: AuthApi) -> Callable[[], None]:
    twin = same_session(boss, env)

    def revoke() -> None:
        assert twin.logout().status_code == 204

    return revoke


def by_logout_all(env: AuthEnv, engine: Engine, boss: AuthApi) -> Callable[[], None]:
    other = browser(env, BOSS)

    def revoke() -> None:
        assert other.post("/auth/logout-all").status_code == 204

    return revoke


def by_suspension(env: AuthEnv, engine: Engine, boss: AuthApi) -> Callable[[], None]:
    """No application endpoint suspends an account: an operator's statement. It updates only the
    ``users`` row, which a ``FOR KEY SHARE`` lock would NOT hold back."""
    return lambda: run_sql(engine, "UPDATE users SET status = 'suspended' WHERE email = :e", e=BOSS)


REVOCATIONS = {
    "password reset": by_password_reset,
    "logout": by_logout,
    "logout-all": by_logout_all,
    "suspension": by_suspension,
}


# -- staging ----------------------------------------------------------------------------------------


class Background:
    """Any callable on its own thread (a revocation is not always a request)."""

    def __init__(self, work: Callable[[], None]) -> None:
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, args=(work,), daemon=True)
        self.thread.start()

    def _run(self, work: Callable[[], None]) -> None:
        try:
            work()
        except BaseException as error:  # reported by finish()
            self.error = error

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def finish(self) -> None:
        self.thread.join(30)
        assert not self.thread.is_alive(), "never finished (deadlock?)"
        assert self.error is None, repr(self.error)


def gate_before_commit(monkeypatch: pytest.MonkeyPatch, module: ModuleType) -> Gate:
    """Pause the next transaction of ``module`` after its body, just before COMMIT: it has written
    and still holds every lock it took."""
    gate = Gate()
    real = module.transaction
    first = threading.Lock()

    @contextmanager
    def paused(session: Session) -> Iterator[Session]:
        mine = first.acquire(blocking=False)
        with real(session):
            yield session
            if mine:
                gate.pause()

    monkeypatch.setattr(module, "transaction", paused)
    return gate


# == revoked first ==================================================================================


@pytest.mark.parametrize("revocation", list(REVOCATIONS))
@pytest.mark.parametrize("operation", list(OPERATIONS))
def test_a_session_revoked_after_authentication_changes_nothing(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    revocation: str,
) -> None:
    prepared = OPERATIONS[operation](world, db_engine)
    revoke = REVOCATIONS[revocation](world, db_engine, prepared.boss)
    before = fingerprint(db_engine)
    gate = gate_method(monkeypatch, SessionService, "authenticate", after=True)
    pending = Running(prepared.send)
    gate.wait_arrived()  # authenticated and, as far as the route guard knows, authorised

    Background(revoke).finish()
    gate.release.set()
    answer = pending.finish()

    # a suspended Super Admin has also lost the authority staff management asks for first
    lost_authority = revocation == "suspension" and operation in STAFF_MANAGEMENT
    expected = (403, "forbidden") if lost_authority else (401, "session_expired")
    assert error_code(answer) == expected
    assert fingerprint(db_engine) == before, "a refused change left something behind"


# == change first ===================================================================================


@pytest.mark.parametrize("revocation", list(REVOCATIONS))
@pytest.mark.parametrize("operation", list(OPERATIONS))
def test_a_revocation_waits_for_a_change_that_is_being_applied(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    revocation: str,
) -> None:
    prepared = OPERATIONS[operation](world, db_engine)
    revoke = REVOCATIONS[revocation](world, db_engine, prepared.boss)
    before = fingerprint(db_engine)
    gate = gate_before_commit(monkeypatch, prepared.module)
    pending = Running(prepared.send)
    gate.wait_arrived()  # written, not committed

    revoking = Background(revoke)
    wait_until(
        lambda: not revoking.running or waiting(db_engine, "%") == 1,
        "the revocation to finish or to wait",
    )
    had_to_wait = revoking.running
    gate.release.set()

    assert pending.finish().status_code == prepared.ok
    revoking.finish()
    assert had_to_wait, "the revocation committed while the change was still uncommitted"
    assert fingerprint(db_engine) != before
    # the revocation applied afterwards: the same browser can do nothing more
    assert error_code(prepared.send())[0] == 401


# == the authority itself ===========================================================================


@pytest.mark.parametrize("operation", list(OPERATIONS))
def test_a_role_removed_after_authentication_is_refused(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    """Only the role row goes (no session is revoked): the change must re-read it itself."""
    prepared = OPERATIONS[operation](world, db_engine)
    boss_id = user_id(db_engine, BOSS)
    gate = gate_method(monkeypatch, SessionService, "authenticate", after=True)
    pending = Running(prepared.send)
    gate.wait_arrived()

    run_sql(db_engine, "DELETE FROM user_roles WHERE user_id = :u AND role = 'admin'", u=boss_id)
    before = fingerprint(db_engine)
    gate.release.set()

    assert error_code(pending.finish()) == (403, "forbidden")
    assert fingerprint(db_engine) == before


@pytest.mark.parametrize("operation", ["listing approve", "category create", "moderator appoint"])
def test_a_session_that_expires_after_authentication_changes_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    prepared = OPERATIONS[operation](world, db_engine)
    before = fingerprint(db_engine)
    gate = gate_method(monkeypatch, SessionService, "authenticate", after=True)
    pending = Running(prepared.send)
    gate.wait_arrived()

    world.clock.advance(days=400)
    gate.release.set()

    assert error_code(pending.finish()) == (401, "session_expired")
    assert fingerprint(db_engine) == before


def test_an_ended_session_learns_nothing_about_whether_a_resource_exists(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    prepared = op_approve(world, db_engine)
    revoke = by_logout(world, db_engine, prepared.boss)
    gate = gate_method(monkeypatch, SessionService, "authenticate", after=True)
    pending = Running(
        lambda: prepared.boss.post(f"{ADMIN_LISTINGS}/{uuid.uuid4()}/approve", {"revision": 1})
    )
    gate.wait_arrived()
    Background(revoke).finish()
    gate.release.set()

    assert error_code(pending.finish()) == (401, "session_expired")


# == the lock order under strain ====================================================================


def test_acting_on_your_own_account_while_its_password_is_being_reset_does_not_deadlock(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Staff management first holds the actor ``FOR SHARE`` and then locks the target ``FOR
    UPDATE``. When they are the same person that is an upgrade, with a reset already queued."""
    boss = _boss(world)
    revoke = by_password_reset(world, db_engine, boss)
    gate = gate_method(monkeypatch, StaffManagementRepository, "lock_user_by_email", after=False)
    pending = Running(
        lambda: boss.post(MODERATORS, {"email": BOSS, "scopes": ["food"], "revision": 0})
    )
    gate.wait_arrived()  # the actor is locked; the target (the same account) is not yet

    resetting = Background(revoke)
    wait_until(
        lambda: not resetting.running or waiting(db_engine, "%") == 1,
        "the reset to finish or to wait",
    )
    had_to_wait = resetting.running
    gate.release.set()

    answer = pending.finish()
    resetting.finish()
    assert had_to_wait
    assert answer.status_code < 500 and answer.status_code != 201, answer.text
    assert active_sessions_of_email(db_engine, BOSS) == 0
    assert world.client().login(BOSS, OTHER_PASSWORD).status_code == 200
    assert world.client().login(BOSS, PASSWORD).status_code == 401


def test_two_privileged_changes_of_one_session_do_not_wait_for_each_other(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    prepared = op_approve(world, db_engine)
    other = same_session(prepared.boss, world)
    gate = gate_before_commit(monkeypatch, prepared.module)
    approving = Running(prepared.send)
    gate.wait_arrived()

    body = category_body("food", "CC Meanwhile", slug="cc-meanwhile")
    created = Running(lambda: other.post(ADMIN_CATEGORIES, body)).finish()
    gate.release.set()

    assert (created.status_code, approving.finish().status_code) == (201, 200)


# == what PostgreSQL's row locks do and do not hold back ============================================


def _blocked(engine: Engine, statement: str, **params: Any) -> bool:
    with engine.connect() as connection:
        try:
            connection.execute(text("SET LOCAL lock_timeout = '1s'"))
            connection.execute(text(statement), params)
            return False
        except OperationalError as error:
            assert "lock timeout" in str(error.orig)
            return True
        finally:
            connection.rollback()


@pytest.mark.parametrize(
    ("mode", "reset_blocked", "status_update_blocked"),
    [("FOR KEY SHARE", True, False), ("FOR SHARE", True, True)],
)
def test_what_a_user_row_lock_holds_back(
    db_engine: Engine, world: AuthEnv, mode: str, reset_blocked: bool, status_update_blocked: bool
) -> None:
    make_account(world.session, BOSS)
    uid = user_id(db_engine, BOSS)
    with db_engine.connect() as holder:
        holder.execute(text(f"SELECT id FROM users WHERE id = :u {mode}"), {"u": uid})  # noqa: S608
        try:
            for_update = "SELECT id FROM users WHERE id = :u FOR UPDATE"
            assert _blocked(db_engine, for_update, u=uid) is reset_blocked
            suspend = "UPDATE users SET status = 'suspended' WHERE id = :u"
            assert _blocked(db_engine, suspend, u=uid) is status_update_blocked
        finally:
            holder.rollback()


def test_only_a_lock_on_the_session_row_holds_back_its_revocation(
    db_engine: Engine, world: AuthEnv
) -> None:
    _boss(world)
    uid = user_id(db_engine, BOSS)
    revoke = (
        "UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE user_id = :u"
    )
    for held, blocked in (
        ("SELECT id FROM users WHERE id = :u FOR SHARE", False),  # the user alone: not enough
        ("SELECT id FROM auth_sessions WHERE user_id = :u FOR SHARE", True),
    ):
        with db_engine.connect() as holder:
            holder.execute(text(held), {"u": uid})
            try:
                assert _blocked(db_engine, revoke, u=uid) is blocked, held
            finally:
                holder.rollback()


def test_a_new_share_lock_is_granted_while_a_writer_is_queued(
    db_engine: Engine, world: AuthEnv
) -> None:
    """The cycle analysis relies on it: a reset waiting for the user does not make the next
    privileged change (or order) queue behind it."""
    make_account(world.session, BOSS)
    uid = user_id(db_engine, BOSS)
    share = "SELECT id FROM users WHERE id = :u FOR SHARE"
    with db_engine.connect() as holder:
        holder.execute(text(share), {"u": uid})

        def queued_writer() -> None:
            with db_engine.begin() as connection:
                connection.execute(
                    text("SELECT id FROM users WHERE id = :u FOR UPDATE"), {"u": uid}
                )

        writer = Background(queued_writer)
        wait_until(lambda: waiting(db_engine, "%FOR UPDATE") == 1, "the writer to queue")
        try:
            assert _blocked(db_engine, share, u=uid) is False
            assert writer.running
        finally:
            holder.rollback()
        writer.finish()
