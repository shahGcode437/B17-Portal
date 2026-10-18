"""Central request-level security for cookie authentication (docs/backend/AUTH_RBAC.md §6).

One ASGI middleware, applied to every route under the API prefix (so future endpoints are covered
without anyone remembering to opt in):

1. **Origin** — every unsafe request (POST/PUT/PATCH/DELETE) must carry an ``Origin`` header that
   exactly matches a configured frontend origin. No ``Referer`` fallback; ``null`` is rejected.
2. **Sec-Fetch-Site** — defence in depth: when present it must be ``same-origin``/``same-site``.
   Its absence never fails a request on its own.
3. **CSRF token** — an unsafe request that carries the session cookie must also carry
   ``X-CSRF-Token`` equal to the token derived from that cookie. Endpoints that run *before* a
   session exists (register, login, forgot/reset password, verify-email) are exempt from the token
   — they are protected by 1, 2 and the JSON-only content type.
4. **Content type** — auth endpoints accept JSON bodies only (``415`` otherwise). This is scoped to
   ``/auth/``; future upload routes may accept multipart and are protected by 1-3 like any other.
5. **Caching** — every response under ``/auth/`` and ``/users/me/`` (the signed-in user's own
   resources, Phase 12D) is ``Cache-Control: no-store``, errors included. Public read APIs are not
   touched; the owner WRITE routes under ``/listings`` set it themselves.

Failures are the normal error envelope (``csrf_failed`` 403 / ``bad_request`` 415) with the request
id. The middleware sits inside CORS (so a browser can read the 403) and inside the request log.
"""

from collections.abc import Collection

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import DEFAULT_MESSAGES, ErrorCode, error_response
from app.core.security.csrf import (
    CSRF_HEADER,
    UNSAFE_METHODS,
    fetch_site_allowed,
    origin_allowed,
)
from app.core.security.tokens import csrf_token_matches

#: Auth endpoints that are reachable without a session (no CSRF token can exist yet).
PRE_SESSION_AUTH_PATHS = frozenset(
    {"register", "login", "forgot-password", "reset-password", "verify-email"}
)


class AuthSecurityMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        api_prefix: str,
        allowed_origins: Collection[str],
        cookie_name: str,
    ) -> None:
        self.app = app
        self._prefix = api_prefix.rstrip("/")
        self._auth_prefix = f"{self._prefix}/auth/"
        self._private_prefixes = (self._auth_prefix, f"{self._prefix}/users/me/")
        self._allowed_origins = frozenset(allowed_origins)
        self._cookie_name = cookie_name

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        is_private = path.startswith(self._private_prefixes)
        in_api = path.startswith(f"{self._prefix}/")

        async def send_with_headers(message: Message) -> None:
            if is_private and message["type"] == "http.response.start":
                headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        rejection = self._reject(scope, path) if in_api else None
        if rejection is not None:
            request_id = scope.get("state", {}).get("request_id")
            response = error_response(
                rejection[0],
                rejection[1],
                DEFAULT_MESSAGES[rejection[1]],
                request_id=request_id,
            )
            await response(scope, receive, send_with_headers)
            return
        await self.app(scope, receive, send_with_headers)

    def _reject(self, scope: Scope, path: str) -> tuple[int, ErrorCode] | None:
        method: str = scope["method"]
        if method not in UNSAFE_METHODS:
            return None
        request = Request(scope)
        if not origin_allowed(request.headers.get("origin"), self._allowed_origins):
            return 403, ErrorCode.CSRF_FAILED
        if not fetch_site_allowed(request.headers.get("sec-fetch-site")):
            return 403, ErrorCode.CSRF_FAILED
        if path.startswith(self._auth_prefix):
            content_type = request.headers.get("content-type")
            if content_type is not None:
                media_type = content_type.split(";", 1)[0].strip().lower()
                if media_type != "application/json":
                    return 415, ErrorCode.BAD_REQUEST
        session_token = request.cookies.get(self._cookie_name)
        endpoint = path.removeprefix(self._auth_prefix)
        pre_session = path.startswith(self._auth_prefix) and endpoint in PRE_SESSION_AUTH_PATHS
        if (
            session_token is not None
            and not pre_session
            and not csrf_token_matches(session_token, request.headers.get(CSRF_HEADER))
        ):
            return 403, ErrorCode.CSRF_FAILED
        return None
