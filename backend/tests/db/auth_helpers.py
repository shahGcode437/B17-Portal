"""Shared builders for the authentication tests (real PostgreSQL, real app, in-memory email).

``AuthEnv`` bundles one app + the savepoint-isolated session + a controllable clock + the in-memory
mail outbox; ``AuthEnv.client()`` returns an :class:`AuthApi` — one "browser" with its own cookie
jar. Two ``AuthApi`` objects on the same ``AuthEnv`` are two devices.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.passwords import PasswordService
from app.core.security.tokens import hash_token
from app.dependencies.db import get_db_session
from app.factory import create_app
from app.models import AuthEvent, AuthSession, AuthToken, ProfessionalProfile, User, UserRole
from app.models.enums import PlanCode, RoleName, UserStatus
from app.services.email import MemoryEmailSender

ORIGIN = "http://127.0.0.1:5173"
API_ORIGIN = "http://127.0.0.1:8000"
PASSWORD = "correct horse battery staple"
OTHER_PASSWORD = "another long passphrase 42"
START = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)


class FakeClock:
    """A settable "now" (the app reads it through ``app.state.clock``)."""

    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


def make_test_settings(**overrides: Any) -> Settings:
    """Settings for the auth tests: cheap Argon2 (speed), real everything else."""
    values: dict[str, Any] = {
        "environment": "test",
        "app_version": "0.0.0-test",
        "frontend_origins": [ORIGIN],
        "frontend_base_url": ORIGIN,
        "password_hash_time_cost": 1,
        "password_hash_memory_cost_kib": 64,
        "password_hash_parallelism": 1,
        "max_concurrent_password_hashes": 2,
    }
    values.update(overrides)
    if values["environment"] == "test":  # Google sign-in on the in-process fake provider
        values.setdefault("google_oauth_provider", "fake")
        values.setdefault("api_public_base_url", API_ORIGIN)
    return Settings(_env_file=None, **values)


def fast_passwords() -> PasswordService:
    return PasswordService(time_cost=1, memory_cost_kib=64, parallelism=1, max_concurrent=2)


@dataclass
class AuthEnv:
    app: FastAPI
    session: Session
    clock: FakeClock
    outbox: MemoryEmailSender
    settings: Settings
    _apis: list["AuthApi"] = field(default_factory=list)

    def client(self, base_url: str = "http://testserver") -> "AuthApi":
        api = AuthApi(self, base_url)
        self._apis.append(api)
        return api

    def close(self) -> None:
        for api in self._apis:
            api.http.close()


def build_env(session: Session, **setting_overrides: Any) -> AuthEnv:
    settings = make_test_settings(**setting_overrides)
    app = create_app(settings)
    clock = FakeClock()
    outbox = MemoryEmailSender()
    app.state.clock = clock
    app.state.email_sender = outbox
    app.state.password_service = fast_passwords()
    app.dependency_overrides[get_db_session] = lambda: session
    return AuthEnv(app, session, clock, outbox, settings)


class AuthApi:
    """One browser: a cookie jar plus the in-memory CSRF token the SPA would keep."""

    def __init__(self, env: AuthEnv, base_url: str = "http://testserver") -> None:
        self.env = env
        self.http = TestClient(env.app, base_url=base_url, raise_server_exceptions=False)
        self.csrf: str | None = None

    # -- raw requests ------------------------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        origin: str | None = ORIGIN,
        csrf: str | None = "auto",
        headers: dict[str, str] | None = None,
        content: bytes | None = None,
        params: dict[str, str] | None = None,
    ) -> Response:
        sent: dict[str, str] = dict(headers or {})
        if origin is not None:
            sent["Origin"] = origin
        if csrf == "auto":
            csrf = self.csrf
        if csrf is not None:
            sent["X-CSRF-Token"] = csrf
        response: Response = self.http.request(
            method,
            f"/api/v1{path}",
            json=json,
            headers=sent,
            content=content,
            params=params,
            follow_redirects=False,  # OAuth callbacks answer 302; the tests inspect them
        )
        return response

    def post(self, path: str, json: Any = None, **kwargs: Any) -> Response:
        return self.request("POST", path, json=json, **kwargs)

    def get(self, path: str, **kwargs: Any) -> Response:
        return self.request("GET", path, **kwargs)

    # -- the auth journey ----------------------------------------------------------------------

    def _remember(self, response: Response) -> Response:
        if response.status_code in (200, 201):
            self.csrf = response.json()["data"].get("csrfToken", self.csrf)
        return response

    def register(
        self,
        email: str = "ayesha@example.org",
        password: str = PASSWORD,
        display_name: str = "Ayesha Khan",
        **kwargs: Any,
    ) -> Response:
        body = {"email": email, "password": password, "displayName": display_name}
        return self._remember(self.post("/auth/register", body, **kwargs))

    def login(
        self, email: str = "ayesha@example.org", password: str = PASSWORD, **kwargs: Any
    ) -> Response:
        return self._remember(
            self.post("/auth/login", {"email": email, "password": password}, **kwargs)
        )

    def me(self, **kwargs: Any) -> Response:
        return self._remember(self.get("/auth/me", **kwargs))

    def logout(self, **kwargs: Any) -> Response:
        return self.post("/auth/logout", **kwargs)

    @property
    def cookie_name(self) -> str:
        return self.env.settings.auth_cookie_name

    @property
    def session_cookie(self) -> str | None:
        value: str | None = self.http.cookies.get(self.cookie_name)
        return value


# -- direct database builders -----------------------------------------------------------------------


def make_account(
    session: Session,
    email: str = "ayesha@example.org",
    *,
    password: str | None = PASSWORD,
    verified: bool = True,
    status: str = "active",
    display_name: str = "Ayesha Khan",
    professional: PlanCode | None = None,
    admin: bool = False,
) -> User:
    user = User(
        email=email,
        display_name=display_name,
        password_hash=fast_passwords().hash_password(password) if password else None,
        email_verified_at=START if verified else None,
        status=UserStatus(status),
    )
    session.add(user)
    session.flush()
    if professional is not None:
        session.add(ProfessionalProfile(user_id=user.id, plan_code=professional))
    if admin:
        session.add(UserRole(user_id=user.id, role=RoleName.ADMIN))
    session.commit()
    return user


def sessions_of(session: Session, user_id: uuid.UUID) -> list[AuthSession]:
    return list(
        session.scalars(
            select(AuthSession)
            .where(AuthSession.user_id == user_id)
            .order_by(AuthSession.created_at)
        )
    )


def active_sessions_of(session: Session, user_id: uuid.UUID) -> list[AuthSession]:
    return [s for s in sessions_of(session, user_id) if s.revoked_at is None]


def events_of(session: Session, user_id: uuid.UUID | None = None) -> list[AuthEvent]:
    statement = select(AuthEvent).order_by(AuthEvent.occurred_at)
    if user_id is not None:
        statement = statement.where(AuthEvent.user_id == user_id)
    return list(session.scalars(statement))


def token_row(session: Session, raw: str) -> AuthToken | None:
    return session.scalars(select(AuthToken).where(AuthToken.token_hash == hash_token(raw))).first()


def last_token(env: AuthEnv, kind: str) -> str:
    """The raw one-time token from the most recent email of ``kind`` (from its fragment link)."""
    message = env.outbox.last(kind)
    assert message is not None and message.link is not None, f"no {kind} email was sent"
    assert "#token=" in message.link and "?" not in message.link  # fragment, never the query
    return message.link.split("#token=", 1)[1]


def only(rows: list[Any]) -> Any:
    assert len(rows) == 1, rows
    return rows[0]


def count(session: Session, table: str) -> int:
    return int(session.scalar(text(f"SELECT count(*) FROM {table}")) or 0)
