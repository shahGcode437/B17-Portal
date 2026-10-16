"""Application factory.

Kept separate from ``app.main`` so importing it has no side effects: tests (and any other caller)
build an app from explicit ``Settings`` without touching the real environment or ``.env``.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.api.error_handlers import register_exception_handlers
from app.api.v1.router import api_router
from app.core.clock import utcnow
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.core.security.passwords import PasswordService
from app.db.session import create_db_engine, create_session_factory
from app.middleware.auth_security import AuthSecurityMiddleware
from app.middleware.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from app.middleware.request_log import RequestLogMiddleware
from app.services.email import create_email_sender

# The request headers the API contract uses (docs/backend/API_CONTRACT.md); others are refused.
CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "X-CSRF-Token",
    REQUEST_ID_HEADER,
    "If-Match",
    "Idempotency-Key",
]
CORS_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.effective_log_level)

    # The engine is a lazy connection pool: creating it opens no connection, so the API starts (and
    # /health stays up) even when the database is down. /health/ready is what reports on it.
    engine = create_db_engine(settings) if settings.database_url is not None else None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if engine is not None:
            engine.dispose()

    prefix = settings.api_v1_prefix
    docs = settings.docs_enabled
    app = FastAPI(
        lifespan=lifespan,
        title=settings.app_name,
        version=settings.app_version,
        # Interactive docs and the OpenAPI document are published outside production only.
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url=f"{prefix}/openapi.json" if docs else None,
    )
    app.state.settings = settings
    app.state.db_engine = engine
    app.state.db_session_factory = create_session_factory(engine) if engine is not None else None
    # Authentication collaborators (Phase 11B). Tests replace ``clock`` / ``email_sender``.
    app.state.clock = utcnow
    app.state.password_service = PasswordService.from_settings(settings)
    app.state.email_sender = create_email_sender(settings)

    register_exception_handlers(app)

    # Middleware order: the LAST one added is the outermost. Request ID wraps everything (so every
    # response, CORS preflights included, carries it); CORS wraps the error boundary so even 500
    # responses are readable by the browser; the log/error boundary sits closest to the routes.
    app.add_middleware(
        AuthSecurityMiddleware,
        api_prefix=prefix,
        allowed_origins=settings.frontend_origins,
        cookie_name=settings.auth_cookie_name,
    )
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,  # explicit origins only, never "*"
        allow_credentials=True,  # cookie sessions (Phase 11B); safe only with exact origins
        allow_methods=CORS_ALLOWED_METHODS,
        allow_headers=CORS_ALLOWED_HEADERS,
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIdMiddleware)

    app.include_router(api_router, prefix=prefix)
    return app
