"""The OAuth/OIDC provider boundary (docs/backend/AUTH_RBAC.md §10.6).

Everything provider-specific (endpoints, scopes, token exchange, ID-token verification) lives behind
:class:`OAuthProvider`; the B-17 orchestration (:mod:`app.services.oauth.flow`) only ever sees a
verified :class:`OAuthIdentity`. A future Facebook/Apple adapter implements the same protocol.

Provider tokens are used inside ``exchange`` and **discarded**: nothing here returns, stores or logs
an access token, refresh token, ID token or authorization code.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import Literal, Protocol

from app.models.enums import AuthProvider

#: Fixed, user-safe failure kinds (they become the ``?error=`` code of the frontend redirect).
OAuthFailure = Literal["oauth_denied", "oauth_failed"]


class OAuthProviderError(Exception):
    """The provider refused, failed or returned something unverifiable. Carries no provider text."""

    def __init__(self, kind: OAuthFailure = "oauth_failed") -> None:
        self.kind: OAuthFailure = kind
        super().__init__(kind)


@dataclass(frozen=True)
class OAuthIdentity:
    """What B-17 learns from a successful sign-in: *who*, never a token."""

    provider: AuthProvider
    #: The provider's stable subject (OIDC ``sub``) — the only identity key. Never the email.
    subject: str
    email: str | None
    #: Only ``True`` when the provider explicitly asserted the email as verified.
    email_verified: bool
    name: str | None
    #: The ``nonce`` claim of the verified ID token (the orchestrator re-checks it independently).
    nonce: str | None


class OAuthProvider(Protocol):
    name: AuthProvider

    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str, redirect_uri: str
    ) -> str:
        """The provider URL the browser is sent to (authorization-code flow + PKCE S256)."""
        ...

    def exchange(
        self, *, code: str, code_verifier: str, redirect_uri: str, nonce: str
    ) -> OAuthIdentity:
        """Redeem the code (server-to-server, with the PKCE verifier) and verify the identity.

        Raises :class:`OAuthProviderError` for any failure; never returns provider tokens.
        """
        ...


# -- PKCE (RFC 7636) ---------------------------------------------------------------------------


def new_code_verifier() -> str:
    """A 64-character high-entropy PKCE verifier (RFC 7636 allows 43-128)."""
    return secrets.token_urlsafe(48)


def code_challenge_s256(verifier: str) -> str:
    """``BASE64URL(SHA256(verifier))`` without padding."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
