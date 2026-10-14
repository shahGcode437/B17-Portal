"""Public news and daily updates."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.db import DbSession
from app.schemas.envelope import Envelope, PagedEnvelope, PageMeta
from app.schemas.read import NewsQuery, NewsRead
from app.services.public_reads import NewsReadService

router = APIRouter(route_class=ContractRoute, tags=["news"])


@router.get("/news", response_model=PagedEnvelope[NewsRead], summary="List published news")
def list_news(session: DbSession, query: Annotated[NewsQuery, Query()]) -> PagedEnvelope[NewsRead]:
    """Published news and daily updates, newest publication date first; optional ``kind``."""
    items, total = NewsReadService(session).list_published(
        kind=query.kind, limit=query.limit, offset=query.offset
    )
    return PagedEnvelope(
        data=items, meta=PageMeta(total=total, limit=query.limit, offset=query.offset)
    )


@router.get(
    "/news/{article_id}",
    response_model=Envelope[NewsRead],
    summary="Get one published news item",
    responses={404: {"model": ErrorResponse, "description": "Unknown or not published"}},
)
def get_news(article_id: str, session: DbSession) -> Envelope[NewsRead]:
    """One published item by id (a UUID — news has no separate public slug). Drafts answer 404."""
    return Envelope(data=NewsReadService(session).get_published(article_id))
