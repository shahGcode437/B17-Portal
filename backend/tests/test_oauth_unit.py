"""Google OAuth building blocks that need no database (docs/backend/AUTH_RBAC.md §10, §17).

* the open-redirect validator,
* PKCE,
* the settings that switch Google on (and keep the client secret secret),
* the dev/test fake provider,
* the REAL Google adapter, driven through a mock HTTP transport with genuinely RS256-signed ID
  tokens — so signature, issuer, audience, expiry and nonce checks are exercised for real while no
  test (or CI run) ever contacts Google.
"""

import base64
import hashlib
import hmac
import json
import logging
import socket
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.core.security.redirects import (
    DEFAULT_RETURN_TO,
    MAX_RETURN_TO_LENGTH,
    InvalidReturnTo,
    is_safe_return_to,
    resolve_return_to,
)
from app.models.enums import AuthProvider
from app.services.oauth import create_oauth_providers
from app.services.oauth.fake import FakeOAuthProvider, fake_code
from app.services.oauth.google import (
    AUTHORIZATION_ENDPOINT,
    ISSUERS,
    JWKS_URI,
    TOKEN_ENDPOINT,
    GoogleOAuthProvider,
)
from app.services.oauth.provider import (
    OAuthIdentity,
    OAuthProviderError,
    code_challenge_s256,
    new_code_verifier,
)

ORIGIN = "https://app.example.org"
API = "https://api.example.org"
REDIRECT = f"{API}/api/v1/auth/oauth/google/callback"
CLIENT_ID = "1234567890-abc.apps.googleusercontent.com"
CLIENT_SECRET = "GOCSPX-super-secret-client-value"
NONCE = "n" * 43
VERIFIER = "v" * 64
CODE = "4/0AX4XfWh-the-authorization-code"
HOSTED = {"frontend_origins": [ORIGIN], "frontend_base_url": ORIGIN}


def settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


# -- the open-redirect validator ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "safe",
    [
        "/",
        "/saved",
        "/professional/listings/new",
        "/search",
        "/a-b_c.d~e",
        "/caf%C3%A9",
        "/news/some-article-1",
        "/" + "a" * (MAX_RETURN_TO_LENGTH - 1),
    ],
)
def test_safe_relative_paths_are_accepted_unchanged(safe: str) -> None:
    assert is_safe_return_to(safe) and resolve_return_to(safe) == safe


@pytest.mark.parametrize(
    "unsafe",
    [
        "",
        "saved",  # not rooted
        "//evil.example",  # scheme-relative
        "///evil.example",
        "/\\evil.example",  # backslash confusion
        "\\evil.example",
        "https://evil.example",
        "http://evil.example/path",
        "javascript:alert(1)",
        "data:text/html,x",
        "/%2F%2Fevil.example",  # encoded // after decoding
        "/%2f/evil.example",
        "/%5Cevil.example",  # encoded backslash
        "/%255Cevil.example",  # double-encoded backslash
        "/%2e%2e/secret",  # encoded dot segments
        "/a/../b",
        "/a/./b",
        "/%00",
        "/a%0d%0aSet-Cookie:x=1",  # CRLF injection
        "/a b",
        "/a\tb",
        "/a\nb",
        "/a\x7fb",
        "/path?next=https://evil.example",  # the frozen class has no query string
        "/path#fragment",
        "/api",
        "/api/v1/auth/me",
        "/API/v1/auth/me",
        "/%61pi/v1",
        "/admin/login",
        "/admin/login/",
        "/ADMIN/LOGIN",
        "/admin/%6Cogin",
        "/" + "a" * MAX_RETURN_TO_LENGTH,  # one over the limit
        "/é",  # non-ASCII is outside the frozen class
        "/<script>",
        "/a'b\"c",
    ],
)
def test_anything_suspicious_is_rejected_and_never_cleaned_into_something_else(unsafe: str) -> None:
    assert not is_safe_return_to(unsafe)
    if unsafe.strip():  # an explicitly supplied unsafe value is an error, never silently "/"
        with pytest.raises(InvalidReturnTo) as error:
            resolve_return_to(unsafe)
        assert unsafe not in str(error.value)
    else:  # empty / whitespace-only is blank, which means "no returnTo"
        assert resolve_return_to(unsafe) == "/"


