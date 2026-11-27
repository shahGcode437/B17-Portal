"""A credential checked before a lock authorizes nothing once it has changed (AUTH_RBAC.md §35).

Two arrival orders are staged for each collision, never by timing:

* ``overtaken`` — the slow request is paused just BEFORE it locks anything (its password, token or
  session has already been checked), the other request runs to completion, then it goes on;
* ``queued`` — the first request is paused holding its locks, the second is OBSERVED waiting in
  ``pg_stat_activity``, then the first is released.

Real endpoints, separate PostgreSQL connections, committed rows. The assertions are about what is
left behind: the password that works, the live sessions and tokens, and the audit events.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import timedelta

import pytest
from httpx import Response
from sqlalchemy import Engine, text

from app.core.security.passwords import PasswordService
from app.models.enums import StaffScope
from app.repositories.auth import TokenRepository, UserAuthRepository
from tests.db.auth_helpers import (
    ORIGIN,
    OTHER_PASSWORD,
    PASSWORD,
    AuthApi,
    AuthEnv,
    last_token,
    make_account,
)
from tests.db.oauth_helpers import DISCONNECT, Started, callback, location, started_ok
from tests.db.staff_helpers import purge_staff_audit
from tests.db.test_auth_concurrency import SESSION_CAP, active_sessions, blocked, same_session
from tests.db.test_grocery_concurrency import Running, browser, gate_method, user_id, waiting
from tests.db.test_listing_write_concurrency import committed_world
from tests.db.test_oauth_flow_api import error_url, google_code
from tests.db.test_scoped_moderation_concurrency import scalar, wait_until

EMAIL = "holder@example.org"
THIRD_PASSWORD = "a third long passphrase 4242"
Request = Callable[[], Response]
LOCK = (UserAuthRepository, "lock")
LOCK_BY_EMAIL = (UserAuthRepository, "lock_by_email")


@pytest.fixture
def world(db_engine: Engine) -> Iterator[AuthEnv]:
    with purge_staff_audit(db_engine), committed_world(db_engine) as env:
        yield env


# -- staging ---------------------------------------------------------------------------------------


def overtaken(
    monkeypatch: pytest.MonkeyPatch,
    slow: Request,
    fast: Request,
    pause_before: tuple[type, str] = LOCK,
) -> tuple[Response, Response]:
    """``(slow's answer, fast's answer)``: ``fast`` commits while ``slow`` is between its check
    and its first lock."""
    gate = gate_method(monkeypatch, *pause_before, after=False)
    first = Running(slow)
    gate.wait_arrived()
    second = Running(fast).finish()
    gate.release.set()
    return first.finish(), second


def queued(
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    holder: Request,
    arriving: Request,
    pause_after: tuple[type, str] = LOCK,
) -> tuple[Response, Response]:
    """``(holder's answer, arriving's answer)``: ``arriving`` is seen waiting for ``holder``."""
    gate = gate_method(monkeypatch, *pause_after, after=True)
    first = Running(holder)
    gate.wait_arrived()
    second = Running(arriving)
    blocked(engine, 1)
    gate.release.set()
    return first.finish(), second.finish()


def stage(
    order: str,
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    stale: Request,
    winner: Request,
    winner_pause: tuple[type, str] = LOCK,
) -> tuple[Response, Response]:
    """``winner`` commits first, in either staging. Returns ``(stale's answer, winner's)``."""
    if order == "overtaken":
        return overtaken(monkeypatch, stale, winner)
    first, second = queued(engine, monkeypatch, winner, stale, winner_pause)
    return second, first


ORDERS = ["overtaken", "queued"]


# -- what is left behind ---------------------------------------------------------------------------


def password_is(env: AuthEnv, engine: Engine, owner: uuid.UUID, candidate: str) -> bool:
    """Whether ``candidate`` is the account's password NOW (no sign-in, so nothing changes)."""
    stored = scalar(engine, "SELECT password_hash FROM users WHERE id = :u", u=owner)
    return stored is not None and env.app.state.password_service.verify_password(
        str(stored), candidate
    )


def only_password(env: AuthEnv, engine: Engine, owner: uuid.UUID, expected: str) -> None:
    for candidate in (PASSWORD, OTHER_PASSWORD, THIRD_PASSWORD):
        assert password_is(env, engine, owner, candidate) is (candidate == expected), candidate


