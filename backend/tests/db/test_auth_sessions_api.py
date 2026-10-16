"""/auth/me, logout, logout-all, session lifetime and revocation (real PostgreSQL)."""

from datetime import timedelta

from sqlalchemy import select, update

from app.core.security.tokens import csrf_token_for
from app.models import AuthSession, User
from app.models.enums import AuthEventType, PlanCode, SessionRevokeReason
from tests.db.auth_helpers import (
    PASSWORD,
    AuthEnv,
    active_sessions_of,
    events_of,
    make_account,
    sessions_of,
)


def signed_in(env: AuthEnv, **account: object):  # type: ignore[no-untyped-def]
    user = make_account(env.session, **account)  # type: ignore[arg-type]
    api = env.client()
    assert api.login().status_code == 200
    return user, api


# -- /auth/me --------------------------------------------------------------------------------------


def test_me_is_unauthenticated_without_a_session(auth_env: AuthEnv) -> None:
    response = auth_env.client().me()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers


def test_me_returns_exactly_the_approved_fields(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env, professional=PlanCode.PREMIUM, admin=True)

    response = api.me()

    data = response.json()["data"]
    assert response.status_code == 200
    assert set(data) == {
        "id",
        "displayName",
        "email",
        "emailVerified",
        "roles",
        "professional",
        "authMethods",
        "session",
        "csrfToken",
    }
    assert data["roles"] == ["admin"] and data["professional"] == {"planCode": "premium"}
    assert set(data["session"]) == {"expiresAt"}
    assert response.headers["cache-control"] == "no-store"
    body = response.text.lower()
    for forbidden in ("argon2", "hash", "provider_subject", "providersubject", "revoke"):
        assert forbidden not in body
    assert api.session_cookie not in response.text


def test_me_csrf_token_is_derived_from_the_cookie_and_stable(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)

    first = api.me().json()["data"]["csrfToken"]
    second = api.me().json()["data"]["csrfToken"]

    assert first == second == csrf_token_for(api.session_cookie or "")


def test_a_professional_is_a_capability_not_a_role(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env, professional=PlanCode.FREE)

    data = api.me().json()["data"]

    assert data["roles"] == [] and data["professional"] == {"planCode": "free"}


