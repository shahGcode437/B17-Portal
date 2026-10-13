"""Request-scoped database session.

    request -> Session -> service (commits/rolls back) -> repositories (add/query/flush) -> close

A session is created per request and always closed afterwards; closing rolls back anything a
service did not commit. Tests replace this dependency with ``app.dependency_overrides``.
"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode


def get_db_session(request: Request) -> Iterator[Session]:
    factory = request.app.state.db_session_factory
    if factory is None:
        # No DATABASE_URL: the service cannot do database work. Never reveal why or where.
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, status_code=503)
    session: Session = factory()
    try:
        yield session
    finally:
        session.close()


DbSession = Annotated[Session, Depends(get_db_session)]