@pytest.mark.parametrize("blank", [None, "", " ", "   ", "\t", "\n"])
def test_an_absent_or_blank_return_to_is_the_root(blank: str | None) -> None:
    assert resolve_return_to(blank) == DEFAULT_RETURN_TO == "/"


def test_the_validator_is_the_only_gate_to_the_redirect_target() -> None:
    """A validated path appended to the configured origin can never change the host."""
    base = "https://app.example.org"
    for path in ("/", "/saved", "/caf%C3%A9", "/a;b", "/a@b", "/a:b"):
        assert is_safe_return_to(path)
        assert urlparse(f"{base}{path}").netloc == "app.example.org"


# -- PKCE ----------------------------------------------------------------------------------------------------


def test_the_s256_challenge_matches_the_rfc_7636_test_vector() -> None:
    assert (
        code_challenge_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )


def test_verifiers_are_long_unique_and_unpadded() -> None:
    verifiers = {new_code_verifier() for _ in range(100)}

    assert len(verifiers) == 100
    assert all(43 <= len(v) <= 128 and "=" not in v for v in verifiers)
    assert all("=" not in code_challenge_s256(v) for v in verifiers)


# -- settings: Google on/off and the client secret --------------------------------------------------------------


def test_google_sign_in_is_off_by_default_and_nothing_is_built() -> None:
    config = settings(environment="test")

    assert config.google_oauth_provider == "disabled"
    assert create_oauth_providers(config) == {}


def test_the_google_provider_needs_credentials_and_a_public_api_url() -> None:
    with pytest.raises(ValidationError, match="API_PUBLIC_BASE_URL"):
        settings(environment="test", google_oauth_provider="google")
    with pytest.raises(ValidationError, match="GOOGLE_OAUTH_CLIENT_ID"):
        settings(environment="test", google_oauth_provider="google", api_public_base_url=API)
    with pytest.raises(ValidationError, match="GOOGLE_OAUTH_CLIENT_ID"):
        settings(
            environment="test",
            google_oauth_provider="google",
            api_public_base_url=API,
            google_oauth_client_id=CLIENT_ID,
        )
    ok = settings(
        environment="test",
        google_oauth_provider="google",
        api_public_base_url=API,
        google_oauth_client_id=CLIENT_ID,
        google_oauth_client_secret=CLIENT_SECRET,
    )
    assert isinstance(create_oauth_providers(ok)[AuthProvider.GOOGLE], GoogleOAuthProvider)


def test_the_callback_url_comes_only_from_configuration() -> None:
    config = settings(environment="test", google_oauth_provider="fake", api_public_base_url=API)

    assert config.google_redirect_uri == REDIRECT


def test_the_fake_provider_can_never_run_in_staging_or_production() -> None:
    for environment in ("staging", "production"):
        with pytest.raises(ValidationError, match="fake"):
            settings(
                environment=environment,
                google_oauth_provider="fake",
                api_public_base_url=API,
                **HOSTED,
            )
    assert isinstance(
        create_oauth_providers(settings(environment="development", google_oauth_provider="fake"))[
            AuthProvider.GOOGLE
        ],
        FakeOAuthProvider,
    )


def test_a_hosted_google_provider_needs_an_https_callback() -> None:
    kwargs: dict[str, Any] = {
        "environment": "production",
        "google_oauth_provider": "google",
        "google_oauth_client_id": CLIENT_ID,
        "google_oauth_client_secret": CLIENT_SECRET,
        **HOSTED,
    }
    with pytest.raises(ValidationError, match="https"):
        settings(api_public_base_url="http://api.example.org", **kwargs)
    assert settings(api_public_base_url=API, **kwargs).google_redirect_uri == REDIRECT


