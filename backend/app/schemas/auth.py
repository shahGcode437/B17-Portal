"""Auth request/response schemas (docs/backend/AUTH_RBAC.md §12).

Requests are strict (unknown fields are rejected, so ``role``/``emailVerified``/``ownerId`` can
never be smuggled in). Passwords and tokens are ``SecretStr``: they never appear in a repr, a log
line or a validation message, and custom validation messages never echo the offending value.
Responses never contain a password hash, a session token, a token hash or a provider subject.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import ConfigDict, Field, SecretStr, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.core.security.identity import normalize_email
from app.core.security.redirects import InvalidReturnTo, resolve_return_to
from app.models.enums import OAuthPurpose, PlanCode, RoleName
from app.schemas.envelope import ApiModel

_Password = Annotated[SecretStr, Field(max_length=1024)]  # DoS bound; the policy limit is 128
_Token = Annotated[str, StringConstraints(max_length=200)]
_Raw = ConfigDict(extra="forbid")


class RegisterRequest(ApiModel):
    model_config = _Raw

    email: Annotated[str, StringConstraints(max_length=320)]
    password: _Password
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)
    ]

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        try:
            return normalize_email(value)
        except ValueError:
            raise PydanticCustomError("invalid_email", "Enter a valid email address.") from None

    @field_validator("display_name")
    @classmethod
    def _printable_name(cls, value: str) -> str:
        if not value.isprintable():
            raise PydanticCustomError("invalid_name", "Use letters, numbers and punctuation only.")
        return value


class LoginRequest(ApiModel):
    model_config = _Raw

    #: Not format-validated: a malformed address must be indistinguishable from an unknown one.
    email: Annotated[str, StringConstraints(max_length=320)]
    password: _Password


class VerifyEmailRequest(ApiModel):
    model_config = _Raw

    token: _Token


class ForgotPasswordRequest(ApiModel):
    model_config = _Raw

    email: Annotated[str, StringConstraints(max_length=320)]


class ResetPasswordRequest(ApiModel):
    model_config = _Raw

    token: _Token
    new_password: _Password


class ChangePasswordRequest(ApiModel):
    model_config = _Raw

    current_password: _Password
    new_password: _Password


class ProfessionalSummary(ApiModel):
    plan_code: PlanCode


class AuthMethods(ApiModel):
    password: bool
    providers: list[str]


class SessionInfo(ApiModel):
    expires_at: datetime


class AuthUser(ApiModel):
    """The ``/auth/me`` shape, also the body of register / login / change-password."""

    id: UUID
    display_name: str
    email: str
    email_verified: bool
    #: Explicit grants only (a Resident has none; Professional is a capability, not a role).
    roles: list[RoleName]
    professional: ProfessionalSummary | None = None
    auth_methods: AuthMethods
    session: SessionInfo
    csrf_token: str


class AcceptedStatus(ApiModel):
    status: str = "accepted"


class OAuthStartRequest(ApiModel):
    """Start of a Google round trip. ``returnTo``: absent/blank -> ``/``; an explicitly unsafe
    value is a ``422 validation_error`` (never silently replaced); the message never echoes it."""

    model_config = _Raw

    purpose: OAuthPurpose = OAuthPurpose.LOGIN
    return_to: Annotated[str, StringConstraints(max_length=500)] | None = None

    @field_validator("return_to")
    @classmethod
    def _safe_return_to(cls, value: str | None) -> str:
        try:
            return resolve_return_to(value)
        except InvalidReturnTo:
            raise PydanticCustomError(
                "invalid_return_to", "Use a relative path that stays on this site."
            ) from None


class OAuthStarted(ApiModel):
    #: The provider URL to navigate the browser to. Contains no B-17 secret.
    authorization_url: str
