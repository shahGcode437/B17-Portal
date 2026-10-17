"""Drivers for the Google OAuth tests: start a flow, then play Google's redirect back.

The real application runs end to end (routes, middleware, ``OAuthService``, PostgreSQL); only the
*provider* is the in-process ``FakeOAuthProvider``. A test "is Google" by choosing the authorization
code it hands to the callback (``fake_code``).
"""

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

from httpx import Response

from app.models.enums import AuthProvider
from app.services.oauth.fake import FakeOAuthProvider
from tests.db.auth_helpers import AuthApi, AuthEnv

START = "/auth/oauth/google/start"
CALLBACK = "/auth/oauth/google/callback"
DISCONNECT = "/auth/oauth/google"


@dataclass
class Started:
    response: Response
    api: AuthApi

    @property
    def url(self) -> str:
        return str(self.response.json()["data"]["authorizationUrl"])

    @property
    def query(self) -> dict[str, str]:
        return {key: values[0] for key, values in parse_qs(urlparse(self.url).query).items()}

    @property
    def state(self) -> str:
        return self.query["state"]

    @property
    def nonce(self) -> str:
        return self.query["nonce"]

    @property
    def challenge(self) -> str:
        return self.query["code_challenge"]

    @property
    def flow_cookie(self) -> str | None:
        value: str | None = self.api.http.cookies.get(self.api.env.settings.oauth_cookie_name)
        return value


def fake_provider(env: AuthEnv) -> FakeOAuthProvider:
    provider = env.app.state.oauth_providers[AuthProvider.GOOGLE]
    assert isinstance(provider, FakeOAuthProvider)
    return provider


def start(
    api: AuthApi, *, purpose: str = "login", return_to: str | None = None, **kwargs: Any
) -> Started:
    body: dict[str, object] = {"purpose": purpose}
    if return_to is not None:
        body["returnTo"] = return_to
    response = api.post(START, body, **kwargs)
    return Started(response, api)


def started_ok(api: AuthApi, **kwargs: Any) -> Started:
    started = start(api, **kwargs)
    assert started.response.status_code == 200, started.response.text
    return started


def callback(
    api: AuthApi,
    code: str | None,
    *,
    state: str | None,
    extra: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    """Google's redirect back to us: a top-level GET with ``code`` and ``state`` (and nothing else)."""
    params: dict[str, str] = dict(extra or {})
    if code is not None:
        params["code"] = code
    if state is not None:
        params["state"] = state
    return api.get(CALLBACK, params=params, origin=None, csrf=None, headers=headers)


def location(response: Response) -> str:
    assert response.status_code == 302, (response.status_code, response.text)
    return response.headers["location"]