def test_empty_google_credentials_mean_unset() -> None:
    config = settings(
        environment="test", google_oauth_client_id="  ", google_oauth_client_secret=""
    )

    assert config.google_oauth_client_id is None and config.google_oauth_client_secret is None


def test_the_client_secret_never_appears_in_repr_dumps_or_json() -> None:
    config = settings(
        environment="test",
        google_oauth_provider="google",
        api_public_base_url=API,
        google_oauth_client_id=CLIENT_ID,
        google_oauth_client_secret=CLIENT_SECRET,
    )
    provider = create_oauth_providers(config)[AuthProvider.GOOGLE]

    for text in (
        repr(config),
        str(config),
        config.model_dump_json(),
        str(config.model_dump()),
        repr(provider),
    ):
        assert CLIENT_SECRET not in text
    assert config.google_oauth_client_secret is not None
    assert config.google_oauth_client_secret.get_secret_value() == CLIENT_SECRET


def test_the_oauth_cookie_is_separate_from_the_session_cookie_per_environment() -> None:
    development = settings(environment="development")
    production = settings(environment="production", **HOSTED)

    assert (development.oauth_cookie_name, development.auth_cookie_name) == (
        "b17_oauth",
        "b17_session",
    )
    assert (production.oauth_cookie_name, production.auth_cookie_name) == (
        "__Host-b17_oauth",
        "__Host-b17_session",
    )


# -- the fake provider ----------------------------------------------------------------------------------------


def test_the_fake_provider_describes_the_outcome_in_its_code() -> None:
    fake = FakeOAuthProvider()

    identity = fake.exchange(
        code=fake_code("sub-9", "a@example.org", verified=False, name="Ann"),
        code_verifier=VERIFIER,
        redirect_uri=REDIRECT,
        nonce=NONCE,
    )

    assert (identity.subject, identity.email, identity.email_verified, identity.name) == (
        "sub-9",
        "a@example.org",
        False,
        "Ann",
    )
    assert identity.nonce == NONCE and identity.provider is AuthProvider.GOOGLE


@pytest.mark.parametrize(
    ("scenario", "kind"),
    [("denied", "oauth_denied"), ("invalid", "oauth_failed"), ("timeout", "oauth_failed")],
)
def test_the_fake_provider_can_simulate_provider_failures(scenario: str, kind: str) -> None:
    with pytest.raises(OAuthProviderError) as error:
        FakeOAuthProvider().exchange(
            code=f"fake|{scenario}", code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE
        )

    assert error.value.kind == kind and str(error.value) == kind


def test_the_fake_provider_enforces_pkce_like_google_would() -> None:
    fake = FakeOAuthProvider()
    verifier = new_code_verifier()
    fake.authorization_url(
        state="s", nonce=NONCE, code_challenge=code_challenge_s256(verifier), redirect_uri=REDIRECT
    )

    good = fake.exchange(
        code=fake_code("s", "a@b.org"), code_verifier=verifier, redirect_uri=REDIRECT, nonce=NONCE
    )
    assert good.subject == "s"
    with pytest.raises(OAuthProviderError):
        fake.exchange(
            code=fake_code("s", "a@b.org"),
            code_verifier=new_code_verifier(),  # not the verifier of the issued challenge
            redirect_uri=REDIRECT,
            nonce=NONCE,
        )


# -- the real Google adapter, against a mock transport ----------------------------------------------------------


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def other_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def jwk_for(key: rsa.RSAPrivateKey, kid: str) -> dict[str, Any]:
    document = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    return {**document, "kid": kid, "alg": "RS256", "use": "sig"}


def pem(key: rsa.RSAPrivateKey) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


def claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    values: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "110169484474386276334",
        "email": "gina@example.org",
        "email_verified": True,
        "name": "Gina Khan",
        "nonce": NONCE,
        "iat": now,
        "exp": now + 3600,
    }
    values.update(overrides)
    return {k: v for k, v in values.items() if v is not None}


class FakeGoogle:
    """A scripted Google: records every request and serves the token endpoint and the JWKS."""

    def __init__(self, key: rsa.RSAPrivateKey, *, kid: str = "kid-1") -> None:
        self.key, self.kid = key, kid
        self.requests: list[httpx.Request] = []
        self.id_token: str | None = None
        self.token_status = 200
        self.token_body: Any = None
        self.jwks_status = 200
        self.jwks_keys: list[dict[str, Any]] = [jwk_for(key, kid)]
        self.jwks_body: Any = None
        self.error: Exception | None = None

    def sign(
        self,
        token_claims: dict[str, Any],
        *,
        key: rsa.RSAPrivateKey | None = None,
        kid: str | None = "kid-1",
        algorithm: str = "RS256",
    ) -> str:
        headers = {"kid": kid} if kid is not None else {}
        return jwt.encode(token_claims, pem(key or self.key), algorithm=algorithm, headers=headers)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        url = str(request.url)
        if request.method == "POST" and url == TOKEN_ENDPOINT:
            body = self.token_body
            if body is None:
                body = {
                    "access_token": "ya29.SECRET-ACCESS-TOKEN",
                    "refresh_token": "1//SECRET-REFRESH-TOKEN",
                    "id_token": self.id_token,
                    "token_type": "Bearer",
                    "expires_in": 3599,
                }
            if isinstance(body, bytes):
                return httpx.Response(self.token_status, content=body)
            return httpx.Response(self.token_status, json=body)
        if request.method == "GET" and url == JWKS_URI:
            if isinstance(self.jwks_body, bytes):
                return httpx.Response(self.jwks_status, content=self.jwks_body)
            if self.jwks_body is not None:
                return httpx.Response(self.jwks_status, json=self.jwks_body)
            return httpx.Response(self.jwks_status, json={"keys": self.jwks_keys})
        raise AssertionError(f"unexpected request to {url}")  # nothing else may ever be contacted

    def count(self, url: str) -> int:
        return sum(1 for r in self.requests if str(r.url) == url)


def provider_for(google: FakeGoogle) -> GoogleOAuthProvider:
    return GoogleOAuthProvider(
        client_id=CLIENT_ID,
        client_secret=SecretStr(CLIENT_SECRET),
        http=httpx.Client(transport=httpx.MockTransport(google.handler)),
    )


@pytest.fixture
def google(signing_key: rsa.RSAPrivateKey) -> FakeGoogle:
    return FakeGoogle(signing_key)


def exchange(
    google: FakeGoogle, token_claims: dict[str, Any] | None = None, **kw: Any
) -> OAuthIdentity:
    if google.id_token is None:
        google.id_token = google.sign(token_claims if token_claims is not None else claims(), **kw)
    return provider_for(google).exchange(
        code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE
    )


def test_the_authorization_url_has_every_required_parameter() -> None:
    provider = GoogleOAuthProvider(client_id=CLIENT_ID, client_secret=SecretStr(CLIENT_SECRET))

    url = provider.authorization_url(
        state="STATE", nonce="NONCE", code_challenge="CHALLENGE", redirect_uri=REDIRECT
    )

    parsed = urlparse(url)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == AUTHORIZATION_ENDPOINT
    query = {k: v[0] for k, v in parse_qs(parsed.query).items()}  # order is irrelevant
    assert query == {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": "openid email profile",
        "state": "STATE",
        "nonce": "NONCE",
        "code_challenge": "CHALLENGE",
        "code_challenge_method": "S256",
    }
    assert CLIENT_SECRET not in url


