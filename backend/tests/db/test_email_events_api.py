"""EMAIL-1 over HTTP: which actions send which e-mail - and which send none.

The real app on PostgreSQL with the in-memory sender (sent inline). The provider adapter, the
templates and the background dispatcher are covered without a database in ``test_email_unit.py``.
"""

import logging

import pytest
from httpx import Response
from sqlalchemy.orm import Session

from app.core.rate_limit import LOGIN_NOTICE
from app.models.enums import AuthEventType
from app.services import login_notices as login_notices_module
from app.services.email import EmailDeliveryError, EmailMessage
from app.services.email_dispatch import InlineEmailDispatcher
from app.services.oauth.fake import fake_code
from app.services.rate_limit import PostgresRateLimiter
from tests.db.auth_helpers import (
    OTHER_PASSWORD,
    PASSWORD,
    AuthApi,
    AuthEnv,
    active_sessions_of,
    build_env,
    events_of,
    last_token,
    make_account,
)
from tests.db.oauth_helpers import callback, location, started_ok

EMAIL = "ayesha@example.org"
SUB = "google-sub-email-1"
#: The fake clock starts at 2026-10-17 12:00 UTC.
START_IN_PKT = "17 October 2026 at 17:00 PKT (UTC+5)"


def kinds(env: AuthEnv) -> list[str]:
    return [message.kind for message in env.outbox.outbox]


def notices(env: AuthEnv) -> list[EmailMessage]:
    return [message for message in env.outbox.outbox if message.kind == "login_notice"]


def google_sign_in(
    env: AuthEnv,
    *,
    email: str = EMAIL,
    sub: str = SUB,
    verified: bool = True,
    api: AuthApi | None = None,
) -> tuple[AuthApi, Response, str, str]:
    """One whole Google round trip: ``(browser, redirect, code, state)``."""
    api = api or env.client()
    started = started_ok(api)
    code = fake_code(sub, email, verified=verified)
    return api, callback(api, code, state=started.state), code, started.state


class Failing:
    """A provider that is down."""

    def __init__(self, error: Exception | None = None) -> None:
        self.attempted: list[EmailMessage] = []
        self.error = error or EmailDeliveryError(
            outcome="unconfirmed", error_type="ConnectTimeout", attempts=2
        )

    def send(self, message: EmailMessage) -> None:
        self.attempted.append(message)
        raise self.error


# -- registration, resend, reset, change ------------------------------------------------------


def test_registration_sends_the_verification_mail_and_no_sign_in_notice(
    auth_env: AuthEnv,
) -> None:
    auth_env.client().register()

    assert kinds(auth_env) == ["email_verification"]
    message = auth_env.outbox.outbox[0]
    assert message.to == EMAIL and message.html and "Verify email address" in message.html
    assert PASSWORD not in message.body + message.html


