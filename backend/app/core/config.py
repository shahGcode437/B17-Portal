"""Typed application settings, loaded from the environment (and an optional local ``.env``).

One settings source for the whole backend. Nothing here has a secret default, and the real
``.env`` is git-ignored (``.env.example`` documents every variable).
"""

import json
import logging
from functools import lru_cache
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app import __version__

Environment = Literal["development", "test", "staging", "production"]

#: Stable machine name of this service (used by the health endpoint).
SERVICE_NAME = "b17-portal-api"

#: Vite's default dev-server origins. Only applied in ``development`` when ``FRONTEND_ORIGINS``
#: is not set at all; every other environment must configure its origins explicitly.
DEVELOPMENT_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


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
    #: Overrides the default level (``DEBUG`` when ``debug`` is true, otherwise ``INFO``).
    log_level: str | None = None

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

    @field_validator("api_v1_prefix")
    @classmethod
    def _validate_prefix(cls, value: str) -> str:
        if not value.startswith("/") or value.endswith("/") or " " in value:
            raise ValueError("must start with '/' and must not end with '/' (e.g. '/api/v1')")
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