def test_a_valid_id_token_yields_the_verified_identity(google: FakeGoogle) -> None:
    identity = exchange(google)

    assert identity == OAuthIdentity(
        provider=AuthProvider.GOOGLE,
        subject="110169484474386276334",
        email="gina@example.org",
        email_verified=True,
        name="Gina Khan",
        nonce=NONCE,
    )


def test_the_code_is_redeemed_server_side_with_pkce_and_the_client_secret(
    google: FakeGoogle,
) -> None:
    exchange(google)

    (token_request,) = [r for r in google.requests if str(r.url) == TOKEN_ENDPOINT]
    form = {k: v[0] for k, v in parse_qs(token_request.content.decode()).items()}
    assert form == {
        "grant_type": "authorization_code",
        "code": CODE,
        "redirect_uri": REDIRECT,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code_verifier": VERIFIER,
    }
    assert token_request.method == "POST"


def test_provider_tokens_are_never_part_of_the_result(google: FakeGoogle) -> None:
    identity = exchange(google)

    text = repr(identity)
    assert "ya29" not in text and "SECRET" not in text and CODE not in text
    assert not any(
        hasattr(identity, name) for name in ("access_token", "refresh_token", "id_token")
    )


@pytest.mark.parametrize(("raw", "expected"), [(True, True), (False, False)])
def test_email_verified_is_read_from_a_real_json_boolean(
    google: FakeGoogle, raw: bool, expected: bool
) -> None:
    assert exchange(google, claims(email_verified=raw)).email_verified is expected


def test_a_missing_email_verified_claim_means_unverified(google: FakeGoogle) -> None:
    assert exchange(google, claims(email_verified=None)).email_verified is False


@pytest.mark.parametrize("raw", ["true", "false", "True", "yes", 1, 0, "", [], {}])
def test_a_non_boolean_email_verified_is_refused_outright(google: FakeGoogle, raw: Any) -> None:
    with pytest.raises(OAuthProviderError):
        exchange(google, claims(email_verified=raw))


@pytest.mark.parametrize(
    ("label", "token_claims"),
    [
        ("wrong audience", claims(aud="someone-elses-client-id")),
        ("wrong issuer", claims(iss="https://evil.example")),
        ("expired", claims(exp=int(time.time()) - 120, iat=int(time.time()) - 3600)),
        # evaluated at collection time: a day ahead, so a long test run cannot make it "past"
        ("issued in the future", claims(iat=int(time.time()) + 86_400)),
        ("string issued-at", claims(iat="yesterday")),
        ("string expiry", claims(exp="tomorrow")),
        ("audience is a list with ours and another", claims(aud=[CLIENT_ID, "someone-else"])),
        ("audience is a list with only ours", claims(aud=[CLIENT_ID])),
        ("audience of another client", claims(aud="999-other.apps.googleusercontent.com")),
        ("no email", claims(email=None)),
        ("empty email", claims(email="")),
        ("blank email", claims(email="   ")),
        ("numeric email", claims(email=12345)),
        ("list email", claims(email=["a@example.org"])),
        ("issuer lookalike", claims(iss="https://accounts.google.com.evil.example")),
        ("issuer http", claims(iss="http://accounts.google.com")),
        ("no expiry", claims(exp=None)),
        ("no issued-at", claims(iat=None)),
        ("no issuer", claims(iss=None)),
        ("no audience", claims(aud=None)),
        ("no subject", claims(sub=None)),
        ("empty subject", claims(sub="")),
        ("numeric subject", claims(sub=12345)),
        ("wrong nonce", claims(nonce="x" * 43)),
        ("missing nonce", claims(nonce=None)),
        ("numeric nonce", claims(nonce=123)),
    ],
)
def test_an_id_token_that_fails_validation_is_refused(
    google: FakeGoogle, label: str, token_claims: dict[str, Any]
) -> None:
    with pytest.raises(OAuthProviderError) as error:
        exchange(google, token_claims)

    assert error.value.kind == "oauth_failed" and str(error.value) == "oauth_failed", label


