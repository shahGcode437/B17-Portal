"""Public search and suggestions."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.routing import ContractRoute
from app.dependencies.db import DbSession
from app.schemas.envelope import Envelope, PagedEnvelope, PageMeta
from app.schemas.read import SearchHit, SearchQuery, SuggestionQuery, SuggestionRead
from app.services.public_reads import SearchService

router = APIRouter(route_class=ContractRoute, tags=["search"])


@router.get(
    "/search",
    response_model=PagedEnvelope[SearchHit],
    summary="Search public listings and news",
)
def search(session: DbSession, query: Annotated[SearchQuery, Query()]) -> PagedEnvelope[SearchHit]:
    """Case-insensitive text search with the frontend's filters (``type``, ``vertical``,
    ``foodCategory``, ``service``, ``area``, …). Only approved listings and published news.

    With ``q`` results are ranked (exact → starts-with → word-prefix → contains, on the title);
    without it they are in the stable browse order. See docs/backend/READ_API_PARITY.md.
    """
    hits, total = SearchService(session).search(query)
    return PagedEnvelope(
        data=hits, meta=PageMeta(total=total, limit=query.limit, offset=query.offset)
    )


@router.get(
    "/search/suggestions",
    response_model=Envelope[list[SuggestionRead]],
    summary="Autocomplete suggestions",
)
def suggestions(
    session: DbSession, query: Annotated[SuggestionQuery, Query()]
) -> Envelope[list[SuggestionRead]]:
    """Up to ``limit`` ranked suggestions for ``q`` (at least 2 characters), optionally scoped by
    ``type``. Built only from public searchable content."""
    return Envelope(data=SearchService(session).suggest(query))
