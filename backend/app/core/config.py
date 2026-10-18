"""Typed application settings, loaded from the environment (and an optional local ``.env``).

One settings source for the whole backend. Nothing here has a secret default, and the real
``.env`` is git-ignored (``.env.example`` documents every variable).
"""

import json
import logging
from functools import lru_cache
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app import __version__

Environment = Literal["development", "test", "staging", "production"]

#: Stable machine name of this service (used by the health endpoint).
SERVICE_NAME = "b17-portal-api"

#: Vite's default dev-server origins. Only applied in ``development`` when ``FRONTEND_ORIGINS``
#: is not set at all; every other environment must configure its origins explicitly.
DEVELOPMENT_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

#: The deterministic development auth topology (AUTH_RBAC.md §5.1): never mix localhost/127.0.0.1.
DEVELOPMENT_FRONTEND_BASE_URL = "http://127.0.0.1:5173"
DEVELOPMENT_API_BASE_URL = "http://127.0.0.1:8000"

#: Environments served over HTTPS behind a real hostname.
HOSTED_ENVIRONMENTS = frozenset({"staging", "production"})

#: The OWASP Argon2id floor (m=19 MiB, t=2, p=1) that hosted environments may not go below.
ARGON2_MIN_MEMORY_KIB = 19456
ARGON2_MIN_TIME_COST = 2