def test_both_documented_google_issuers_are_accepted(google: FakeGoogle) -> None:
    for issuer in ISSUERS:
        google.id_token = None
        assert exchange(google, claims(iss=issuer)).subject


def test_a_token_signed_with_another_key_is_refused(
    google: FakeGoogle, other_key: rsa.RSAPrivateKey
) -> None:
    with pytest.raises(OAuthProviderError):
        exchange(google, claims(), key=other_key)  # right kid, wrong signature


def test_an_unknown_key_id_is_refused_after_one_refetch(google: FakeGoogle) -> None:
    with pytest.raises(OAuthProviderError):
        exchange(google, claims(), kid="rotated-away")
    assert google.count(JWKS_URI) == 1


@pytest.mark.parametrize("kid", [None])
def test_a_token_without_a_key_id_is_refused(google: FakeGoogle, kid: str | None) -> None:
    with pytest.raises(OAuthProviderError):
        exchange(google, claims(), kid=kid)


def test_algorithm_confusion_and_unsigned_tokens_are_refused(
    google: FakeGoogle, signing_key: rsa.RSAPrivateKey
) -> None:
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    public_pem = signing_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    # The classic downgrade: HS256 with the *public* key as the HMAC secret (built by hand, since
    # PyJWT itself refuses to produce it).
    signing_input = (
        b64(json.dumps({"alg": "HS256", "kid": "kid-1", "typ": "JWT"}).encode())
        + "."
        + b64(json.dumps(claims()).encode())
    )
    mac = hmac.new(public_pem, signing_input.encode(), hashlib.sha256).digest()
    hs256 = f"{signing_input}.{b64(mac)}"
    unsigned = jwt.encode(claims(), "", algorithm="none", headers={"kid": "kid-1"})
    for forged in (hs256, unsigned, "not.a.jwt", "", "a.b.c"):
        google.id_token = forged
        with pytest.raises(OAuthProviderError):
            provider_for(google).exchange(
                code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE
            )


def test_the_key_set_is_cached_between_exchanges(google: FakeGoogle) -> None:
    provider = provider_for(google)
    google.id_token = google.sign(claims())

    for _ in range(3):
        provider.exchange(code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE)

    assert google.count(JWKS_URI) == 1 and google.count(TOKEN_ENDPOINT) == 3


def exchange_with(provider: GoogleOAuthProvider) -> OAuthIdentity:
    return provider.exchange(code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE)


def test_a_known_kid_uses_the_cached_key_without_any_refresh(google: FakeGoogle) -> None:
    provider = provider_for(google)
    google.id_token = google.sign(claims())
    exchange_with(provider)

    google.jwks_status = 500  # Google's key endpoint going down changes nothing for a cached kid
    assert exchange_with(provider).subject and google.count(JWKS_URI) == 1


def test_an_unknown_kid_refreshes_the_key_set_once_and_a_rotated_key_verifies(
    google: FakeGoogle, other_key: rsa.RSAPrivateKey
) -> None:
    provider = provider_for(google)
    google.id_token = google.sign(claims())
    exchange_with(provider)  # primes the cache with kid-1 only
    assert google.count(JWKS_URI) == 1

    google.jwks_keys.append(jwk_for(other_key, "kid-2"))  # Google rotates in a new key...
    google.id_token = google.sign(claims(), key=other_key, kid="kid-2")  # ...and signs with it

    assert exchange_with(provider).subject  # immediately: one refresh, then the retry succeeds
    assert google.count(JWKS_URI) == 2
    exchange_with(provider)  # and the new key is now cached
    assert google.count(JWKS_URI) == 2


