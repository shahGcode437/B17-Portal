"""Engine and session infrastructure (synchronous SQLAlchemy 2.x).

Process-level: one ``Engine`` (a connection pool) and one ``sessionmaker``, created by the app
factory. Never global: a ``Session`` is created per request (see ``app.dependencies.db``), used by
exactly one service call chain, and closed afterwards.

Transaction ownership (docs/backend/BACKEND_ARCHITECTURE.md §5): **services** open and end
transactions with :func:`transaction`; **repositories** only ``add``/query/``flush``. A session that
is closed with uncommitted work rolls it back, so a forgotten commit can never persist half a
business operation.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings


def create_db_engine(settings: Settings) -> Engine:
    """Build the engine from settings. Connections are opened lazily, on first use."""
    if settings.database_url is None:
        raise RuntimeError("DATABASE_URL is not configured")
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
    )


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    # expire_on_commit=False: objects stay readable after the service commits (no surprise lazy
    # loads on a closed/foreign session when building a response).
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def transaction(session: Session) -> Iterator[Session]:
    """Commit when the block succeeds, roll back (and re-raise) when it fails.

    The one place a business transaction ends. Used by services::

        with transaction(session):
            repository.add(...)
    """
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