def events(engine: Engine, owner: uuid.UUID, kind: str) -> int:
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM auth_events WHERE user_id = :u AND event_type = :k",
            u=owner,
            k=kind,
        )
    )


def live_tokens(engine: Engine, owner: uuid.UUID, purpose: str) -> int:
    return int(
        scalar(
            engine,
            "SELECT count(*) FROM auth_tokens "
            "WHERE user_id = :u AND purpose = :p AND consumed_at IS NULL",
            u=owner,
            p=purpose,
        )
    )


def verified(engine: Engine, owner: uuid.UUID) -> bool:
    return bool(
        scalar(engine, "SELECT email_verified_at IS NOT NULL FROM users WHERE id = :u", u=owner)
    )


def mails(env: AuthEnv, kind: str) -> int:
    return sum(1 for message in env.outbox.outbox if message.kind == kind)


def error_code(response: Response) -> tuple[int, str]:
    body = response.json() if response.content else {}
    return response.status_code, body.get("error", {}).get("code", "(it succeeded)")


def has_session_cookie(response: Response, env: AuthEnv) -> bool:
    name = f"{env.settings.auth_cookie_name}="
    return any(
        cookie.startswith(name) and not cookie.startswith(f'{name}""')
        for cookie in response.headers.get_list("set-cookie")
    )


# -- requests --------------------------------------------------------------------------------------


def change(api: AuthApi, new: str, current: str = PASSWORD) -> Request:
    return lambda: api.post(
        "/auth/change-password", {"currentPassword": current, "newPassword": new}
    )


def sign_in(env: AuthEnv, password: str = PASSWORD) -> tuple[AuthApi, Request]:
    api = env.client()
    return api, lambda: api.login(EMAIL, password)


def reset(env: AuthEnv, token: str, new: str = OTHER_PASSWORD) -> Request:
    api = env.client()
    return lambda: api.post("/auth/reset-password", {"token": token, "newPassword": new})


def verify(env: AuthEnv, token: str) -> Request:
    api = env.client()
    return lambda: api.post("/auth/verify-email", {"token": token})


def forgot(env: AuthEnv) -> Request:
    api = env.client()
    return lambda: api.post("/auth/forgot-password", {"email": EMAIL})


def reset_token(env: AuthEnv) -> str:
    assert forgot(env)().status_code == 202
    return last_token(env, "password_reset")


def account(env: AuthEnv, engine: Engine, **kwargs: object) -> uuid.UUID:
    make_account(env.session, EMAIL, **kwargs)  # type: ignore[arg-type]
    return user_id(engine, EMAIL)


def unverified_account(env: AuthEnv, engine: Engine) -> tuple[uuid.UUID, AuthApi, str]:
    """Registered through the API: signed in, unverified, holding a verification token."""
    api = env.client()
    assert api.register(email=EMAIL).status_code == 201
    return user_id(engine, EMAIL), api, last_token(env, "email_verification")


# == 1. a password reset against a password change that checked the OLD password ====================