def test_a_kid_that_is_still_unknown_after_the_refresh_fails_safely(
    google: FakeGoogle, other_key: rsa.RSAPrivateKey
) -> None:
    provider = provider_for(google)
    google.id_token = google.sign(claims())
    exchange_with(provider)
    google.id_token = google.sign(claims(), key=other_key, kid="never-published")

    with pytest.raises(OAuthProviderError) as error:
        exchange_with(provider)

    assert str(error.value) == "oauth_failed" and google.count(JWKS_URI) == 2  # exactly one refresh


def test_a_stale_key_cache_is_refreshed(google: FakeGoogle) -> None:
    provider = provider_for(google)
    google.id_token = google.sign(claims())
    exchange_with(provider)
    assert provider._keys_fetched_at is not None
    provider._keys_fetched_at -= 2 * 3600  # older than the cache lifetime

    exchange_with(provider)

    assert google.count(JWKS_URI) == 2


@pytest.mark.parametrize(
    "jwks_body",
    [
        b"<html>not json</html>",
        b"",
        [],  # a JSON array, not an object
        "keys",
        {},
        {"keys": None},
        {"keys": "nope"},
        {"keys": {"kid-1": "x"}},
        {"keys": [None, 5, "x", []]},
        {"keys": [{"kid": "kid-1"}]},  # no key material
        {"keys": [{"kid": "kid-1", "kty": "RSA", "n": "!!", "e": "AQAB"}]},  # not base64url
        {"keys": [{"kid": "kid-1", "kty": "RSA"}]},
        {"keys": [{"kid": "kid-1", "kty": "oct", "k": "c2VjcmV0"}]},  # a symmetric key
        {"keys": [{"kty": "RSA", "n": "AQAB", "e": "AQAB"}]},  # no kid
        {"keys": []},
    ],
)
def test_a_malformed_key_set_fails_safely(google: FakeGoogle, jwks_body: Any) -> None:
    google.id_token = google.sign(claims())
    google.jwks_body = jwks_body

    with pytest.raises(OAuthProviderError) as error:
        exchange_with(provider_for(google))

    assert str(error.value) == "oauth_failed"


def test_one_unusable_key_never_poisons_the_rest_of_the_set(
    google: FakeGoogle, signing_key: rsa.RSAPrivateKey
) -> None:
    google.id_token = google.sign(claims())
    google.jwks_body = {
        "keys": [
            {"kid": "junk", "kty": "RSA", "n": "!!", "e": "AQAB"},
            {"kid": "ec", "kty": "EC", "crv": "P-256", "x": "AA", "y": "AA"},
            "not even an object",
            jwk_for(signing_key, "kid-1"),
        ]
    }

    assert exchange_with(provider_for(google)).subject


def test_a_key_set_entry_for_another_algorithm_is_not_used(
    google: FakeGoogle, signing_key: rsa.RSAPrivateKey
) -> None:
    google.id_token = google.sign(claims())
    google.jwks_body = {"keys": [{**jwk_for(signing_key, "kid-1"), "alg": "RS384"}]}

    with pytest.raises(OAuthProviderError):
        exchange_with(provider_for(google))


def test_a_wrong_header_algorithm_is_refused_even_with_the_right_key(
    google: FakeGoogle, signing_key: rsa.RSAPrivateKey
) -> None:
    for algorithm in ("RS384", "RS512", "PS256"):
        google.id_token = jwt.encode(
            claims(), pem(signing_key), algorithm=algorithm, headers={"kid": "kid-1"}
        )
        with pytest.raises(OAuthProviderError):
            exchange_with(provider_for(google))


def test_a_small_clock_skew_is_tolerated_but_not_a_large_one(google: FakeGoogle) -> None:
    near = int(time.time())
    google.id_token = google.sign(claims(iat=near + 20, exp=near + 3600))
    assert exchange_with(provider_for(google)).subject  # Google's clock a few seconds ahead of ours

    google.id_token = google.sign(claims(iat=near - 7200, exp=near - 20))
    assert exchange_with(provider_for(google)).subject  # just expired inside the leeway

    google.id_token = google.sign(claims(iat=near - 7200, exp=near - 300))
    with pytest.raises(OAuthProviderError):
        exchange_with(provider_for(google))


