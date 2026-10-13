"""The API error contract (docs/backend/API_CONTRACT.md §3): one envelope for every non-2xx.

    {"error": {"code": "...", "message": "...", "details": [...], "requestId": "..."}}

Messages are safe to show to users. Stack traces, SQL, exception class names and file paths never
reach a client; unexpected failures are logged server-side with the request ID instead.
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from starlette.responses import JSONResponse


class ErrorCode(StrEnum):
    """Stable, machine-readable error codes clients may branch on."""

    BAD_REQUEST = "bad_request"
    UNAUTHENTICATED = "unauthenticated"
    FORBIDDEN = "forbidden"
    PLAN_LIMIT_REACHED = "plan_limit_reached"
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
    ErrorCode.PLAN_LIMIT_REACHED: "Your plan's listing limit has been reached.",
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
