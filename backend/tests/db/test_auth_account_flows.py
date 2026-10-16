"""Email verification, resend, forgot/reset password and change password (real PostgreSQL)."""

from sqlalchemy import select, update

from app.core.security.tokens import csrf_token_for, hash_token, new_token
from app.models import AuthSession, AuthToken, User
from app.models.enums import AuthEventType, AuthTokenPurpose
from tests.db.auth_helpers import (
    OTHER_PASSWORD,
    PASSWORD,
    AuthEnv,
    active_sessions_of,
    events_of,
    last_token,
    make_account,
    sessions_of,
    token_row,
)

EMAIL = "ayesha@example.org"


def refreshed(env: AuthEnv, user: User) -> User:
    env.session.refresh(user)
    return user


def registered(env: AuthEnv):  # type: ignore[no-untyped-def]
    api = env.client()
    assert api.register().status_code == 201
    user = env.session.scalars(select(User)).one()
    return api, user


# -- verify email ---------------------------------------------------------------------------------------


def test_verifying_with_the_emailed_token_marks_the_account_verified(auth_env: AuthEnv) -> None:
    api, user = registered(auth_env)
    token = last_token(auth_env, "email_verification")

    response = api.post("/auth/verify-email", {"token": token})

    assert response.status_code == 204
    assert refreshed(auth_env, user).email_verified_at == auth_env.clock()
    row = token_row(auth_env.session, token)
    assert row is not None and row.consumed_at is not None
    assert AuthEventType.EMAIL_VERIFIED in [e.event_type for e in events_of(auth_env.session)]
    assert api.me().json()["data"]["emailVerified"] is True


def test_verification_works_without_a_session(auth_env: AuthEnv) -> None:
    _, user = registered(auth_env)
    token = last_token(auth_env, "email_verification")

    assert auth_env.client().post("/auth/verify-email", {"token": token}).status_code == 204
    assert refreshed(auth_env, user).email_verified_at is not None


def test_a_verification_token_works_exactly_once(auth_env: AuthEnv) -> None:
    api, _ = registered(auth_env)
    token = last_token(auth_env, "email_verification")
    assert api.post("/auth/verify-email", {"token": token}).status_code == 204

    reused = api.post("/auth/verify-email", {"token": token})

    assert reused.status_code == 400 and reused.json()["error"]["code"] == "token_invalid"


def test_an_expired_verification_token_is_rejected(auth_env: AuthEnv) -> None:
    api, user = registered(auth_env)
    token = last_token(auth_env, "email_verification")
    auth_env.clock.advance(hours=24, seconds=1)

    response = api.post("/auth/verify-email", {"token": token})

    assert response.status_code == 400 and response.json()["error"]["code"] == "token_expired"
    assert refreshed(auth_env, user).email_verified_at is None
    row = token_row(auth_env.session, token)
    assert row is not None and row.consumed_at is None  # an expired attempt does not consume


def test_unknown_malformed_and_wrong_purpose_tokens_are_all_token_invalid(
    auth_env: AuthEnv,
) -> None:
    api, user = registered(auth_env)
    # a password-reset token must not verify an email (and vice versa)
    api.post("/auth/forgot-password", {"email": EMAIL})
    reset_token = last_token(auth_env, "password_reset")
    verification = last_token(auth_env, "email_verification")

    for token in (new_token(), "short", "", reset_token):
        response = api.post("/auth/verify-email", {"token": token})
        assert response.status_code == 400, token
        assert response.json()["error"]["code"] == "token_invalid"
    wrong_way = api.post(
        "/auth/reset-password", {"token": verification, "newPassword": OTHER_PASSWORD}
    )
    assert wrong_way.json()["error"]["code"] == "token_invalid"
    assert refreshed(auth_env, user).email_verified_at is None  # nothing was consumed or verified
    assert api.post("/auth/verify-email", {"token": verification}).status_code == 204


def test_an_oversized_token_is_a_validation_error(auth_env: AuthEnv) -> None:
    response = auth_env.client().post("/auth/verify-email", {"token": "A" * 500})

    assert response.status_code == 422 and "A" * 50 not in response.text


