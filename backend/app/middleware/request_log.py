"""Request logging and the global error boundary.

Writes one structured log line per request (method, path, status, duration) and is the last line
of defence for unexpected exceptions: it logs them server-side with the request ID and answers with
the generic ``internal_error`` envelope, so no traceback, SQL or path ever reaches a client.

The query string is deliberately not logged (it may carry tokens or personal data).
"""

import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import DEFAULT_MESSAGES, ErrorCode, error_response

logger = logging.getLogger("app.request")


class RequestLogMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started_at = time.perf_counter()
        status = 500
        response_started = False

        async def send_tracking(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_tracking)
        except Exception:
            logger.exception("Unhandled exception while handling request")
            if response_started:
                raise  # too late to send a clean error; let the server close the connection
            request_id = scope.get("state", {}).get("request_id")
            response = error_response(
                500,
                ErrorCode.INTERNAL_ERROR,
                DEFAULT_MESSAGES[ErrorCode.INTERNAL_ERROR],
                request_id=request_id,
            )
            await response(scope, receive, send_tracking)
        finally:
            route = scope.get("route")
            logger.log(
                logging.ERROR if status >= 500 else logging.INFO,
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "route": getattr(route, "path", None),
                    "status": status,
                    "durationMs": round((time.perf_counter() - started_at) * 1000, 2),
                },
            )
