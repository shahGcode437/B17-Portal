"""OAuth/OIDC sign-in (Phase 11C): the provider boundary, the Google adapter and a dev/test fake."""

from app.core.config import Settings
from app.models.enums import AuthProvider
from app.services.oauth.fake import FakeOAuthProvider
from app.services.oauth.google import GoogleOAuthProvider
from app.services.oauth.provider import OAuthProvider


def create_oauth_providers(settings: Settings) -> dict[AuthProvider, OAuthProvider]:
    """The configured providers by name (empty when Google sign-in is disabled)."""
    if settings.google_oauth_provider == "fake":
        return {AuthProvider.GOOGLE: FakeOAuthProvider()}
    if settings.google_oauth_provider == "google":
        assert settings.google_oauth_client_id and settings.google_oauth_client_secret
        return {
            AuthProvider.GOOGLE: GoogleOAuthProvider(
                client_id=settings.google_oauth_client_id,
                client_secret=settings.google_oauth_client_secret,
            )
        }
    return {}