@pytest.mark.parametrize("order", ORDERS)
def test_a_stale_password_change_never_overwrites_a_completed_reset(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner = account(world, db_engine)
    holder = browser(world, EMAIL)
    token = reset_token(world)

    stale, done = stage(
        order, db_engine, monkeypatch, change(holder, THIRD_PASSWORD), reset(world, token)
    )

    assert done.status_code == 204
    assert error_code(stale) == (401, "session_expired")
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert active_sessions(db_engine, owner) == 0 and holder.me().status_code == 401
    assert events(db_engine, owner, "password_changed") == 0
    assert events(db_engine, owner, "password_reset_completed") == 1
    assert mails(world, "password_changed") == 1  # the reset's notice only


def test_a_reset_after_a_password_change_wins_and_ends_the_changers_session(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    holder = browser(world, EMAIL)
    token = reset_token(world)

    changed, done = queued(
        db_engine, monkeypatch, change(holder, THIRD_PASSWORD), reset(world, token)
    )

    assert (changed.status_code, done.status_code) == (200, 204)
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert active_sessions(db_engine, owner) == 0 and holder.me().status_code == 401


# == 2. a password reset against a sign-in that checked the OLD password ============================


@pytest.mark.parametrize("order", ORDERS)
def test_a_sign_in_with_the_old_password_gets_no_session_once_a_reset_commits(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner = account(world, db_engine)
    token = reset_token(world)
    api, attempt = sign_in(world)

    stale, done = stage(order, db_engine, monkeypatch, attempt, reset(world, token))

    assert done.status_code == 204
    assert error_code(stale) == (401, "invalid_credentials")
    assert not has_session_cookie(stale, world) and api.me().status_code == 401
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert active_sessions(db_engine, owner) == 0
    assert events(db_engine, owner, "login_success") == 0
    assert events(db_engine, owner, "login_failure") == 1
    assert (
        scalar(
            db_engine,
            "SELECT coalesce(sum(count), 0) FROM auth_rate_limits WHERE policy = 'login_failures'",
        )
        == 1
    )
    assert mails(world, "login_notice") == 0


def test_a_reset_after_a_sign_in_revokes_the_new_session(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    token = reset_token(world)
    api, attempt = sign_in(world)

    signed_in, done = queued(db_engine, monkeypatch, attempt, reset(world, token))

    assert (signed_in.status_code, done.status_code) == (200, 204)
    assert api.me().status_code == 401 and active_sessions(db_engine, owner) == 0


@pytest.mark.parametrize("order", ORDERS)
def test_a_hash_upgrade_by_a_stale_sign_in_cannot_bring_the_old_password_back(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    """A sign-in re-hashes the password it verified when the stored parameters are outdated."""
    owner = account(world, db_engine)
    token = reset_token(world)
    monkeypatch.setattr(PasswordService, "needs_rehash", lambda self, stored: True)
    _, attempt = sign_in(world)

    stale, done = stage(order, db_engine, monkeypatch, attempt, reset(world, token))

    assert done.status_code == 204
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert error_code(stale) == (401, "invalid_credentials")
    assert active_sessions(db_engine, owner) == 0


@pytest.mark.parametrize("order", ORDERS)
def test_two_sign_ins_that_both_upgrade_the_hash_both_succeed(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    """The stored hash changes under the second one, but the password does not."""
    owner = account(world, db_engine)
    monkeypatch.setattr(PasswordService, "needs_rehash", lambda self, stored: True)
    _, first = sign_in(world)
    _, second = sign_in(world)

    one, two = stage(order, db_engine, monkeypatch, first, second)

    assert (one.status_code, two.status_code) == (200, 200)
    only_password(world, db_engine, owner, PASSWORD)
    assert active_sessions(db_engine, owner) == 2
    assert events(db_engine, owner, "login_failure") == 0


def test_a_password_change_survives_a_hash_upgrade_by_a_concurrent_sign_in(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    holder = browser(world, EMAIL)
    monkeypatch.setattr(PasswordService, "needs_rehash", lambda self, stored: True)
    _, attempt = sign_in(world)

    changed, signed_in = overtaken(monkeypatch, change(holder, THIRD_PASSWORD), attempt)

    assert (changed.status_code, signed_in.status_code) == (200, 200)
    only_password(world, db_engine, owner, THIRD_PASSWORD)
    assert active_sessions(db_engine, owner) == 1  # the change revoked the other sign-in


# == 3. several password changes, and a session that ends during one ================================


@pytest.mark.parametrize("order", ORDERS)
def test_of_two_changes_from_two_sessions_only_the_first_to_commit_applies(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner = account(world, db_engine)
    late, early = browser(world, EMAIL), browser(world, EMAIL)

    stale, done = stage(
        order, db_engine, monkeypatch, change(late, THIRD_PASSWORD), change(early, OTHER_PASSWORD)
    )

    assert done.status_code == 200
    assert error_code(stale) == (401, "session_expired")
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert active_sessions(db_engine, owner) == 1 and late.me().status_code == 401
    assert events(db_engine, owner, "password_changed") == 1


@pytest.mark.parametrize("order", ORDERS)
def test_of_two_changes_from_one_session_only_the_first_to_commit_applies(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    """The session survives the first change (rotated), so only the password tells them apart."""
    owner = account(world, db_engine)
    holder = browser(world, EMAIL)
    twin = same_session(holder, world)

    stale, done = stage(
        order, db_engine, monkeypatch, change(twin, THIRD_PASSWORD), change(holder, OTHER_PASSWORD)
    )

    assert done.status_code == 200
    assert error_code(stale) == (401, "invalid_credentials")
    assert not has_session_cookie(stale, world)
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert active_sessions(db_engine, owner) == 1 and holder.me().status_code == 200
    assert events(db_engine, owner, "password_changed") == 1


def _by_logout(env: AuthEnv, engine: Engine, holder: AuthApi) -> Callable[[], None]:
    twin = same_session(holder, env)
    return lambda: _expect(twin.logout, 204)


def _by_logout_all(env: AuthEnv, engine: Engine, holder: AuthApi) -> Callable[[], None]:
    other = browser(env, EMAIL)
    return lambda: _expect(lambda: other.post("/auth/logout-all"), 204)


def _by_the_session_cap(env: AuthEnv, engine: Engine, holder: AuthApi) -> Callable[[], None]:
    for _ in range(SESSION_CAP - 1):
        env.clock.advance(seconds=1)
        browser(env, EMAIL)
    _, one_more = sign_in(env)
    return lambda: _expect(one_more, 200)


def _by_staff_removal(env: AuthEnv, engine: Engine, holder: AuthApi) -> Callable[[], None]:
    make_account(env.session, "boss@example.org", admin=True)
    boss = browser(env, "boss@example.org")
    target = user_id(engine, EMAIL)
    return lambda: _expect(lambda: boss.request("DELETE", f"/admin/staff/moderators/{target}"), 204)


def _sql(engine: Engine, statement: str) -> Callable[[], None]:
    def apply() -> None:
        with engine.begin() as connection:
            connection.execute(text(statement), {"e": EMAIL})

    return apply


def _by_suspension(env: AuthEnv, engine: Engine, holder: AuthApi) -> Callable[[], None]:
    return _sql(engine, "UPDATE users SET status = 'suspended' WHERE email = :e")


def _by_expiry(env: AuthEnv, engine: Engine, holder: AuthApi) -> Callable[[], None]:
    return lambda: env.clock.advance(days=400)


def _expect(request: Request, status: int) -> None:
    assert Running(request).finish().status_code == status


ENDINGS = {
    "logout": _by_logout,
    "logout-all": _by_logout_all,
    "session cap": _by_the_session_cap,
    "staff role removal": _by_staff_removal,
    "account suspension": _by_suspension,
    "session expiry": _by_expiry,
}


@pytest.mark.parametrize("ending", list(ENDINGS))
def test_a_session_that_ends_during_a_password_change_changes_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, ending: str
) -> None:
    moderator = [StaffScope.FOOD] if ending == "staff role removal" else None
    owner = account(world, db_engine, moderator_scopes=moderator)
    holder = browser(world, EMAIL)
    end_the_session = ENDINGS[ending](world, db_engine, holder)
    gate = gate_method(monkeypatch, *LOCK, after=False)
    attempt = Running(change(holder, THIRD_PASSWORD))
    gate.wait_arrived()  # the current password has been verified

    end_the_session()
    gate.release.set()

    assert error_code(attempt.finish()) == (401, "session_expired")
    only_password(world, db_engine, owner, PASSWORD)
    assert events(db_engine, owner, "password_changed") == 0
    assert mails(world, "password_changed") == 0


@pytest.mark.parametrize(
    ("status", "expected"),
    [("suspended", (403, "account_disabled")), ("deleted", (401, "invalid_credentials"))],
)
def test_a_sign_in_obeys_an_account_status_that_changes_after_the_password_check(
    db_engine: Engine,
    world: AuthEnv,
    monkeypatch: pytest.MonkeyPatch,
    status: str,
    expected: tuple[int, str],
) -> None:
    owner = account(world, db_engine)
    _, attempt = sign_in(world)
    gate = gate_method(monkeypatch, *LOCK, after=False)
    pending = Running(attempt)
    gate.wait_arrived()

    _sql(db_engine, f"UPDATE users SET status = '{status}' WHERE email = :e")()  # noqa: S608
    gate.release.set()

    assert error_code(pending.finish()) == expected
    assert active_sessions(db_engine, owner) == 0


# == 4. e-mail verification against reset and resend (formerly deadlocks) ===========================


def test_a_verification_arriving_during_a_reset_waits_and_finds_its_token_retired(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _, verification = unverified_account(world, db_engine)
    token = reset_token(world)

    done, late = queued(db_engine, monkeypatch, reset(world, token), verify(world, verification))

    assert done.status_code == 204
    assert error_code(late) == (400, "token_invalid")
    assert verified(db_engine, owner)  # the reset link proved the mailbox
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert live_tokens(db_engine, owner, "email_verification") == 0
    assert live_tokens(db_engine, owner, "password_reset") == 0
    assert events(db_engine, owner, "email_verified") == 1
    assert active_sessions(db_engine, owner) == 0


def test_a_reset_arriving_during_a_verification_waits_and_both_apply(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _, verification = unverified_account(world, db_engine)
    token = reset_token(world)

    first, second = queued(db_engine, monkeypatch, verify(world, verification), reset(world, token))

    assert (first.status_code, second.status_code) == (204, 204)
    assert verified(db_engine, owner)
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert events(db_engine, owner, "email_verified") == 1
    assert active_sessions(db_engine, owner) == 0


def test_a_verification_arriving_during_a_resend_waits_and_only_the_new_token_works(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, api, old = unverified_account(world, db_engine)

    resent, late = queued(
        db_engine,
        monkeypatch,
        lambda: api.post("/auth/resend-verification"),
        verify(world, old),
    )

    assert resent.status_code == 204
    assert error_code(late) == (400, "token_invalid")
    assert not verified(db_engine, owner)
    assert live_tokens(db_engine, owner, "email_verification") == 1
    newest = last_token(world, "email_verification")
    assert newest != old and verify(world, newest)().status_code == 204
    assert verified(db_engine, owner)


def test_a_resend_arriving_during_a_verification_waits_and_sends_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The resend authenticated while the account was unverified: it must read it again."""
    owner, api, token = unverified_account(world, db_engine)
    sent_before = mails(world, "email_verification")

    first, resent = queued(
        db_engine, monkeypatch, verify(world, token), lambda: api.post("/auth/resend-verification")
    )

    assert (first.status_code, resent.status_code) == (204, 204)
    assert verified(db_engine, owner)
    assert mails(world, "email_verification") == sent_before
    assert live_tokens(db_engine, owner, "email_verification") == 0


# == 5. one-time tokens: single use, expiry and replacement are decided under the lock ==============


@pytest.mark.parametrize("order", ORDERS)
def test_one_reset_token_used_twice_at_once_applies_once(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner = account(world, db_engine)
    token = reset_token(world)

    stale, done = stage(
        order,
        db_engine,
        monkeypatch,
        reset(world, token, THIRD_PASSWORD),
        reset(world, token, OTHER_PASSWORD),
    )

    assert done.status_code == 204
    assert error_code(stale) == (400, "token_invalid")
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert events(db_engine, owner, "password_reset_completed") == 1


@pytest.mark.parametrize("order", ORDERS)
def test_one_verification_token_used_twice_at_once_applies_once(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner, _, token = unverified_account(world, db_engine)

    stale, done = stage(order, db_engine, monkeypatch, verify(world, token), verify(world, token))

    assert done.status_code == 204
    assert error_code(stale) == (400, "token_invalid")
    assert verified(db_engine, owner) and events(db_engine, owner, "email_verified") == 1


@pytest.mark.parametrize("kind", ["reset", "verification"])
def test_a_token_that_expires_before_the_lock_is_refused_and_not_spent(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    owner, _, verification = unverified_account(world, db_engine)
    token = reset_token(world) if kind == "reset" else verification
    request = reset(world, token) if kind == "reset" else verify(world, token)
    gate = gate_method(monkeypatch, *LOCK, after=False)
    pending = Running(request)
    gate.wait_arrived()  # the token has been looked at once

    world.clock.now += timedelta(days=2)
    gate.release.set()

    assert error_code(pending.finish()) == (400, "token_expired")
    only_password(world, db_engine, owner, PASSWORD)
    assert not verified(db_engine, owner)
    purpose = "password_reset" if kind == "reset" else "email_verification"
    assert live_tokens(db_engine, owner, purpose) == 1


def test_a_reset_whose_token_is_replaced_before_the_lock_changes_nothing(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    token = reset_token(world)

    stale, asked = overtaken(monkeypatch, reset(world, token), forgot(world))

    assert asked.status_code == 202
    assert error_code(stale) == (400, "token_invalid")
    only_password(world, db_engine, owner, PASSWORD)
    assert live_tokens(db_engine, owner, "password_reset") == 1


def test_a_forgot_password_arriving_during_a_reset_waits_without_deadlock(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    token = reset_token(world)

    done, asked = queued(db_engine, monkeypatch, reset(world, token), forgot(world))

    assert (done.status_code, asked.status_code) == (204, 202)
    only_password(world, db_engine, owner, OTHER_PASSWORD)
    assert live_tokens(db_engine, owner, "password_reset") == 1


def test_a_reset_arriving_while_a_new_link_is_issued_finds_the_old_token_retired(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    token = reset_token(world)

    asked, late = queued(
        db_engine, monkeypatch, forgot(world), reset(world, token), (TokenRepository, "add")
    )

    assert asked.status_code == 202
    assert error_code(late) == (400, "token_invalid")
    only_password(world, db_engine, owner, PASSWORD)
    assert live_tokens(db_engine, owner, "password_reset") == 1


def test_two_forgot_password_requests_leave_exactly_one_live_link(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account(world, db_engine)
    gate = gate_method(monkeypatch, TokenRepository, "add", after=True)
    first = Running(forgot(world))
    gate.wait_arrived()  # its new token is written, not committed

    second = Running(forgot(world))
    wait_until(
        lambda: not second.running or waiting(db_engine, "%") == 1,
        "the second request to finish or to wait",
    )
    gate.release.set()

    assert (first.finish().status_code, second.finish().status_code) == (202, 202)
    assert live_tokens(db_engine, owner, "password_reset") == 1


# == 6. Google: claiming an unverified account while someone is using it ============================


class Squatted:
    """Someone registered the address with a password and is signed in; its real owner is about to
    sign in with Google, which claims the account."""

    def __init__(self, env: AuthEnv, engine: Engine) -> None:
        self.env = env
        self.owner, self.squatter, self.verification = unverified_account(env, engine)
        self.reset = reset_token(env)
        self.owner_api = env.client()
        self.started: Started = started_ok(self.owner_api)

    def claim(self) -> Response:
        return callback(self.owner_api, google_code(email=EMAIL), state=self.started.state)


def claimed(case: Squatted, engine: Engine) -> None:
    """The account belongs to the Google user alone: no password, one session."""
    assert verified(engine, case.owner)
    assert scalar(engine, "SELECT password_hash FROM users WHERE id = :u", u=case.owner) is None
    assert active_sessions(engine, case.owner) == 1
    assert case.owner_api.me().status_code == 200
    assert case.squatter.me().status_code == 401
    assert events(engine, case.owner, "account_claimed") == 1


@pytest.mark.parametrize("order", ORDERS)
def test_a_squatters_sign_in_gets_no_session_in_a_claimed_account(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    case = Squatted(world, db_engine)
    api, attempt = sign_in(world)

    stale, claim = stage(order, db_engine, monkeypatch, attempt, case.claim, LOCK_BY_EMAIL)

    assert location(claim) == f"{ORIGIN}/"
    assert error_code(stale) == (401, "invalid_credentials")
    assert api.me().status_code == 401
    claimed(case, db_engine)


def test_a_claim_arriving_during_a_squatters_sign_in_revokes_that_session(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = Squatted(world, db_engine)
    api, attempt = sign_in(world)

    signed_in, claim = queued(db_engine, monkeypatch, attempt, case.claim)

    assert signed_in.status_code == 200 and location(claim) == f"{ORIGIN}/"
    assert api.me().status_code == 401
    claimed(case, db_engine)


@pytest.mark.parametrize("order", ORDERS)
def test_a_squatters_password_change_cannot_put_a_password_back_on_a_claimed_account(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    case = Squatted(world, db_engine)

    stale, claim = stage(
        order,
        db_engine,
        monkeypatch,
        change(case.squatter, THIRD_PASSWORD),
        case.claim,
        LOCK_BY_EMAIL,
    )

    assert location(claim) == f"{ORIGIN}/"
    claimed(case, db_engine)
    assert error_code(stale) == (401, "session_expired")


@pytest.mark.parametrize("with_token", ["verification", "reset"])
def test_a_token_arriving_during_a_claim_waits_and_is_retired(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, with_token: str
) -> None:
    case = Squatted(world, db_engine)
    request = (
        verify(world, case.verification)
        if with_token == "verification"
        else reset(world, case.reset)
    )

    claim, late = queued(db_engine, monkeypatch, case.claim, request, LOCK_BY_EMAIL)

    assert location(claim) == f"{ORIGIN}/"
    assert error_code(late) == (400, "token_invalid")
    claimed(case, db_engine)


@pytest.mark.parametrize("with_token", ["verification", "reset"])
def test_a_claim_arriving_after_the_mailbox_is_proven_is_a_conflict(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, with_token: str
) -> None:
    case = Squatted(world, db_engine)
    request = (
        verify(world, case.verification)
        if with_token == "verification"
        else reset(world, case.reset)
    )

    first, claim = queued(db_engine, monkeypatch, request, case.claim)

    assert first.status_code == 204
    assert location(claim) == error_url("identity_conflict")
    assert verified(db_engine, case.owner)
    assert scalar(db_engine, "SELECT count(*) FROM auth_identities") == 0
    assert events(db_engine, case.owner, "account_claimed") == 0
    expected = PASSWORD if with_token == "verification" else OTHER_PASSWORD
    only_password(world, db_engine, case.owner, expected)


def test_a_forgot_password_arriving_during_a_claim_waits_without_deadlock(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = Squatted(world, db_engine)

    claim, asked = queued(db_engine, monkeypatch, case.claim, forgot(world), LOCK_BY_EMAIL)

    assert location(claim) == f"{ORIGIN}/" and asked.status_code == 202
    claimed(case, db_engine)


# == 7. Google: a removed identity or an ended session authorizes nothing ===========================


def linked_account(env: AuthEnv, engine: Engine) -> tuple[uuid.UUID, AuthApi]:
    owner = account(env, engine)
    api = browser(env, EMAIL)
    started = started_ok(api, purpose="link")
    assert location(callback(api, google_code(email=EMAIL), state=started.state)) == f"{ORIGIN}/"
    return owner, api


def identity_count(engine: Engine) -> int:
    return int(scalar(engine, "SELECT count(*) FROM auth_identities"))


@pytest.mark.parametrize("order", ORDERS)
def test_a_google_sign_in_through_an_identity_removed_meanwhile_gets_no_session(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner, api = linked_account(world, db_engine)
    arriving = world.client()
    started = started_ok(arriving)
    before = active_sessions(db_engine, owner)

    stale, removed = stage(
        order,
        db_engine,
        monkeypatch,
        lambda: callback(arriving, google_code(email=EMAIL), state=started.state),
        lambda: api.request("DELETE", DISCONNECT),
    )

    assert removed.status_code == 204
    assert location(stale) == error_url("identity_conflict")  # as if it had arrived afterwards
    assert not has_session_cookie(stale, world)
    assert identity_count(db_engine) == 0 and active_sessions(db_engine, owner) == before


@pytest.mark.parametrize("order", ORDERS)
def test_a_session_ended_by_a_reset_cannot_finish_linking_google(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner = account(world, db_engine)
    holder = browser(world, EMAIL)
    started = started_ok(holder, purpose="link")
    token = reset_token(world)

    stale, done = stage(
        order,
        db_engine,
        monkeypatch,
        lambda: callback(holder, google_code(email=EMAIL), state=started.state),
        reset(world, token),
    )

    assert done.status_code == 204
    assert location(stale) == error_url("oauth_failed")
    assert identity_count(db_engine) == 0 and active_sessions(db_engine, owner) == 0
    assert events(db_engine, owner, "identity_linked") == 0


@pytest.mark.parametrize("order", ORDERS)
def test_a_session_ended_by_a_reset_cannot_disconnect_google(
    db_engine: Engine, world: AuthEnv, monkeypatch: pytest.MonkeyPatch, order: str
) -> None:
    owner, holder = linked_account(world, db_engine)
    token = reset_token(world)

    stale, done = stage(
        order,
        db_engine,
        monkeypatch,
        lambda: holder.request("DELETE", DISCONNECT),
        reset(world, token),
    )

    assert done.status_code == 204
    assert error_code(stale) == (401, "session_expired")
    assert identity_count(db_engine) == 1
    assert events(db_engine, owner, "identity_unlinked") == 0
    only_password(world, db_engine, owner, OTHER_PASSWORD)
