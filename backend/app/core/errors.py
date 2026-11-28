"""The API error contract (docs/backend/API_CONTRACT.md §3): one envelope for every non-2xx.

    {"error": {"code": "...", "message": "...", "details": [...], "requestId": "..."}}

Messages are safe to show to users. Stack traces, SQL, exception class names and file paths never
reach a client; unexpected failures are logged server-side with the request ID instead.
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from starlette.responses import JSONResponse


class ErrorCode(StrEnum):
    """Stable, machine-readable error codes clients may branch on."""

    BAD_REQUEST = "bad_request"
    UNAUTHENTICATED = "unauthenticated"
    FORBIDDEN = "forbidden"
    # Authentication (Phase 11B; docs/backend/AUTH_RBAC.md §12)
    INVALID_CREDENTIALS = "invalid_credentials"
    SESSION_EXPIRED = "session_expired"
    EMAIL_NOT_VERIFIED = "email_not_verified"
    ACCOUNT_DISABLED = "account_disabled"
    CSRF_FAILED = "csrf_failed"
    # A private read named a session the cookie is not (GROCERY-4A; AUTH_RBAC.md §38)
    SESSION_MISMATCH = "session_mismatch"
    EMAIL_ALREADY_REGISTERED = "email_already_registered"
    TOKEN_INVALID = "token_invalid"
    TOKEN_EXPIRED = "token_expired"
    PLAN_LIMIT_REACHED = "plan_limit_reached"
    # Listing writes (Phase 12D; docs/backend/API_CONTRACT.md §10.10)
    LISTING_CONFLICT = "listing_conflict"
    PROFESSIONAL_PROFILE_REQUIRED = "professional_profile_required"
    # Grocery order intake (GROCERY-1b; docs/backend/API_CONTRACT.md §18)
    GROCERY_UNAVAILABLE = "grocery_unavailable"
    GROCERY_CLOSED = "grocery_closed"
    GROCERY_CAPACITY_REACHED = "grocery_capacity_reached"
    GROCERY_ACTIVE_ORDER_LIMIT = "grocery_active_order_limit"
    ORDER_CONFLICT = "order_conflict"
    ORDER_ALREADY_CLAIMED = "order_already_claimed"
    ORDER_NOT_CLAIMED = "order_not_claimed"
    IDEMPOTENCY_KEY_REQUIRED = "idempotency_key_required"
    IDEMPOTENCY_KEY_INVALID = "idempotency_key_invalid"
    IDEMPOTENCY_KEY_REUSED = "idempotency_key_reused"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    CONFLICT = "conflict"
    INVALID_STATE_TRANSITION = "invalid_state_transition"
    VALIDATION_ERROR = "validation_error"
    RATE_LIMITED = "rate_limited"
    INTERNAL_ERROR = "internal_error"
    SERVICE_UNAVAILABLE = "service_unavailable"


DEFAULT_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.BAD_REQUEST: "The request could not be understood.",
    ErrorCode.UNAUTHENTICATED: "Authentication is required.",
    ErrorCode.FORBIDDEN: "You do not have permission to do this.",
    ErrorCode.INVALID_CREDENTIALS: "Incorrect email or password.",
    ErrorCode.SESSION_EXPIRED: "Your session has ended. Please sign in again.",
    ErrorCode.EMAIL_NOT_VERIFIED: "Verify your email address to do this.",
    ErrorCode.ACCOUNT_DISABLED: "This account is not available.",
    ErrorCode.CSRF_FAILED: "The request could not be verified.",
    ErrorCode.SESSION_MISMATCH: "Who is signed in has changed. Check and try again.",
    ErrorCode.EMAIL_ALREADY_REGISTERED: "An account with this email already exists.",
    ErrorCode.TOKEN_INVALID: "This link is invalid or has already been used.",
    ErrorCode.TOKEN_EXPIRED: "This link has expired. Request a new one.",
    ErrorCode.PLAN_LIMIT_REACHED: "Your plan's listing limit has been reached.",
    ErrorCode.LISTING_CONFLICT: "This listing changed since you opened it.",
    ErrorCode.PROFESSIONAL_PROFILE_REQUIRED: "Create your professional profile to do this.",
    ErrorCode.GROCERY_UNAVAILABLE: "Grocery ordering is not available right now.",
    ErrorCode.GROCERY_CLOSED: "Grocery ordering is closed right now.",
    ErrorCode.GROCERY_CAPACITY_REACHED: "No more grocery orders can be accepted today.",
    ErrorCode.GROCERY_ACTIVE_ORDER_LIMIT: (
        "You already have the most grocery orders you can have open at once."
    ),
    ErrorCode.ORDER_CONFLICT: "This order changed since you opened it.",
    ErrorCode.ORDER_ALREADY_CLAIMED: "Another staff member is handling this order.",
    ErrorCode.ORDER_NOT_CLAIMED: "Claim this order before you work on it.",
    ErrorCode.IDEMPOTENCY_KEY_REQUIRED: "Send an Idempotency-Key header with this request.",
    ErrorCode.IDEMPOTENCY_KEY_INVALID: "The Idempotency-Key header is not valid.",
    ErrorCode.IDEMPOTENCY_KEY_REUSED: (
        "This Idempotency-Key was already used for a different order."
    ),
    ErrorCode.NOT_FOUND: "Resource not found.",
    ErrorCode.METHOD_NOT_ALLOWED: "Method not allowed.",
    ErrorCode.CONFLICT: "The request conflicts with the current state of the resource.",
    ErrorCode.INVALID_STATE_TRANSITION: "That action is not allowed in the current state.",
    ErrorCode.VALIDATION_ERROR: "Some fields are invalid.",
    ErrorCode.RATE_LIMITED: "Too many requests. Please try again later.",
    ErrorCode.INTERNAL_ERROR: "An unexpected error occurred.",
    ErrorCode.SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
}

_STATUS_TO_CODE: dict[int, ErrorCode] = {
    400: ErrorCode.BAD_REQUEST,
    401: ErrorCode.UNAUTHENTICATED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    409: ErrorCode.CONFLICT,
    422: ErrorCode.VALIDATION_ERROR,
    429: ErrorCode.RATE_LIMITED,
    503: ErrorCode.SERVICE_UNAVAILABLE,
}


def code_for_status(status_code: int) -> ErrorCode:
    """Map an HTTP status to its error code (unknown 4xx -> bad_request, other 5xx -> internal)."""
    if status_code in _STATUS_TO_CODE:
        return _STATUS_TO_CODE[status_code]
    return ErrorCode.INTERNAL_ERROR if status_code >= 500 else ErrorCode.BAD_REQUEST


class ErrorDetail(BaseModel):
    """One field-level problem; ``field`` is the camelCase JSON path (``food.categories.0``)."""

    field: str
    code: str
    message: str
    #: Only on a ``staff_changed`` refusal: the revision the account is at now (AUTH_RBAC.md
    #: §39), so an administrator can look again and repeat the change deliberately.
    current_revision: int | None = Field(default=None, serialization_alias="currentRevision")


class ErrorBody(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    code: str
    message: str
    details: list[ErrorDetail] | None = None
    request_id: str | None = None


class ErrorResponse(BaseModel):
    """The documented shape of every error response (used for OpenAPI)."""

    error: ErrorBody


class AppError(Exception):
    """A deliberate, client-safe API error. Raise it from services; handlers render the envelope."""

    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        *,
        status_code: int = 400,
        details: list[ErrorDetail] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message or DEFAULT_MESSAGES[code]
        self.status_code = status_code
        self.details = details
        self.headers = headers
        super().__init__(self.message)


def error_response(
    status_code: int,
    code: ErrorCode | str,
    message: str,
    *,
    details: list[ErrorDetail] | None = None,
    request_id: str | None = None,
    headers: dict[str, Any] | None = None,
) -> JSONResponse:
    """Build the error envelope response. Always echoes the request ID in ``X-Request-ID``."""
    body = ErrorResponse(
        error=ErrorBody(code=str(code), message=message, details=details, request_id=request_id)
    )
    response = JSONResponse(
        body.model_dump(mode="json", by_alias=True, exclude_none=True),
        status_code=status_code,
        headers=headers,
    )
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response