def test_key_set_failures_log_no_raw_provider_error(
    google: FakeGoogle, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    google.id_token = google.sign(claims())
    google.jwks_body = b"<html>SECRET-LEAK-MARKER internal error trace</html>"
    with pytest.raises(OAuthProviderError):
        exchange_with(provider_for(google))
    google.jwks_body = None
    google.error = httpx.ConnectError("SECRET-LEAK-MARKER dns failure")
    with pytest.raises(OAuthProviderError):
        exchange_with(provider_for(google))

    logged = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)

    assert "SECRET-LEAK-MARKER" not in logged and "dns failure" not in logged


@pytest.mark.parametrize(
    "script",
    [
        {
            "token_status": 400,
            "token_body": {"error": "invalid_grant", "error_description": "Bad code"},
        },
        {"token_status": 500, "token_body": {"error": "server_error"}},
        {"token_status": 200, "token_body": b"<html>not json</html>"},
        {"token_status": 200, "token_body": {"access_token": "x"}},  # no id_token
        {"token_status": 200, "token_body": {"id_token": 12345}},
        {"token_status": 200, "token_body": ["id_token"]},
        {"jwks_status": 500},
        {"jwks_keys": []},
        {"error": httpx.ConnectError("name resolution failed")},
        {"error": httpx.ReadTimeout("timed out")},
    ],
)
def test_provider_and_network_failures_become_a_fixed_failure(
    google: FakeGoogle, script: dict[str, Any]
) -> None:
    google.id_token = google.sign(claims())
    for key, value in script.items():
        setattr(google, key, value)

    with pytest.raises(OAuthProviderError) as error:
        provider_for(google).exchange(
            code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE
        )

    assert error.value.kind == "oauth_failed" and str(error.value) == "oauth_failed"
    assert error.value.__cause__ is None or "Bad code" not in str(error.value)


def test_failures_log_no_secret_code_or_token(
    google: FakeGoogle, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    google.id_token = google.sign(claims())
    for failure in ({"token_status": 400}, {"error": httpx.ConnectError("boom")}):
        provider = provider_for(google)
        for key, value in failure.items():
            setattr(google, key, value)
        with pytest.raises(OAuthProviderError):
            provider.exchange(code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE)
    google.token_status, google.error = 200, None
    google.id_token = google.sign(claims(nonce="mismatch" + "x" * 35))
    with pytest.raises(OAuthProviderError):
        provider_for(google).exchange(
            code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce=NONCE
        )

    logged = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)

    for secret in (
        CLIENT_SECRET,
        CODE,
        VERIFIER,
        NONCE,
        google.id_token or "<none>",
        "ya29",
        "1//SECRET",
    ):
        assert secret not in logged


def test_only_the_two_documented_google_endpoints_are_ever_contacted(
    google: FakeGoogle, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_sockets(*args: object, **kwargs: object) -> None:
        raise AssertionError("a real network connection was attempted")

    monkeypatch.setattr(socket.socket, "connect", no_sockets)
    monkeypatch.setattr(socket, "getaddrinfo", no_sockets)

    exchange(google)

    assert {str(r.url) for r in google.requests} == {TOKEN_ENDPOINT, JWKS_URI}
    assert all(
        r.url.host in {"oauth2.googleapis.com", "www.googleapis.com"} for r in google.requests
    )


def test_exchange_rejects_a_nonce_that_differs_from_the_flow(google: FakeGoogle) -> None:
    google.id_token = google.sign(claims())

    with pytest.raises(OAuthProviderError):
        provider_for(google).exchange(
            code=CODE, code_verifier=VERIFIER, redirect_uri=REDIRECT, nonce="o" * 43
        )