def test_a_token_for_a_changed_address_cannot_verify_the_new_one(auth_env: AuthEnv) -> None:
    api, user = registered(auth_env)
    token = last_token(auth_env, "email_verification")
    auth_env.session.execute(
        update(User).where(User.id == user.id).values(email="new-address@example.org")
    )
    auth_env.session.commit()

    response = api.post("/auth/verify-email", {"token": token})

    assert response.json()["error"]["code"] == "token_invalid"
    assert refreshed(auth_env, user).email_verified_at is None


# -- resend verification -----------------------------------------------------------------------------------


def test_resend_requires_a_session_and_the_csrf_token(auth_env: AuthEnv) -> None:
    anonymous = auth_env.client().post("/auth/resend-verification")
    assert anonymous.status_code == 401

    api, _ = registered(auth_env)
    assert api.post("/auth/resend-verification", csrf=None).status_code == 403
    assert api.post("/auth/resend-verification", csrf="wrong").status_code == 403


def test_resend_issues_a_fresh_token_and_retires_the_old_one(auth_env: AuthEnv) -> None:
    api, user = registered(auth_env)
    first = last_token(auth_env, "email_verification")
    auth_env.clock.advance(minutes=2)

    response = api.post("/auth/resend-verification")

    assert response.status_code == 204
    second = last_token(auth_env, "email_verification")
    assert second != first
    assert len([m for m in auth_env.outbox.outbox if m.kind == "email_verification"]) == 2
    assert (
        api.post("/auth/verify-email", {"token": first}).json()["error"]["code"] == "token_invalid"
    )
    assert api.post("/auth/verify-email", {"token": second}).status_code == 204
    assert refreshed(auth_env, user).email_verified_at is not None


