"""The Google OpenID Connect adapter (authorization-code flow with PKCE).

* The authorization URL carries ``response_type=code``, ``scope=openid email profile``, our client
  id, the exact registered redirect URI, ``state``, ``nonce`` and the S256 ``code_challenge``.
* ``exchange`` posts the code to Google's token endpoint **server-to-server** with the client secret
  (``client_secret_post``) and the PKCE ``code_verifier``, then verifies the returned ID token with
  PyJWT: RS256 signature against Google's JWKS (cached), ``iss``, ``aud`` (a single string equal to
  our client id), ``exp`` and ``iat`` (30 s clock-skew leeway), a non-empty string ``sub``, then the
  ``nonce``. An ``email`` string is required and ``email_verified`` must be a real JSON boolean.
  The access/refresh tokens in the response are never read.
* HTTP goes through an injectable ``httpx.Client`` so tests exercise this real code path with a
  mock transport — no test ever contacts Google.

Failures (network error, non-200, malformed JSON, bad signature, wrong issuer/audience/nonce,
expired token, missing ``sub``/``email``, a non-boolean ``email_verified``) all become
:class:`OAuthProviderError`; no provider text, token, code or secret is logged or surfaced.
"""

import hmac
import logging
import threading
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from pydantic import SecretStr

from app.models.enums import AuthProvider
from app.services.oauth.provider import OAuthIdentity, OAuthProviderError

logger = logging.getLogger("app.oauth")

AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPES = "openid email profile"
_JWKS_TTL_SECONDS = 3600
_CLOCK_SKEW_LEEWAY_SECONDS = 30
_MAX_FIELD = 255


