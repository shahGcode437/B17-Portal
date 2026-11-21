"""OAuth/OIDC sign-in (Phase 11C): the provider boundary, the Google adapter and a dev/test fake."""

from app.core.config import Settings
from app.models.enums import AuthProvider
from app.services.oauth.fake import FakeOAuthProvider
from app.services.oauth.google import GoogleOAuthProvider
from app.services.oauth.provider import OAuthProvider


def enabled_login_providers(settings: Settings) -> frozenset[AuthProvider]:
    """The providers an account can ACTUALLY sign in with in this configuration (empty when Google
    sign-in is disabled). The one rule: ``create_oauth_providers`` builds an adapter for exactly
    these, and the OAuth flow answers ``503`` for any provider outside it.

    Anything that needs to know whether a stored identity can authenticate RIGHT NOW — the
    last-usable-Super-Admin invariant (``AUTH_RBAC.md §27.6``) — asks here instead of restating the
    rule. It is a pure function of configuration: it builds no adapter (no HTTP client) and depends
    on nothing the browser shows. A provider that exists in the database vocabulary but is not
    returned here (``facebook``, ``apple``, or ``google`` while disabled) cannot sign anyone in."""
    if settings.google_oauth_provider in ("fake", "google"):
        return frozenset({AuthProvider.GOOGLE})
    return frozenset()


def create_oauth_providers(settings: Settings) -> dict[AuthProvider, OAuthProvider]:
    """The configured providers by name (empty when Google sign-in is disabled)."""
    providers: dict[AuthProvider, OAuthProvider] = {}
    if AuthProvider.GOOGLE in enabled_login_providers(settings):
        if settings.google_oauth_provider == "fake":
            providers[AuthProvider.GOOGLE] = FakeOAuthProvider()
        else:
            assert settings.google_oauth_client_id and settings.google_oauth_client_secret
            providers[AuthProvider.GOOGLE] = GoogleOAuthProvider(
                client_id=settings.google_oauth_client_id,
                client_secret=settings.google_oauth_client_secret,
            )
    return providers
