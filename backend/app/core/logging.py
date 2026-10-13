"""Structured (JSON) logging on top of the standard library.

One JSON object per line on stdout: timestamp, level, logger, message, the request ID when there is
one, and any extra fields passed through ``logger.info(..., extra={...})``. No third-party
dependency. Never pass credentials, tokens or request bodies as log fields.
"""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

#: The current request's ID, set by the request-ID middleware.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_HANDLER_MARK = "_b17_json_handler"

# Attribute names every LogRecord has; anything else on a record came from ``extra=``.
_STANDARD_ATTRS = frozenset(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "taskName",
}


class RequestIdFilter(logging.Filter):
    """Adds ``requestId`` to a record unless the caller already supplied one."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "requestId"):
            record.requestId = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in vars(record).items():
            if key not in _STANDARD_ATTRS and not key.startswith("_") and value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class StdoutHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """Writes to whatever ``sys.stdout`` is *now*, so redirection (tests, supervisors) works."""

    def __init__(self) -> None:
        super().__init__(sys.stdout)

    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stdout
        super().emit(record)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON handler on the root logger. Safe to call more than once."""
    root = logging.getLogger()
    root.setLevel(level)

    if not any(getattr(handler, _HANDLER_MARK, False) for handler in root.handlers):
        handler = StdoutHandler()
        handler.setFormatter(JsonFormatter())
        handler.addFilter(RequestIdFilter())
        setattr(handler, _HANDLER_MARK, True)
        root.addHandler(handler)

    # uvicorn installs its own handlers; route its server logs through ours and drop its access
    # log (the request log middleware emits one structured line per request instead).
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True