class GoogleOAuthProvider:
    name = AuthProvider.GOOGLE

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: SecretStr,
        http: httpx.Client | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = http or httpx.Client(timeout=timeout_seconds)
        self._keys: dict[str, jwt.PyJWK] = {}
        self._keys_fetched_at: float | None = None
        self._lock = threading.Lock()

    # -- authorization URL -------------------------------------------------------------------

    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str, redirect_uri: str
    ) -> str:
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": SCOPES,
                "state": state,
                "nonce": nonce,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
        return f"{AUTHORIZATION_ENDPOINT}?{query}"

    # -- code exchange + identity verification -----------------------------------------------

    def exchange(
        self, *, code: str, code_verifier: str, redirect_uri: str, nonce: str
    ) -> OAuthIdentity:
        id_token = self._redeem_code(code, code_verifier, redirect_uri)
        claims = self._verify_id_token(id_token)
        token_nonce = claims.get("nonce")
        if not isinstance(token_nonce, str) or not hmac.compare_digest(
            token_nonce.encode(), nonce.encode()
        ):
            raise OAuthProviderError("oauth_failed")
        return self._identity(claims)

    def _redeem_code(self, code: str, code_verifier: str, redirect_uri: str) -> str:
        try:
            response = self._http.post(
                TOKEN_ENDPOINT,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret.get_secret_value(),
                    "code_verifier": code_verifier,
                },
                headers={"Accept": "application/json"},
            )
            if response.status_code != 200:
                raise OAuthProviderError("oauth_failed")
            body = response.json()
        except OAuthProviderError:
            raise
        except (httpx.HTTPError, ValueError):
            logger.warning("oauth token exchange failed", extra={"stage": "token_exchange"})
            raise OAuthProviderError("oauth_failed") from None
        id_token = body.get("id_token") if isinstance(body, dict) else None
        if not isinstance(id_token, str) or not id_token:
            raise OAuthProviderError("oauth_failed")
        return id_token  # the access/refresh tokens in `body` are intentionally never touched

    def _signing_key(self, kid: str) -> jwt.PyJWK:
        """The key for ``kid``. A known kid in a fresh cache is used as is; an unknown kid (a key
        rotation) or a stale cache refreshes Google's JWKS **once** and retries the lookup; a kid
        that is still unknown fails. The ``kid`` comes from an ID token that Google itself just
        returned from the token endpoint, so an attacker cannot drive refreshes with chosen kids."""
        with self._lock:
            fetched_at = self._keys_fetched_at
            fresh = fetched_at is not None and time.monotonic() - fetched_at <= _JWKS_TTL_SECONDS
            key = self._keys.get(kid) if fresh else None
            if key is None:
                self._keys = self._fetch_keys()
                self._keys_fetched_at = time.monotonic()
                key = self._keys.get(kid)
        if key is None:
            raise OAuthProviderError("oauth_failed")
        return key

    def _fetch_keys(self) -> dict[str, jwt.PyJWK]:
        try:
            response = self._http.get(JWKS_URI, headers={"Accept": "application/json"})
            if response.status_code != 200:
                raise OAuthProviderError("oauth_failed")
            document = response.json()
            entries = document["keys"]
            if not isinstance(entries, list):
                raise OAuthProviderError("oauth_failed")
            keys: dict[str, jwt.PyJWK] = {}
            for entry in entries:
                parsed = self._parse_key(entry)
                if parsed is not None:
                    keys[parsed[0]] = parsed[1]
        except OAuthProviderError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            logger.warning("oauth key fetch failed", extra={"stage": "jwks"})
            raise OAuthProviderError("oauth_failed") from None
        if not keys:  # an empty or entirely unusable key set verifies nothing
            logger.warning("oauth key fetch failed", extra={"stage": "jwks"})
            raise OAuthProviderError("oauth_failed")
        return keys

    @staticmethod
    def _parse_key(entry: object) -> tuple[str, jwt.PyJWK] | None:
        """One usable RS256 signing key, or ``None``: a single odd entry never poisons the set."""
        if not isinstance(entry, dict):
            return None
        kid = entry.get("kid")
        if (
            not isinstance(kid, str)
            or entry.get("kty") != "RSA"
            or entry.get("alg", "RS256") != "RS256"
            or entry.get("use", "sig") != "sig"
        ):
            return None
        try:
            return kid, jwt.PyJWK(entry)
        except (jwt.PyJWTError, ValueError, TypeError):
            return None

    def _verify_id_token(self, id_token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(id_token)
            kid = header.get("kid")
            if header.get("alg") != "RS256" or not isinstance(kid, str):
                raise OAuthProviderError("oauth_failed")
            key = self._signing_key(kid)
            claims: dict[str, Any] = jwt.decode(
                id_token,
                key.key,
                algorithms=["RS256"],
                audience=self._client_id,
                issuer=list(ISSUERS),
                leeway=_CLOCK_SKEW_LEEWAY_SECONDS,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except OAuthProviderError:
            raise
        except jwt.PyJWTError:
            raise OAuthProviderError("oauth_failed") from None
        # Strict single audience for this web client: Google issues `aud` as one string, so a
        # multi-audience token (which PyJWT would accept if it merely contained our id) is refused.
        if claims.get("aud") != self._client_id:
            raise OAuthProviderError("oauth_failed")
        return claims

    @staticmethod
    def _identity(claims: dict[str, Any]) -> OAuthIdentity:
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject or len(subject) > _MAX_FIELD:
            raise OAuthProviderError("oauth_failed")
        email = claims.get("email")
        if not isinstance(email, str) or not email.strip() or len(email) > _MAX_FIELD:
            raise OAuthProviderError("oauth_failed")  # the `email` scope was requested: required
        name = claims.get("name")
        verified = claims.get("email_verified", False)
        if not isinstance(verified, bool):  # a real JSON boolean only; "true"/1/"yes" are refused
            raise OAuthProviderError("oauth_failed")
        return OAuthIdentity(
            provider=AuthProvider.GOOGLE,
            subject=subject,
            email=email,
            email_verified=verified,
            name=name[:_MAX_FIELD] if isinstance(name, str) else None,
            nonce=claims.get("nonce") if isinstance(claims.get("nonce"), str) else None,
        )
