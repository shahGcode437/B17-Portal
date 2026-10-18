"""Exception handlers that render every error through the shared envelope (core/errors.py).

Unexpected (non-HTTP) exceptions are handled one layer out, by ``RequestLogMiddleware``, which
logs them and answers with the generic ``internal_error`` envelope.
"""

from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.core.errors import (
    DEFAULT_MESSAGES,
    AppError,
    ErrorCode,
    ErrorDetail,
    code_for_status,
    error_response,
)

_REQUEST_PARTS = {"body", "query", "path", "header", "cookie"}
#: Pydantic inserts the discriminator TAG of a tagged-union member into the error location
#: (``body.provider.name``); the tag is not part of the JSON path a client sent (``name``).
_UNION_TAGS = {"provider", "business", "tutor", "property"}
#: A missing / unknown ``kind`` of a tagged union (the location is the whole body).
_UNION_TAG_ERRORS = {"union_tag_invalid", "union_tag_not_found"}
_MAX_DETAILS = 50


def _request_id(request: Request) -> str | None:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else None


def _field_path(loc: tuple[Any, ...]) -> str:
    """``("body", "food", "categories", 0)`` -> ``"food.categories.0"`` (request part dropped)."""
    parts = list(loc)
    source = parts.pop(0) if parts and parts[0] in _REQUEST_PARTS else None
    if source == "body" and len(parts) > 1 and parts[0] in _UNION_TAGS:
        parts.pop(0)
    names = [str(part) for part in parts]
    if not names or all(isinstance(part, int) for part in parts):
        return str(source or "request")
    return ".".join(names)


def validation_details(errors: list[Any]) -> list[ErrorDetail]:
    """Reduce pydantic's errors to ``{field, code, message}`` — never the input value or context."""
    return [
        ErrorDetail(
            field=(
                "kind"
                if error.get("type") in _UNION_TAG_ERRORS
                else _field_path(tuple(error.get("loc", ())))
            ),
            code=str(error.get("type", "invalid")),
            message=str(error.get("msg", "Invalid value.")),
        )
        for error in errors[:_MAX_DETAILS]
    ]


async def handle_app_error(request: Request, exc: Exception) -> JSONResponse:
    error = cast(AppError, exc)
    return error_response(
        error.status_code,
        error.code,
        error.message,
        details=error.details,
        request_id=_request_id(request),
        headers=error.headers,
    )


async def handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    http_error = cast(StarletteHTTPException, exc)
    code = code_for_status(http_error.status_code)
    # The framework's own detail text ("Not Found", ...) is replaced by our fixed, safe message.
    return error_response(
        http_error.status_code,
        code,
        DEFAULT_MESSAGES[code],
        request_id=_request_id(request),
        headers=dict(http_error.headers) if http_error.headers else None,
    )


async def handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    validation_error = cast(RequestValidationError, exc)
    errors = validation_error.errors()
    if any(error.get("type") == "json_invalid" for error in errors):
        return error_response(
            400,
            ErrorCode.BAD_REQUEST,
            "The request body is not valid JSON.",
            request_id=_request_id(request),
        )
    return error_response(
        422,
        ErrorCode.VALIDATION_ERROR,
        DEFAULT_MESSAGES[ErrorCode.VALIDATION_ERROR],
        details=validation_details(list(errors)),
        request_id=_request_id(request),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