def _normalize_origin(raw: str) -> str:
    """Validate one CORS origin: ``scheme://host[:port]`` only. Wildcards are never accepted."""
    origin = raw.strip()
    if origin == "*" or "*" in origin:
        raise ValueError("wildcard origins are not allowed; list explicit origins")
    parts = urlsplit(origin)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ValueError(f"invalid origin {raw!r}: expected scheme://host[:port]")
    if parts.path not in {"", "/"} or parts.query or parts.fragment or parts.username:
        raise ValueError(f"invalid origin {raw!r}: no path, query or credentials allowed")
    return f"{parts.scheme}://{parts.netloc}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "B-17 Portal API"
    app_version: str = __version__
    environment: Environment = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    #: Exact browser origins allowed by CORS. Comma-separated (or a JSON list) in the environment.
    frontend_origins: Annotated[list[str], NoDecode] = []
    #: Canonical localities a NEW listing's ``area`` must belong to (Phase 12D; LOCATION_MAP.md §4).
    #: Comma-separated (or a JSON list) in the environment. Matched trimmed and case-insensitively,
    #: stored in the configured spelling. A setting, not a geofence: no geographic data is implied.
    localities: Annotated[list[str], NoDecode] = ["B-17"]
    #: Overrides the default level (``DEBUG`` when ``debug`` is true, otherwise ``INFO``).
    log_level: str | None = None
    #: PostgreSQL URL for the application, ``postgresql+psycopg://user:password@host:port/dbname``.
    #: Optional so the API can start (and its non-database tests run) without a database; the
    #: readiness endpoint reports 503 until it is configured. Never logged.
    database_url: SecretStr | None = None
    #: Seconds to wait when opening a database connection (keeps readiness checks fast to fail).
    db_connect_timeout_seconds: int = Field(default=5, ge=1, le=60)

    # --- Authentication (Phase 11B; docs/backend/AUTH_RBAC.md §14) -----------------------------
    #: ``Secure`` flag of the session cookie. Defaults to true outside development/test and can
    #: never be false in staging/production.
    auth_cookie_secure: bool | None = None
    session_idle_days: int = Field(default=14, ge=1, le=90)
    session_absolute_days: int = Field(default=30, ge=1, le=365)
    #: Admin actions additionally need a recent session (AUTH_RBAC.md §4.4).
    admin_session_idle_minutes: int = Field(default=120, ge=5, le=1440)
    admin_session_max_hours: int = Field(default=12, ge=1, le=72)
    max_sessions_per_user: int = Field(default=10, ge=1, le=50)
    #: Exact frontend origin used in email links (verification/reset). Must be a configured
    #: frontend origin in staging/production; defaults to the Vite origin in development.
    frontend_base_url: str | None = None
    #: Public base URL of this API (reserved for the OAuth redirect URI, Phase 11C).
    api_public_base_url: str | None = None
    #: Google sign-in (Phase 11C). ``disabled`` (default: the OAuth routes answer 503), ``google``
    #: (needs the client id/secret and ``API_PUBLIC_BASE_URL``) or ``fake`` (a deterministic
    #: in-process provider for development/tests only; refused when hosted).
    google_oauth_provider: Literal["disabled", "google", "fake"] = "disabled"
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: SecretStr | None = None
    #: ``memory`` (tests), ``console`` (development) or ``disabled`` (no provider chosen yet).
    #: Staging/production can only be ``disabled`` until a provider exists.
    email_backend: Literal["memory", "console", "disabled"] | None = None
    email_from: str = "B-17 Portal <no-reply@localhost>"
    #: Argon2id parameters (one place: ``app.core.security.passwords``). Staging/production
    #: refuse values below the OWASP floor (m >= 19 MiB, t >= 2, p >= 1).
    password_hash_time_cost: int = Field(default=3, ge=1, le=10)
    password_hash_memory_cost_kib: int = Field(default=65536, ge=8, le=1048576)
    password_hash_parallelism: int = Field(default=4, ge=1, le=16)
    max_concurrent_password_hashes: int = Field(default=4, ge=1, le=32)

    @field_validator("frontend_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [item for item in (part.strip() for part in text.split(",")) if item]
        return value

    @field_validator("frontend_origins")
    @classmethod
    def _validate_origins(cls, value: list[str]) -> list[str]:
        normalized = [_normalize_origin(origin) for origin in value]
        return list(dict.fromkeys(normalized))  # de-duplicate, keep order

    @field_validator("localities", mode="before")
    @classmethod
    def _split_localities(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [item for item in (part.strip() for part in text.split(",")) if item]
        return value

    @field_validator("localities")
    @classmethod
    def _validate_localities(cls, value: list[str]) -> list[str]:
        cleaned = [" ".join(item.split()) for item in value if item.strip()]
        if not cleaned:
            raise ValueError("LOCALITIES needs at least one locality (default: B-17)")
        if any(len(item) > 100 or not item.isprintable() for item in cleaned):
            raise ValueError("each locality must be printable text of at most 100 characters")
        first_spelling: dict[str, str] = {}
        for item in cleaned:
            first_spelling.setdefault(item.casefold(), item)
        return list(first_spelling.values())

    @field_validator("api_v1_prefix")
    @classmethod
    def _validate_prefix(cls, value: str) -> str:
        if not value.startswith("/") or value.endswith("/") or " " in value:
            raise ValueError("must start with '/' and must not end with '/' (e.g. '/api/v1')")
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def _empty_database_url_is_unset(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("must be a PostgreSQL URL for psycopg 3: postgresql+psycopg://...")
        return value

    @field_validator("log_level")
    @classmethod
    def _validate_log_level(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        level = value.upper()
        if level not in logging.getLevelNamesMapping() or level == "NOTSET":
            raise ValueError(f"unknown log level {value!r}")
        return level

    @model_validator(mode="after")
    def _apply_development_origins(self) -> Self:
        # Convenience for local work only: a developer who has not configured anything still gets
        # the standard Vite origins. Other environments never get an implicit origin.
        if self.environment == "development" and "frontend_origins" not in self.model_fields_set:
            self.frontend_origins = list(DEVELOPMENT_FRONTEND_ORIGINS)
        return self

    @field_validator("google_oauth_client_id", "google_oauth_client_secret", mode="before")
    @classmethod
    def _empty_google_credential_is_unset(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("frontend_base_url", "api_public_base_url", mode="before")
    @classmethod
    def _normalize_base_urls(cls, value: object) -> object:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        if not isinstance(value, str):
            return value
        return _normalize_origin(value)

    @model_validator(mode="after")
    def _apply_and_check_auth_settings(self) -> Self:
        hosted = self.environment in HOSTED_ENVIRONMENTS
        if self.auth_cookie_secure is None:
            self.auth_cookie_secure = hosted
        if self.email_backend is None:
            if self.environment == "development":
                self.email_backend = "console"
            elif self.environment == "test":
                self.email_backend = "memory"
            else:
                self.email_backend = "disabled"
        if self.frontend_base_url is None and self.environment == "development":
            self.frontend_base_url = DEVELOPMENT_FRONTEND_BASE_URL
        if self.api_public_base_url is None and self.environment == "development":
            self.api_public_base_url = DEVELOPMENT_API_BASE_URL
        self._check_google_settings(hosted)
        if self.session_absolute_days < self.session_idle_days:
            raise ValueError("SESSION_ABSOLUTE_DAYS must not be shorter than SESSION_IDLE_DAYS")
        if hosted:
            if not self.auth_cookie_secure:
                raise ValueError("AUTH_COOKIE_SECURE cannot be false in staging/production")
            if not self.frontend_origins:
                raise ValueError(
                    "FRONTEND_ORIGINS is required in staging/production (cookie auth needs "
                    "exact origins)"
                )
            if (
                self.frontend_base_url is None
                or self.frontend_base_url not in self.frontend_origins
            ):
                raise ValueError(
                    "FRONTEND_BASE_URL is required in staging/production and must be one of "
                    "FRONTEND_ORIGINS"
                )
            if self.email_backend != "disabled":
                raise ValueError(
                    "EMAIL_BACKEND must be 'disabled' in staging/production until a delivery "
                    "provider is implemented (console/memory must never run there)"
                )
            if (
                self.password_hash_memory_cost_kib < ARGON2_MIN_MEMORY_KIB
                or self.password_hash_time_cost < ARGON2_MIN_TIME_COST
            ):
                raise ValueError(
                    "password hashing parameters are below the OWASP Argon2id floor "
                    f"(memory >= {ARGON2_MIN_MEMORY_KIB} KiB, time cost >= {ARGON2_MIN_TIME_COST})"
                )
        if self.password_hash_memory_cost_kib < 8 * self.password_hash_parallelism:
            raise ValueError("PASSWORD_HASH_MEMORY_COST_KIB must be at least 8 x parallelism")
        return self

    def _check_google_settings(self, hosted: bool) -> None:
        provider = self.google_oauth_provider
        if provider == "disabled":
            return
        if self.api_public_base_url is None:
            raise ValueError("API_PUBLIC_BASE_URL is required when Google sign-in is enabled")
        if provider == "fake" and hosted:
            raise ValueError("GOOGLE_OAUTH_PROVIDER=fake can never run in staging/production")
        if provider == "google":
            if not self.google_oauth_client_id or self.google_oauth_client_secret is None:
                raise ValueError(
                    "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required when "
                    "GOOGLE_OAUTH_PROVIDER=google"
                )
            if hosted and not self.api_public_base_url.startswith("https://"):
                raise ValueError("API_PUBLIC_BASE_URL must be https:// in staging/production")

    @property
    def google_redirect_uri(self) -> str:
        """The one exact callback registered with Google; never taken from a request."""
        return f"{self.api_public_base_url}{self.api_v1_prefix}/auth/oauth/google/callback"

    @property
    def oauth_cookie_name(self) -> str:
        """The OAuth round trip's short-lived browser-binding cookie (not the session cookie)."""
        return "__Host-b17_oauth" if self.environment in HOSTED_ENVIRONMENTS else "b17_oauth"

    @property
    def auth_cookie_name(self) -> str:
        """``__Host-`` prefixed (Secure, Path=/, no Domain) where the site is served over HTTPS."""
        return "__Host-b17_session" if self.environment in HOSTED_ENVIRONMENTS else "b17_session"

    @property
    def effective_log_level(self) -> str:
        return self.log_level or ("DEBUG" if self.debug else "INFO")

    @property
    def docs_enabled(self) -> bool:
        """Interactive API docs and the OpenAPI document are not published in production."""
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, read once. Tests build their own ``Settings`` instead."""
    return Settings()