def test_resend_sends_one_fresh_verification_mail(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    api.register()
    first = last_token(auth_env, "email_verification")
    auth_env.clock.advance(minutes=2)

    assert api.post("/auth/resend-verification").status_code == 204

    assert kinds(auth_env) == ["email_verification"] * 2
    assert last_token(auth_env, "email_verification") != first
    assert len({m.idempotency_key for m in auth_env.outbox.outbox}) == 2


def test_a_password_reset_sends_the_link_then_one_security_notice(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    anon = auth_env.client()
    anon.post("/auth/forgot-password", {"email": EMAIL})
    token = last_token(auth_env, "password_reset")

    reset = anon.post("/auth/reset-password", {"token": token, "newPassword": OTHER_PASSWORD})

    assert reset.status_code == 204 and kinds(auth_env) == ["password_reset", "password_changed"]
    notice = auth_env.outbox.outbox[-1]
    assert notice.to == EMAIL and START_IN_PKT in notice.body and notice.link is None
    assert "/forgot-password" in notice.body
    for secret in (token, OTHER_PASSWORD):
        assert secret not in notice.body + (notice.html or "")


def test_changing_the_password_sends_only_the_change_notice(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    api.login()
    auth_env.outbox.outbox.clear()

    changed = api.post(
        "/auth/change-password", {"currentPassword": PASSWORD, "newPassword": OTHER_PASSWORD}
    )

    # The session token is rotated, which is not a new sign-in.
    assert changed.status_code == 200 and kinds(auth_env) == ["password_changed"]
    notice = auth_env.outbox.outbox[0]
    for secret in (PASSWORD, OTHER_PASSWORD, api.session_cookie or "?", changed.text):
        assert secret not in notice.body + (notice.html or "")


# -- password sign-in --------------------------------------------------------------------------


def test_a_password_sign_in_sends_one_notice_with_the_time_and_method(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session)
    api = auth_env.client()

    response = api.login()

    assert response.status_code == 200 and kinds(auth_env) == ["login_notice"]
    [notice] = notices(auth_env)
    [session] = active_sessions_of(auth_env.session, user.id)
    assert notice.to == EMAIL
    assert notice.subject == "New sign-in to your B-17 Portal account"
    assert f"Date and time: {START_IN_PKT}" in notice.body
    assert "Sign-in method: Email and password" in notice.body
    assert notice.idempotency_key == f"login-notice/{session.id}"
    everything = notice.body + (notice.html or "")
    for secret in (PASSWORD, api.session_cookie or "?", api.csrf or "?"):
        assert secret not in everything


def test_using_a_session_never_sends_another_notice(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    api.login()

    for minutes in (0, 6, 20, 60):  # past the 5-minute mark the session slides and re-writes
        auth_env.clock.advance(minutes=minutes)
        assert api.me().status_code == 200
        assert api.get("/saved").status_code == 200
    assert api.logout().status_code == 204
    assert api.me().status_code == 401

    assert kinds(auth_env) == ["login_notice"]


def test_each_new_sign_in_gets_its_own_notice(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)

    auth_env.client().login()
    auth_env.client().login()

    assert len({n.idempotency_key for n in notices(auth_env)}) == len(notices(auth_env)) == 2


@pytest.mark.parametrize(
    ("account", "attempt", "status"),
    [
        ({}, {"password": "not the password"}, 401),
        ({}, {"email": "nobody@example.org"}, 401),
        ({"password": None}, {}, 401),
        ({"status": "suspended"}, {}, 403),
    ],
)
def test_a_failed_sign_in_sends_nothing(
    auth_env: AuthEnv, account: dict[str, object], attempt: dict[str, str], status: int
) -> None:
    make_account(auth_env.session, **account)  # type: ignore[arg-type]

    assert auth_env.client().login(**attempt).status_code == status

    assert auth_env.outbox.outbox == []


def test_an_unverified_address_is_never_sent_a_sign_in_notice(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, verified=False)

    assert auth_env.client().login().status_code == 200

    assert auth_env.outbox.outbox == []


def test_the_notice_cap_stops_mail_but_never_a_sign_in(
    auth_env: AuthEnv, caplog: pytest.LogCaptureFixture
) -> None:
    make_account(auth_env.session)
    make_account(auth_env.session, "other@example.org")

    results = [auth_env.client().login().status_code for _ in range(LOGIN_NOTICE.limit + 3)]

    assert results == [200] * (LOGIN_NOTICE.limit + 3)
    assert len(notices(auth_env)) == LOGIN_NOTICE.limit == 10
    suppressed = [r for r in caplog.records if r.getMessage() == "login notice suppressed"]
    assert len(suppressed) == 3 and EMAIL not in " ".join(f"{r.__dict__}" for r in suppressed)
    assert auth_env.client().login(email="other@example.org").status_code == 200
    assert notices(auth_env)[-1].to == "other@example.org"  # the cap is per account
    auth_env.clock.advance(hours=1)
    auth_env.client().login()
    assert notices(auth_env)[-1].to == EMAIL  # a new window


@pytest.mark.parametrize(
    "error",
    [
        EmailDeliveryError(outcome="refused", provider_status=403),
        EmailDeliveryError(outcome="unconfirmed", error_type="ReadTimeout", attempts=2),
        ConnectionError("provider is down"),
    ],
)
def test_a_provider_failure_never_fails_a_sign_in(
    auth_env: AuthEnv, error: Exception, caplog: pytest.LogCaptureFixture
) -> None:
    user = make_account(auth_env.session)
    provider = Failing(error)
    auth_env.app.state.email_sender = provider
    caplog.set_level(logging.DEBUG)
    api = auth_env.client()

    response = api.login()

    assert response.status_code == 200 and api.me().status_code == 200
    assert len(provider.attempted) == 1  # handed over once; retries belong to the adapter
    assert len(active_sessions_of(auth_env.session, user.id)) == 1
    logged = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records if r.name != "httpx")
    assert EMAIL not in logged and PASSWORD not in logged
    assert any(r.name == "app.email" and r.levelno >= logging.ERROR for r in caplog.records)


@pytest.mark.parametrize("broken", ["rate limiter", "template"])
def test_a_notice_that_cannot_be_prepared_never_fails_a_sign_in(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch, broken: str
) -> None:
    user = make_account(auth_env.session)
    original = PostgresRateLimiter.hit

    def failing_hit(self: PostgresRateLimiter, identifier: str, policy: object) -> object:
        if policy is LOGIN_NOTICE:
            raise RuntimeError("counter unavailable")
        return original(self, identifier, policy)  # type: ignore[arg-type]

    def failing_template(*args: object, **kwargs: object) -> EmailMessage:
        raise RuntimeError("template broke")

    if broken == "rate limiter":
        monkeypatch.setattr(PostgresRateLimiter, "hit", failing_hit)
    else:
        monkeypatch.setattr(login_notices_module, "login_notice_email", failing_template)
    api = auth_env.client()

    response = api.login()

    assert response.status_code == 200 and api.me().status_code == 200
    assert len(active_sessions_of(auth_env.session, user.id)) == 1
    assert AuthEventType.LOGIN_SUCCESS in [
        e.event_type for e in events_of(auth_env.session, user.id)
    ]
    assert auth_env.outbox.outbox == []


# -- Google sign-in ----------------------------------------------------------------------------


def test_a_returning_google_user_gets_one_notice_per_sign_in(auth_env: AuthEnv) -> None:
    google_sign_in(auth_env)  # creates the account
    assert auth_env.outbox.outbox == []  # creating an account is not a sign-in notice

    api, response, _, _ = google_sign_in(auth_env)

    assert response.status_code == 302 and kinds(auth_env) == ["login_notice"]
    [notice] = notices(auth_env)
    assert notice.to == EMAIL and "Sign-in method: Google" in notice.body
    assert START_IN_PKT in notice.body
    assert "https://myaccount.google.com/security" in notice.body
    for _ in range(3):
        auth_env.clock.advance(minutes=6)
        assert api.me().status_code == 200
    assert len(notices(auth_env)) == 1


def test_a_replayed_or_failed_google_callback_sends_nothing(auth_env: AuthEnv) -> None:
    google_sign_in(auth_env)
    api, _, code, state = google_sign_in(auth_env)
    assert len(notices(auth_env)) == 1

    replay = callback(api, code, state=state)
    started = started_ok(auth_env.client())
    forged = callback(auth_env.client(), code, state=started.state)

    assert "error=oauth_failed" in location(replay) and "error=oauth_failed" in location(forged)
    assert len(notices(auth_env)) == 1


def test_the_notice_goes_to_the_account_address_not_the_one_google_reports_now(
    auth_env: AuthEnv,
) -> None:
    google_sign_in(auth_env)

    google_sign_in(auth_env, email="renamed@example.org")  # same subject, new Google address

    assert [n.to for n in notices(auth_env)] == [EMAIL]


def test_reclaiming_an_unverified_account_through_google_is_a_sign_in(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, verified=False)

    _, response, _, _ = google_sign_in(auth_env)

    assert "error=" not in location(response) and kinds(auth_env) == ["login_notice"]


def test_an_unverified_google_account_gets_only_its_verification_mail(auth_env: AuthEnv) -> None:
    google_sign_in(auth_env, verified=False)
    assert kinds(auth_env) == ["email_verification"]

    google_sign_in(auth_env, verified=False)  # signing in again, still unverified

    assert kinds(auth_env) == ["email_verification"]


def test_a_refused_google_sign_in_and_connect_google_send_nothing(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)  # verified: Google may not take it over by e-mail
    _, refused, _, _ = google_sign_in(auth_env)
    assert "error=identity_conflict" in location(refused)

    api = auth_env.client()
    api.login()
    auth_env.outbox.outbox.clear()
    started = started_ok(api, purpose="link")
    connected = callback(api, fake_code(SUB, EMAIL), state=started.state)

    assert "error=" not in location(connected) and auth_env.outbox.outbox == []


def test_a_provider_failure_never_fails_a_google_sign_in(auth_env: AuthEnv) -> None:
    google_sign_in(auth_env)
    auth_env.app.state.email_sender = Failing()

    api, response, _, _ = google_sign_in(auth_env)

    assert response.status_code == 302 and "error=" not in location(response)
    assert api.me().status_code == 200


def test_the_notice_cap_is_shared_by_both_sign_in_methods(auth_env: AuthEnv) -> None:
    google_sign_in(auth_env)
    for _ in range(LOGIN_NOTICE.limit):
        google_sign_in(auth_env)
    assert len(notices(auth_env)) == LOGIN_NOTICE.limit

    _, response, _, _ = google_sign_in(auth_env)

    assert "error=" not in location(response) and len(notices(auth_env)) == LOGIN_NOTICE.limit


# -- enumeration safety when delivery fails ----------------------------------------------------


def test_forgot_password_answers_the_same_while_the_provider_is_down(
    auth_env: AuthEnv, caplog: pytest.LogCaptureFixture
) -> None:
    make_account(auth_env.session)
    auth_env.app.state.email_sender = provider = Failing()
    caplog.set_level(logging.DEBUG)

    known = auth_env.client().post("/auth/forgot-password", {"email": EMAIL})
    unknown = auth_env.client().post("/auth/forgot-password", {"email": "nobody@example.org"})

    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json())
    assert known.status_code == 202 and len(provider.attempted) == 1
    failures = [r for r in caplog.records if r.name == "app.email" and r.levelno >= logging.ERROR]
    assert [r.__dict__["emailKind"] for r in failures] == ["password_reset"]
    blob = " ".join(f"{r.getMessage()} {r.__dict__}" for r in failures)
    assert EMAIL not in blob and (provider.attempted[0].link or "?") not in blob


def test_a_delivery_failure_leaves_the_tokens_usable(auth_env: AuthEnv) -> None:
    """The message exists and the token is committed: a later resend or retry is not needed for
    the link that did arrive (an unconfirmed send may well have reached the person)."""
    provider = Failing()
    auth_env.app.state.email_sender = provider
    auth_env.client().register()
    link = provider.attempted[0].link or ""
    auth_env.clock.advance(minutes=1)

    redeemed = auth_env.client().post("/auth/verify-email", {"token": link.split("#token=")[1]})

    assert redeemed.status_code == 204


# -- what a screen may say (emailDelivery) ---------------------------------------------------------

DELIVERY_MODES: list[tuple[dict[str, object], str]] = [
    ({"email_backend": "memory"}, "off"),
    ({"email_backend": "disabled"}, "off"),
    ({"email_backend": "console"}, "console"),
    (
        {  # ``test`` refuses a real provider, so this mode is built as a developer would
            "environment": "development",
            "email_backend": "resend",
            "resend_api_key": "re_not_a_real_key",
            "email_from": "B-17 Portal <notifications@mail.b17portal.com>",
        },
        "email",
    ),
]


@pytest.mark.parametrize(
    ("overrides", "expected"), DELIVERY_MODES, ids=["memory", "disabled", "console", "resend"]
)
def test_the_api_says_how_it_handles_email_and_nothing_more(
    db_session: Session, overrides: dict[str, object], expected: str
) -> None:
    env = build_env(db_session, **overrides)
    env.app.state.email_dispatcher = InlineEmailDispatcher()  # build_env keeps mail in memory
    try:
        make_account(env.session, "verified@example.org")
        api = env.client()
        registered = api.register()
        me, profile = api.me(), api.get("/auth/me")
        known = env.client().post("/auth/forgot-password", {"email": "verified@example.org"})
        unknown = env.client().post("/auth/forgot-password", {"email": "nobody@example.org"})

        for response in (registered, me, profile):
            assert response.json()["data"]["emailDelivery"] == expected
        assert (
            known.json()
            == unknown.json()
            == {"data": {"status": "accepted", "emailDelivery": expected}}
        )
        assert known.status_code == unknown.status_code == 202
        for response in (registered, known):
            assert "re_not_a_real_key" not in response.text and "resend" not in response.text
    finally:
        env.close()


def test_the_professional_profile_reply_carries_it_too(auth_env: AuthEnv) -> None:
    make_account(auth_env.session)
    api = auth_env.client()
    api.login()

    response = api.request("PUT", "/users/me/professional-profile", json={})

    assert response.status_code == 201 and response.json()["data"]["emailDelivery"] == "off"
