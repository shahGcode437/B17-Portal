"""The development verification helper against real PostgreSQL and the real verification endpoint.

It must issue a GENUINE one-time token (hashed at rest, 24 h, single use, older ones retired) and
verify nobody by itself: the account stays unverified until the link is opened and the normal
``POST /auth/verify-email`` runs.
"""

from datetime import timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import Settings
from app.core.security.tokens import hash_token
from app.models import AuthToken, User
from app.models.enums import AuthEventType, AuthTokenPurpose
from app.services.dev_verification import (
    DevVerificationRefused,
    issue_dev_verification_link,
)
from tests.db.auth_helpers import ORIGIN, AuthEnv, events_of, last_token, make_account, token_row

LOCAL_URL = SecretStr("postgresql+psycopg://b17:secret@127.0.0.1:54329/b17_dev")


def dev_settings(env: AuthEnv, **update: object) -> Settings:
    """The test app's settings with a (local) database URL, which the guard requires."""
    return env.settings.model_copy(update={"database_url": LOCAL_URL, **update})


def issue(env: AuthEnv, email: str = "ayesha@example.org", **kwargs: object) -> str:
    link = issue_dev_verification_link(
        env.session,
        dev_settings(env),
        env.clock,
        email,
        **kwargs,  # type: ignore[arg-type]
    )
    return link.url


def raw_token(url: str) -> str:
    assert "#token=" in url and "?" not in url  # the fragment, never the query string
    return url.split("#token=", 1)[1]


def test_it_issues_a_real_single_use_token_that_the_normal_endpoint_accepts(
    auth_env: AuthEnv,
) -> None:
    user = make_account(auth_env.session, verified=False)

    url = issue(auth_env)

    assert url.startswith(f"{ORIGIN}/verify-email#token=")
    raw = raw_token(url)
    # Only the hash is stored, with the verification purpose and the 24 h lifetime.
    row = token_row(auth_env.session, raw)
    assert row is not None and row.token_hash == hash_token(raw)
    assert raw.encode() not in bytes(row.token_hash)  # the raw token itself is not what is stored
    assert row.purpose is AuthTokenPurpose.EMAIL_VERIFICATION
    assert row.expires_at - row.created_at == timedelta(hours=24)
    # Issuing it verified NOBODY.
    auth_env.session.refresh(user)
    assert user.email_verified_at is None

    # The real endpoint spends it: 204, the account is now verified, and it works exactly once.
    api = auth_env.client()
    assert api.post("/auth/verify-email", {"token": raw}).status_code == 204
    auth_env.session.refresh(user)
    assert user.email_verified_at is not None
    assert api.post("/auth/verify-email", {"token": raw}).status_code != 204


def test_a_new_link_retires_the_registration_email_token(auth_env: AuthEnv) -> None:
    api = auth_env.client()
    assert api.register(email="new.user@example.org").status_code == 201
    emailed = last_token(auth_env, "email_verification")

    dev_url = issue(auth_env, "new.user@example.org")

    assert api.post("/auth/verify-email", {"token": emailed}).status_code != 204  # retired
    assert api.post("/auth/verify-email", {"token": raw_token(dev_url)}).status_code == 204


def test_the_email_is_matched_the_way_login_matches_it(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, email="mixed.case@example.org", verified=False)
    assert issue(auth_env, "  Mixed.Case@Example.ORG ").startswith(ORIGIN)


def test_an_event_records_that_the_helper_issued_it(auth_env: AuthEnv) -> None:
    user = make_account(auth_env.session, verified=False)
    issue(auth_env)
    sent = [
        e
        for e in events_of(auth_env.session, user.id)
        if e.event_type is AuthEventType.EMAIL_VERIFICATION_SENT
    ]
    assert sent and sent[-1].details == {"reason": "dev_verify_cli"}
    assert all("token" not in str(e.details) for e in sent)  # the token itself is never recorded


@pytest.mark.parametrize(
    ("setup", "match"),
    [
        ("unknown", "no account"),
        ("verified", "already verified"),
        ("suspended", "not active"),
    ],
)
def test_it_refuses_an_unknown_verified_or_inactive_account_and_creates_no_token(
    auth_env: AuthEnv, setup: str, match: str
) -> None:
    if setup == "verified":
        make_account(auth_env.session, verified=True)
    if setup == "suspended":
        make_account(auth_env.session, verified=False, status="suspended")
    before = len(auth_env.session.scalars(select(AuthToken)).all())

    with pytest.raises(DevVerificationRefused, match=match):
        issue(auth_env)

    assert len(auth_env.session.scalars(select(AuthToken)).all()) == before


def test_it_only_prints_links_for_a_configured_frontend_origin(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, verified=False)
    with pytest.raises(DevVerificationRefused, match="not a configured frontend origin"):
        issue(auth_env, origin="http://evil.example")
    assert issue(auth_env, origin=ORIGIN + "/").startswith(f"{ORIGIN}/verify-email#token=")


def test_in_production_it_refuses_before_creating_anything(auth_env: AuthEnv) -> None:
    make_account(auth_env.session, verified=False)
    before = len(auth_env.session.scalars(select(AuthToken)).all())
    production = dev_settings(auth_env, environment="production")

    with pytest.raises(DevVerificationRefused, match="only works in development"):
        issue_dev_verification_link(
            auth_env.session, production, auth_env.clock, "ayesha@example.org"
        )

    assert len(auth_env.session.scalars(select(AuthToken)).all()) == before
    assert auth_env.session.scalars(select(User)).one().email_verified_at is None