def test_resend_is_a_silent_noop_for_a_verified_account(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    api.login()

    assert api.post("/auth/resend-verification").status_code == 204

    assert auth_env.outbox.outbox == []


def test_resend_is_throttled_per_minute_and_per_day(auth_env: AuthEnv) -> None:
    api, _ = registered(auth_env)

    assert api.post("/auth/resend-verification").status_code == 204  # 1st this minute
    burst = api.post("/auth/resend-verification")
    assert burst.status_code == 429 and int(burst.headers["retry-after"]) > 0

    for _ in range(4):  # one a minute: attempts 2..5 of the day
        auth_env.clock.advance(seconds=61)
        assert api.post("/auth/resend-verification").status_code == 204
    auth_env.clock.advance(seconds=61)
    assert api.post("/auth/resend-verification").status_code == 429  # the 6th today


# -- forgot password -----------------------------------------------------------------------------------------


def test_forgot_password_answers_identically_for_known_and_unknown_accounts(
    auth_env: AuthEnv,
) -> None:
    make_account(auth_env.session)

    known = auth_env.client().post("/auth/forgot-password", {"email": EMAIL})
    unknown = auth_env.client().post("/auth/forgot-password", {"email": "ghost@example.org"})
    malformed = auth_env.client().post("/auth/forgot-password", {"email": "not an email"})

    for response in (known, unknown, malformed):
        assert response.status_code == 202
        assert response.json() == {"data": {"status": "accepted"}}
        assert response.headers["cache-control"] == "no-store"
    assert [m.to for m in auth_env.outbox.outbox] == [EMAIL]  # only the real account got mail


def test_forgot_password_issues_a_one_hour_hashed_fragment_token(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)

    auth_env.client().post("/auth/forgot-password", {"email": " AYESHA@example.ORG "})

    token = last_token(auth_env, "password_reset")
    assert auth_env.outbox.last("password_reset").link.startswith(  # type: ignore[union-attr]
        "http://127.0.0.1:5173/reset-password#token="
    )
    row = token_row(auth_env.session, token)
    assert row is not None and row.purpose is AuthTokenPurpose.PASSWORD_RESET
    assert (row.expires_at - row.created_at).total_seconds() == 3600
    assert token.encode() not in bytes(row.token_hash) and len(row.token_hash) == 32
    assert AuthEventType.PASSWORD_RESET_REQUESTED in [
        e.event_type for e in events_of(auth_env.session, user.id)
    ]


def test_a_new_reset_request_retires_the_previous_token(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    api.post("/auth/forgot-password", {"email": EMAIL})
    first = last_token(auth_env, "password_reset")
    api.post("/auth/forgot-password", {"email": EMAIL})
    second = last_token(auth_env, "password_reset")

    old = api.post("/auth/reset-password", {"token": first, "newPassword": OTHER_PASSWORD})
    new = api.post("/auth/reset-password", {"token": second, "newPassword": OTHER_PASSWORD})

    assert old.json()["error"]["code"] == "token_invalid" and new.status_code == 204


def test_suspended_accounts_get_the_same_answer_but_no_email(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, status="suspended")

    response = auth_env.client().post("/auth/forgot-password", {"email": EMAIL})

    assert response.status_code == 202 and auth_env.outbox.outbox == []


def test_forgot_password_is_rate_limited_per_email(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    assert [api.post("/auth/forgot-password", {"email": EMAIL}).status_code for _ in range(3)] == [
        202,
        202,
        202,
    ]

    blocked = api.post("/auth/forgot-password", {"email": EMAIL})

    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "rate_limited"
    # the limit is per attempted address, so it reveals nothing about whether it exists
    for _ in range(3):
        auth_env.client().post("/auth/forgot-password", {"email": "ghost@example.org"})
    assert (
        auth_env.client().post("/auth/forgot-password", {"email": "ghost@example.org"}).status_code
        == 429
    )


# -- reset password ------------------------------------------------------------------------------------------


def request_reset(env: AuthEnv, email: str = EMAIL) -> str:
    env.client().post("/auth/forgot-password", {"email": email})
    return last_token(env, "password_reset")


def test_reset_sets_the_password_revokes_every_session_and_does_not_log_in(
    auth_env: AuthEnv,
) -> None:
    user = make_account(auth_env.session)
    phone, laptop = auth_env.client(), auth_env.client()
    phone.login()
    laptop.login()
    token = request_reset(auth_env)
    browser = auth_env.client()

    response = browser.post("/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD})

    assert response.status_code == 204
    assert "set-cookie" not in response.headers and browser.session_cookie is None  # no auto-login
    assert active_sessions_of(auth_env.session, user.id) == []
    assert {s.revoke_reason for s in sessions_of(auth_env.session, user.id)} == {"password_reset"}
    assert phone.me().json()["error"]["code"] == "session_expired"  # the stale cookie is dead
    assert auth_env.client().login(password=PASSWORD).status_code == 401
    assert auth_env.client().login(password=OTHER_PASSWORD).status_code == 200
    kinds = [e.event_type for e in events_of(auth_env.session, user.id)]
    assert AuthEventType.PASSWORD_RESET_COMPLETED in kinds
    assert auth_env.outbox.last("password_changed") is not None


def test_a_reset_token_is_single_use(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    token = request_reset(auth_env)
    api = auth_env.client()
    assert (
        api.post(
            "/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD}
        ).status_code
        == 204
    )

    reused = api.post(
        "/auth/reset-password", {"token": token, "newPassword": "a third passphrase 99"}
    )

    assert reused.status_code == 400 and reused.json()["error"]["code"] == "token_invalid"
    assert auth_env.client().login(password=OTHER_PASSWORD).status_code == 200


def test_an_expired_reset_token_is_rejected(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    token = request_reset(auth_env)
    auth_env.clock.advance(minutes=61)

    response = auth_env.client().post(
        "/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD}
    )

    assert response.status_code == 400 and response.json()["error"]["code"] == "token_expired"
    assert auth_env.client().login(password=PASSWORD).status_code == 200  # password unchanged


def test_a_weak_new_password_is_rejected_without_burning_the_token(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    token = request_reset(auth_env)
    api = auth_env.client()

    weak = api.post("/auth/reset-password", {"token": token, "newPassword": "1234567890"})

    assert weak.status_code == 422 and "1234567890" not in weak.text
    ok = api.post("/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD})
    assert ok.status_code == 204  # the token survived the failed attempt


def test_a_reset_also_verifies_an_unverified_mailbox_and_retires_other_tokens(
    auth_env: AuthEnv,
) -> None:
    api, user = registered(auth_env)
    verification = last_token(auth_env, "email_verification")
    token = request_reset(auth_env)

    assert (
        api.post(
            "/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD}
        ).status_code
        == 204
    )

    assert refreshed(auth_env, user).email_verified_at is not None
    leftover = auth_env.session.scalars(
        select(AuthToken).where(AuthToken.consumed_at.is_(None))
    ).all()
    assert leftover == []
    assert (
        api.post("/auth/verify-email", {"token": verification}).json()["error"]["code"]
        == "token_invalid"
    )


# -- change password -----------------------------------------------------------------------------------------


def signed_in(env: AuthEnv):  # type: ignore[no-untyped-def]
    user = make_account(env.session)
    api = env.client()
    assert api.login().status_code == 200
    return user, api


def change(api, current: str = PASSWORD, new: str = OTHER_PASSWORD, **kwargs):  # type: ignore[no-untyped-def]
    return api._remember(
        api.post(
            "/auth/change-password", {"currentPassword": current, "newPassword": new}, **kwargs
        )
    )


def test_change_password_requires_a_session_and_csrf(auth_env: AuthEnv) -> None:
    body = {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD}
    assert auth_env.client().post("/auth/change-password", body).status_code == 401
    _, api = signed_in(auth_env)
    assert api.post("/auth/change-password", body, csrf=None).status_code == 403


def test_change_password_rotates_this_session_and_revokes_the_others(auth_env: AuthEnv) -> None:
    user, api = signed_in(auth_env)
    other = auth_env.client()
    other.login()
    old_token, old_csrf = api.session_cookie, api.csrf
    rows_before = {s.id: s for s in active_sessions_of(auth_env.session, user.id)}

    response = change(api)

    assert response.status_code == 200
    data = response.json()["data"]
    assert api.session_cookie != old_token  # the cookie was replaced
    assert data["csrfToken"] == csrf_token_for(api.session_cookie or "") != old_csrf
    assert response.headers["cache-control"] == "no-store"
    # the old token is dead; the other device is signed out; this device keeps working
    stale = auth_env.client()
    assert stale.me(headers={"Cookie": f"{stale.cookie_name}={old_token}"}).status_code == 401
    assert other.me().json()["error"]["code"] == "session_expired"
    assert api.me().status_code == 200
    # same session row, new hash; the absolute lifetime was not extended
    (still_active,) = active_sessions_of(auth_env.session, user.id)
    assert still_active.id in rows_before
    assert still_active.absolute_expires_at == rows_before[still_active.id].absolute_expires_at
    reasons = {s.revoke_reason for s in sessions_of(auth_env.session, user.id) if s.revoked_at}
    assert reasons == {"password_change"}
    assert auth_env.client().login(password=PASSWORD).status_code == 401
    assert auth_env.client().login(password=OTHER_PASSWORD).status_code == 200
    assert auth_env.outbox.last("password_changed") is not None
    assert AuthEventType.PASSWORD_CHANGED in [
        e.event_type for e in events_of(auth_env.session, user.id)
    ]


def test_change_password_needs_the_current_password(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)

    wrong = change(api, current="not my password at all")

    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "invalid_credentials"
    assert auth_env.client().login(password=PASSWORD).status_code == 200  # unchanged
    assert api.me().status_code == 200  # a wrong guess does not sign the user out


def test_wrong_current_passwords_are_rate_limited_for_a_stolen_session(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)
    for _ in range(10):
        assert change(api, current="guess guess guess").status_code == 401

    blocked = change(api)  # even the right password waits for the window

    assert blocked.status_code == 429


def test_change_password_applies_the_policy(auth_env: AuthEnv) -> None:
    _, api = signed_in(auth_env)

    weak = change(api, new="tiny")
    same_as_email = change(api, new=EMAIL)

    assert weak.status_code == 422 and same_as_email.status_code == 422
    assert auth_env.client().login(password=PASSWORD).status_code == 200


def test_social_only_accounts_use_forgot_password_instead(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, password=None)
    api = auth_env.client()
    # a session for a password-less account (e.g. created by a future provider login)
    user = auth_env.session.scalars(select(User)).one()
    raw = new_token()
    from datetime import timedelta

    auth_env.session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(raw),
            created_at=auth_env.clock(),
            last_seen_at=auth_env.clock(),
            expires_at=auth_env.clock() + timedelta(days=1),
            absolute_expires_at=auth_env.clock() + timedelta(days=2),
        )
    )
    auth_env.session.commit()
    api.csrf = csrf_token_for(raw)

    response = change(api, headers={"Cookie": f"{api.cookie_name}={raw}"})

    assert response.status_code == 401 and response.json()["error"]["code"] == "invalid_credentials"
