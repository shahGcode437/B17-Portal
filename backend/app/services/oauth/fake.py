"""A deterministic in-process provider for development and tests (never hosted).

``GOOGLE_OAUTH_PROVIDER=fake`` selects it; settings refuse it in staging/production. It implements
the same :class:`OAuthProvider` protocol as the real Google adapter, so the B-17 orchestration
(state, nonce, PKCE, browser binding, account resolution, sessions) runs unchanged on top of it —
only the *provider* is simulated. The real adapter's verification logic is tested separately with a
mock HTTP transport and genuinely signed ID tokens.

The "authorization code" a test (or a developer's curl) gives the callback describes the outcome::

    fake|ok|<sub>|<email>|<verified 0/1>|<display name>     a verified sign-in
    fake|wrongnonce|<sub>|<email>|<verified>|<name>          the ID token carries a different nonce
    fake|denied                                              the user refused consent
    fake|invalid                                             Google rejects the code
    fake|timeout                                             Google cannot be reached

The fake also enforces PKCE and the nonce like Google would: when it issued the authorization URL
in this process it remembers the ``code_challenge`` for the nonce and rejects a wrong verifier.
"""

import threading

from app.models.enums import AuthProvider
from app.services.oauth.provider import (
    OAuthIdentity,
    OAuthProviderError,
    code_challenge_s256,
)

FAKE_AUTHORIZE_URL = "https://fake-google.invalid/authorize"


def fake_code(
    subject: str,
    email: str,
    *,
    verified: bool = True,
    name: str = "Fake Google User",
    scenario: str = "ok",
) -> str:
    """Build a fake authorization code for ``subject`` (see the module docstring)."""
    return f"fake|{scenario}|{subject}|{email}|{int(verified)}|{name}"


class FakeOAuthProvider:
    name = AuthProvider.GOOGLE

    def __init__(self) -> None:
        self._challenges: dict[str, str] = {}
        self._lock = threading.Lock()
        #: Every exchange attempt, for assertions: (code, verifier, redirect_uri, nonce).
        self.exchanges: list[tuple[str, str, str, str]] = []

    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str, redirect_uri: str
    ) -> str:
        with self._lock:
            self._challenges[nonce] = code_challenge
        from urllib.parse import urlencode

        query = urlencode(
            {
                "response_type": "code",
                "client_id": "fake-client-id",
                "redirect_uri": redirect_uri,
                "scope": "openid email profile",
                "state": state,
                "nonce": nonce,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
        return f"{FAKE_AUTHORIZE_URL}?{query}"

    def exchange(
        self, *, code: str, code_verifier: str, redirect_uri: str, nonce: str
    ) -> OAuthIdentity:
        self.exchanges.append((code, code_verifier, redirect_uri, nonce))
        parts = code.split("|")
        if len(parts) < 2 or parts[0] != "fake":
            raise OAuthProviderError("oauth_failed")
        scenario = parts[1]
        if scenario == "denied":
            raise OAuthProviderError("oauth_denied")
        if scenario in {"invalid", "timeout"}:
            raise OAuthProviderError("oauth_failed")
        with self._lock:
            challenge = self._challenges.get(nonce)
        if challenge is not None and challenge != code_challenge_s256(code_verifier):
            raise OAuthProviderError("oauth_failed")  # PKCE: the verifier does not match
        if scenario not in {"ok", "wrongnonce"} or len(parts) < 6:
            raise OAuthProviderError("oauth_failed")
        return OAuthIdentity(
            provider=AuthProvider.GOOGLE,
            subject=parts[2],
            email=parts[3] or None,
            email_verified=parts[4] == "1",
            name=parts[5] or None,
            nonce="a-different-nonce" if scenario == "wrongnonce" else nonce,
        )
