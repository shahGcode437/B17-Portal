"""Read services for the public API (Phase 10D): categories, search, suggestions, detail, news.

Services own the READ rules — what is publicly visible, how user input is normalized, what a
"not found" means — and orchestrate repositories and mappers. They never commit (pure reads).

Visibility: only ``approved`` listings and ``published`` news are public. A request for anything
else — unknown id, malformed id, pending, rejected, archived, draft — gets the SAME ``not_found``
as a random UUID, so the API cannot be used to learn that a hidden record exists or why.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.errors import DEFAULT_MESSAGES, AppError, ErrorCode
from app.models.enums import (
    CategoryModule,
    NewsKind,
)
from app.repositories.listing_reads import ListingReadRepository
from app.repositories.news import NewsReadRepository
from app.repositories.search import SearchCriteria, SearchRepository, SearchRow
from app.repositories.taxonomy import CategoryRepository
from app.schemas.read import (
    BusinessHit,
    CategoryRead,
    ListingDetail,
    NewsHit,
    NewsRead,
    PropertyHit,
    ProviderHit,
    SearchHit,
    SearchQuery,
    SuggestionQuery,
    SuggestionRead,
    TutorHit,
)
from app.services.read_mappers import map_category, map_listing, map_news

#: Autocomplete needs at least this many characters (the frontend's MIN_SUGGESTION_QUERY_LENGTH).
MIN_SUGGESTION_QUERY_LENGTH = 2

KIND_LABELS = {
    "provider": "Services",
    "business": "Directory",
    "tutor": "Education",
    "property": "Property",
    "news": "News",
}


def _not_found() -> AppError:
    return AppError(ErrorCode.NOT_FOUND, DEFAULT_MESSAGES[ErrorCode.NOT_FOUND], status_code=404)


def _parse_uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise _not_found() from None  # a malformed id cannot exist: same answer as an unknown one


class CategoryReadService:
    def __init__(self, session: Session) -> None:
        self._categories = CategoryRepository(session)

    def list_public(self, module: CategoryModule | None) -> list[CategoryRead]:
        return [map_category(category) for category in self._categories.list_public(module)]


class ListingReadService:
    def __init__(self, session: Session) -> None:
        self._listings = ListingReadRepository(session)

    def get_public(self, raw_id: str) -> ListingDetail:
        listing = self._listings.get_public(_parse_uuid(raw_id))
        if listing is None:
            raise _not_found()
        return map_listing(listing, include_menu=True)


class NewsReadService:
    def __init__(self, session: Session) -> None:
        self._news = NewsReadRepository(session)

    def list_published(
        self, *, kind: NewsKind | None, limit: int, offset: int
    ) -> tuple[list[NewsRead], int]:
        total, rows = self._news.list_published(kind=kind, limit=limit, offset=offset)
        return [map_news(article) for article in rows], total

    def get_published(self, raw_id: str) -> NewsRead:
        article = self._news.get_published(_parse_uuid(raw_id))
        if article is None:
            raise _not_found()
        return map_news(article)


def to_criteria(query: SearchQuery) -> SearchCriteria:
    """Normalize raw query parameters into repository criteria.

    * ``q``: trimmed (done by the schema) and lower-cased; blank means "browse".
    * Closed value sets (``vertical``, ``service``, ``furnished``, ``listingType``, ``type``,
      ``sort``) are validated by the schema: an unknown value is a 422, never a silently broader
      query. A well-formed but unknown ``foodCategory`` slug is a normal filter on open data and
      simply matches nothing.
    """
    return SearchCriteria(
        q=query.q.lower() if query.q else None,
        type=query.type,
        area=query.area,
        category=query.category,
        subject=query.subject,
        grade=query.grade,
        bedrooms=query.bedrooms,
        furnished=query.furnished,
        listing_type=query.listing_type,
        property_type=query.property_type,
        vertical=query.vertical,
        food_category=query.food_category,
        service=query.service,
        sort=query.sort,
        limit=query.limit,
        offset=query.offset,
    )


class SearchService:
    def __init__(self, session: Session) -> None:
        self._search = SearchRepository(session)
        self._listings = ListingReadRepository(session)
        self._news = NewsReadRepository(session)

    def search(self, query: SearchQuery) -> tuple[list[SearchHit], int]:
        """One page of public hits plus the total number of matches."""
        total, rows = self._search.search(to_criteria(query))
        return self._hydrate(rows), total

    def _hydrate(self, rows: list[SearchRow]) -> list[SearchHit]:
        """Load just the page's rows (a fixed number of queries, however many hits) and map them."""
        listings = self._listings.get_public_cards([row.id for row in rows if row.kind != "news"])
        articles = self._news.get_published_many([row.id for row in rows if row.kind == "news"])
        hits: list[SearchHit] = []
        for row in rows:
            if row.kind == "news":
                if (article := articles.get(row.id)) is not None:
                    hits.append(NewsHit(kind="news", item=map_news(article)))
                continue
            listing = listings.get(row.id)
            if listing is None:  # changed visibility between the two queries: just skip it
                continue
            item = map_listing(listing, include_menu=False)
            if item.kind == "provider":
                hits.append(ProviderHit(kind="provider", item=item))
            elif item.kind == "business":
                hits.append(BusinessHit(kind="business", item=item))
            elif item.kind == "tutor":
                hits.append(TutorHit(kind="tutor", item=item))
            else:
                hits.append(PropertyHit(kind="property", item=item))
        return hits

    def suggest(self, query: SuggestionQuery) -> list[SuggestionRead]:
        """Autocomplete suggestions (the frontend's ``getSearchSuggestions`` contract)."""
        q = (query.q or "").strip().lower()
        if len(q) < MIN_SUGGESTION_QUERY_LENGTH:
            return []
        suggestions: list[SuggestionRead] = []
        for row in self._search.suggest(q, query.type, query.limit):
            kind_label = KIND_LABELS[row.kind]
            is_item = row.item_id is not None
            suggestions.append(
                SuggestionRead(
                    id=f"{row.kind}:item:{row.item_id}"
                    if is_item
                    else f"{row.kind}:term:{row.label.lower()}",
                    label=row.label,
                    secondary_label=f"{kind_label} · {row.subtitle}"
                    if is_item and row.subtitle
                    else kind_label,
                    type=row.kind,
                    value=row.label,
                )
            )
        return suggestions