def test_garbage_and_unknown_cookies_are_plainly_unauthenticated(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    for cookie in ("garbage", "A" * 43, "A" * 500):
        response = api.me(headers={"Cookie": f"{api.cookie_name}={cookie}"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthenticated"
        assert "set-cookie" not in response.headers  # nothing revealed about existence


# -- lifetime ----------------------------------------------------------------------------------------


def test_an_idle_session_expires_after_fourteen_days(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)
    auth_env.clock.advance(days=13, hours=23)
    assert api.me().status_code == 200  # slid forward by this very request

    auth_env.clock.advance(days=14, minutes=1)
    response = api.me()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "session_expired"
    cleared = response.headers["set-cookie"].lower()
    assert cleared.startswith("b17_session=") and "max-age=0" in cleared


def test_a_session_never_outlives_its_thirty_day_absolute_limit(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    for days in (10, 10, 9):  # active every ~10 days: the idle timer keeps sliding...
        auth_env.clock.advance(days=days)
        assert api.me().status_code == 200
    (row,) = active_sessions_of(auth_env.session, user.id)
    assert row.expires_at == row.absolute_expires_at  # ...but is capped at day 30

    auth_env.clock.advance(days=2)  # day 31
    response = api.me()

    assert response.status_code == 401 and response.json()["error"]["code"] == "session_expired"


def test_last_seen_is_written_at_most_every_five_minutes(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    (row,) = active_sessions_of(auth_env.session, user.id)
    first_seen = row.last_seen_at

    auth_env.clock.advance(minutes=4)
    quiet = api.me()
    auth_env.session.refresh(row)
    assert row.last_seen_at == first_seen
    assert "set-cookie" not in quiet.headers  # the cookie is only re-issued when the session slid

    auth_env.clock.advance(minutes=2)  # 6 minutes since the last write
    slid = api.me()
    auth_env.session.refresh(row)
    assert row.last_seen_at == auth_env.clock()
    assert "max-age=" in slid.headers["set-cookie"].lower()
    assert slid.headers["set-cookie"].split("=", 1)[1].split(";")[0] == api.session_cookie


def test_an_expired_session_row_is_not_authenticated_even_if_it_still_exists(
    auth_env: AuthEnv,
) -> None:
    user, api = signed_in(auth_env)
    auth_env.session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id)
        .values(expires_at=auth_env.clock() - timedelta(seconds=1))
    )
    auth_env.session.commit()

    assert api.me().json()["error"]["code"] == "session_expired"


# -- revocation -----------------------------------------------------------------------------------------


def test_a_revoked_session_stops_working_immediately(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    auth_env.session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id)
        .values(revoked_at=auth_env.clock(), revoke_reason=SessionRevokeReason.ADMIN_ACTION)
    )
    auth_env.session.commit()

    response = api.me()

    assert response.status_code == 401 and response.json()["error"]["code"] == "session_expired"


def test_suspending_an_account_invalidates_existing_cookies_at_once(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    assert api.me().status_code == 200
    auth_env.session.execute(update(User).where(User.id == user.id).values(status="suspended"))
    auth_env.session.commit()

    response = api.me()

    assert response.status_code == 401 and response.json()["error"]["code"] == "session_expired"


def test_logout_revokes_the_session_server_side_and_clears_the_cookie(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    token = api.session_cookie

    response = api.logout()

    assert response.status_code == 204
    cleared = response.headers["set-cookie"].lower()
    assert "max-age=0" in cleared and "httponly" in cleared and "path=/" in cleared
    assert response.headers["cache-control"] == "no-store"
    (row,) = sessions_of(auth_env.session, user.id)
    assert row.revoked_at is not None and row.revoke_reason == "logout"
    # replaying the old cookie (an attacker who copied it) fails: deleting the cookie is not enough
    thief = auth_env.client()
    stolen = thief.me(headers={"Cookie": f"{thief.cookie_name}={token}"})
    assert stolen.status_code == 401 and stolen.json()["error"]["code"] == "session_expired"
    kinds = [e.event_type for e in events_of(auth_env.session, user.id)]
    assert AuthEventType.LOGOUT in kinds


def test_logout_only_ends_the_current_device(auth_env: AuthEnv) -> None:
    user, phone = signed_in(auth_env)
    laptop = auth_env.client()
    laptop.login()

    phone.logout()

    assert phone.me().status_code == 401
    assert laptop.me().status_code == 200
    assert len(active_sessions_of(auth_env.session, user.id)) == 1


def test_logout_all_revokes_every_device_and_audits(auth_env: AuthEnv) -> None:
    user, phone = signed_in(auth_env)
    laptop, tablet = auth_env.client(), auth_env.client()
    laptop.login()
    tablet.login()

    response = laptop.post("/auth/logout-all")

    assert response.status_code == 204 and "max-age=0" in response.headers["set-cookie"].lower()
    assert active_sessions_of(auth_env.session, user.id) == []
    assert all(device.me().status_code == 401 for device in (phone, laptop, tablet))
    reasons = set(auth_env.session.scalars(select(AuthSession.revoke_reason)))
    assert reasons == {SessionRevokeReason.LOGOUT_ALL}
    assert AuthEventType.LOGOUT_ALL in [e.event_type for e in events_of(auth_env.session, user.id)]


def test_logout_without_a_session_is_unauthenticated(auth_env: AuthEnv) -> None:
    response = auth_env.client().logout()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_sessions_belong_to_one_user_only(auth_env: AuthEnv) -> None:
    alice, alice_api = signed_in(auth_env)
    bob = make_account(auth_env.session, "bob@example.org", display_name="Bob Khan")
    bob_api = auth_env.client()
    bob_api.login(email="bob@example.org", password=PASSWORD)

    alice_api.post("/auth/logout-all")

    assert bob_api.me().status_code == 200
    assert len(active_sessions_of(auth_env.session, bob.id)) == 1
    assert active_sessions_of(auth_env.session, alice.id) == []
