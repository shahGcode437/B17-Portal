"""The session cookie (docs/backend/AUTH_RBAC.md §5) — the only place its attributes are decided.

``HttpOnly`` always; ``Secure`` per settings (forced on in staging/production); ``SameSite=Lax``;
``Path=/``; **never a ``Domain``** (host-only, which is also what the ``__Host-`` prefix requires).
The value is the raw random session secret and nothing else.
"""

from fastapi import Response

from app.core.config import Settings


def set_session_cookie(
    response: Response, settings: Settings, token: str, max_age_seconds: int
) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=max_age_seconds,
        path="/",
        secure=bool(settings.auth_cookie_secure),
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value="",
        max_age=0,
        expires=0,
        path="/",
        secure=bool(settings.auth_cookie_secure),
        httponly=True,
        samesite="lax",
    )


def clear_cookie_header(settings: Settings) -> str:
    """The raw ``Set-Cookie`` value that clears the session cookie (for error responses)."""
    carrier = Response()
    clear_session_cookie(carrier, settings)
    return carrier.headers["set-cookie"]


#: An OAuth round trip is valid for 10 minutes (``OAUTH_FLOW_TTL``); the cookie lives as long.
OAUTH_FLOW_COOKIE_MAX_AGE = 600


def set_oauth_flow_cookie(response: Response, settings: Settings, token: str) -> None:
    """The browser-binding cookie of an OAuth flow: ``HttpOnly``, ``SameSite=Lax`` (so Google's
    top-level redirect back to the callback carries it), host-only, short-lived, and entirely
    separate from the B-17 session cookie."""
    response.set_cookie(
        key=settings.oauth_cookie_name,
        value=token,
        max_age=OAUTH_FLOW_COOKIE_MAX_AGE,
        path="/",
        secure=bool(settings.auth_cookie_secure),
        httponly=True,
        samesite="lax",
    )


def clear_oauth_flow_cookie(response: Response, settings: Settings) -> None:
    response.set_cookie(
        key=settings.oauth_cookie_name,
        value="",
        max_age=0,
        expires=0,
        path="/",
        secure=bool(settings.auth_cookie_secure),
        httponly=True,
        samesite="lax",
    )
