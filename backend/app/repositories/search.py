"""Public search and suggestions — filtering, ranking, counting and paging all run in PostgreSQL.

Nothing is loaded into Python to be filtered or sorted: a search page costs a COUNT, one page of
``(kind, id)`` rows from a UNION of the listing and news branches, and then (in the service) a
bounded hydration of just those rows.

Semantics are the frontend's ``searchAll`` / ``getSearchSuggestions`` (src/services/search.ts):

* **Visibility.** Only ``status = 'approved'`` listings and ``status = 'published'`` news are ever
  selected. Nothing else can appear in results, counts or suggestions.
* **Text.** Case-insensitive substring match on the lower-cased ``search_document`` (news: the same
  fields computed in the query). ``LIKE`` metacharacters in the user's text are escaped.
* **Filters are kind-aware**, exactly like the frontend's ``matchesFilters``: a filter constrains
  only the kinds that have that field, and a hit of another kind is not excluded by it (the UI
  never combines them; the API preserves the frontend rule rather than inventing a stricter one).
* **Ordering.** With ``q``: tiered relevance on the TITLE — exact, starts-with, word-prefix,
  contains, then "matched elsewhere" — then shorter title, then kind, title and id (deterministic).
  Without ``q``: the frontend's natural order — kind (provider, business, tutor, property, news),
  then creation time (news: newest published first), then id. ``sort=newest``: news by
  publication date first, then the natural order.
"""

import re
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    Integer,
    Select,
    String,
    Uuid,
    and_,
    case,
    cast,
    exists,
    func,
    literal,
    null,
    or_,
    select,
    true,
    union_all,
)
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql.elements import ColumnElement

from app.models import (
    BusinessProfile,
    Category,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    NewsArticle,
    PropertyProfile,
    TutorProfile,
)
from app.models.enums import (
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    Furnishing,
    ListingKind,
    ListingStatus,
    NewsStatus,
    PropertyListingType,
)

SearchType = Literal["all", "provider", "business", "tutor", "property", "news"]
SortOption = Literal["default", "newest"]

#: The frontend's KIND_ORDER (providers first, news last): the natural browse order.
KIND_ORDER = ("provider", "business", "tutor", "property", "news")
LIKE_ESCAPE = "\\"
_REGEX_SPECIAL = re.compile(r"([\\^$.|?*+()\[\]{}])")


def escape_like(value: str) -> str:
    """Neutralize ``LIKE`` wildcards in user text (``%``, ``_`` and the escape character itself)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def contains_pattern(value: str) -> str:
    return f"%{escape_like(value)}%"


def _regex_escape(value: str) -> str:
    return _REGEX_SPECIAL.sub(r"\\\1", value)


def _kind_order(kind: Any) -> ColumnElement[int]:
    return case(*[(kind == name, position) for position, name in enumerate(KIND_ORDER, 1)], else_=9)


def relevance_rank(text: Any, q: str) -> ColumnElement[int]:
    """0 exact, 1 starts-with, 2 word-prefix, 3 contains (all on ``text``), 4 anything else.

    ``text`` and ``q`` are both already lower-cased. "Word-prefix" means the match begins right
    after a non-alphanumeric character (the frontend's ``suggestionRank`` rule).
    """
    return case(
        (text == q, 0),
        (text.like(f"{escape_like(q)}%", escape=LIKE_ESCAPE), 1),
        (text.op("~")(f"(^|[^[:alnum:]]){_regex_escape(q)}"), 2),
        (text.like(contains_pattern(q), escape=LIKE_ESCAPE), 3),
        else_=4,
    )


def _sale_or_rent(listing_type: Any) -> ColumnElement[str]:
    return case((listing_type == PropertyListingType.SALE, "For Sale"), else_="For Rent")


def _capitalize(value: Any) -> ColumnElement[str]:
    """First letter upper-cased — the frontend's ``capitalizeFirst`` for tag-like terms."""
    return func.concat(func.upper(func.left(value, 1)), func.substr(value, 2))


def _news_document(news: Any, category: Any) -> ColumnElement[str]:
    """News has no stored document (small, admin-authored): the same fields, built in the query."""
    tags = func.array_to_string(news.tags, " ")
    return func.lower(func.concat_ws(" ", news.title, category.name, news.summary, tags))


@dataclass(frozen=True)
class SearchCriteria:
    q: str | None  # trimmed and lower-cased; ``None`` = browse
    type: SearchType = "all"
    area: str | None = None
    category: str | None = None
    subject: str | None = None
    grade: str | None = None
    bedrooms: int | None = None
    furnished: Furnishing | None = None
    listing_type: PropertyListingType | None = None
    property_type: str | None = None
    vertical: BusinessVertical | None = None
    food_category: str | None = None
    service: FoodServiceOption | None = None
    sort: SortOption = "default"
    limit: int = 12
    offset: int = 0


@dataclass(frozen=True)
class SearchRow:
    kind: str
    id: uuid.UUID


@dataclass(frozen=True)
class SuggestionRow:
    kind: str
    label: str
    item_id: uuid.UUID | None
    subtitle: str | None


class SearchRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # ------------------------------------------------------------------ search

    def search(self, criteria: SearchCriteria) -> tuple[int, list[SearchRow]]:
        """``(total matches, one page of (kind, id))`` in the order described in the module doc."""
        branches: list[Select[Any]] = []
        if criteria.type != "news":
            branches.append(self._listing_branch(criteria))
        if criteria.type in {"all", "news"}:
            branches.append(self._news_branch(criteria))
        hits = (union_all(*branches) if len(branches) > 1 else branches[0]).subquery("hits")

        total = self._session.scalar(select(func.count()).select_from(hits)) or 0
        if criteria.sort == "newest":
            order = [
                hits.c.published_at.desc().nulls_last(),
                hits.c.kind_order,
                hits.c.browse_key,
                hits.c.id,
            ]
        elif criteria.q:
            order = [
                hits.c.rank,
                hits.c.title_len,
                hits.c.kind_order,
                hits.c.title_lower,
                hits.c.id,
            ]
        else:
            order = [hits.c.kind_order, hits.c.browse_key, hits.c.id]
        rows = self._session.execute(
            select(hits.c.kind, hits.c.id)
            .order_by(*order)
            .limit(criteria.limit)
            .offset(criteria.offset)
        ).all()
        return total, [SearchRow(kind=row.kind, id=row.id) for row in rows]

    def _listing_branch(self, c: SearchCriteria) -> Select[Any]:
        listing = Listing
        kind_text = cast(listing.kind, String)
        title_lower = func.lower(listing.title)
        columns: list[Any] = [
            kind_text.label("kind"),
            listing.id.label("id"),
            title_lower.label("title_lower"),
            func.char_length(listing.title).label("title_len"),
            _kind_order(kind_text).label("kind_order"),
            cast(func.extract("epoch", listing.created_at), Float).label("browse_key"),
            cast(null(), Date).label("published_at"),
            (relevance_rank(title_lower, c.q) if c.q else literal(0, Integer)).label("rank"),
        ]
        statement: Select[Any] = (
            select(*columns).select_from(listing).where(listing.status == ListingStatus.APPROVED)
        )
        if c.type != "all":
            statement = statement.where(listing.kind == ListingKind(c.type))
        if c.q:
            statement = statement.where(
                listing.search_document.like(contains_pattern(c.q), escape=LIKE_ESCAPE)
            )
        return self._apply_listing_filters(statement, c)

    def _apply_listing_filters(self, statement: Select[Any], c: SearchCriteria) -> Select[Any]:
        listing = Listing

        def applies(kinds: set[ListingKind], predicate: Any) -> ColumnElement[bool]:
            return or_(listing.kind.not_in(kinds), predicate)

        if c.area:
            statement = statement.where(listing.area == c.area)

        if c.category or c.subject or c.property_type:
            link, primary = aliased(ListingCategory), aliased(Category)
            statement = statement.outerjoin(
                link, and_(link.listing_id == listing.id, link.position == 1)
            ).outerjoin(primary, primary.id == link.category_id)
            if c.category:
                kinds = {ListingKind.PROVIDER, ListingKind.BUSINESS}
                statement = statement.where(applies(kinds, primary.slug == c.category))
            if c.subject:
                statement = statement.where(applies({ListingKind.TUTOR}, primary.slug == c.subject))
            if c.property_type:
                statement = statement.where(
                    applies({ListingKind.PROPERTY}, primary.slug == c.property_type)
                )

        if c.grade:
            tutor = aliased(TutorProfile)
            statement = statement.outerjoin(tutor, tutor.listing_id == listing.id).where(
                applies({ListingKind.TUTOR}, tutor.grade == c.grade)
            )

        if c.listing_type or c.bedrooms or c.furnished:
            prop = aliased(PropertyProfile)
            statement = statement.outerjoin(prop, prop.listing_id == listing.id)
            if c.listing_type:
                statement = statement.where(
                    applies({ListingKind.PROPERTY}, prop.listing_type == c.listing_type)
                )
            if c.bedrooms:
                statement = statement.where(
                    applies(
                        {ListingKind.PROPERTY},
                        and_(prop.bedrooms.is_not(None), prop.bedrooms >= c.bedrooms),
                    )
                )
            if c.furnished:
                statement = statement.where(
                    applies({ListingKind.PROPERTY}, prop.furnished == c.furnished)
                )

        if c.vertical:
            business = aliased(BusinessProfile)
            statement = statement.outerjoin(business, business.listing_id == listing.id).where(
                applies({ListingKind.BUSINESS}, business.vertical == c.vertical)
            )

        if c.food_category:
            # Food categories come from the normalized taxonomy — never from a display string.
            link, cat = aliased(ListingCategory), aliased(Category)
            has_category = (
                exists()
                .where(
                    link.listing_id == listing.id,
                    cat.id == link.category_id,
                    cat.module == CategoryModule.FOOD,
                    cat.slug == c.food_category,
                )
                .correlate(listing)
            )
            statement = statement.where(applies({ListingKind.BUSINESS}, has_category))

        if c.service:
            food = aliased(FoodProfile)
            statement = statement.outerjoin(food, food.listing_id == listing.id).where(
                applies({ListingKind.BUSINESS}, food.service_options.contains([c.service.value]))
            )
        return statement

    def _news_branch(self, c: SearchCriteria) -> Select[Any]:
        news, category = NewsArticle, aliased(Category)
        title_lower = func.lower(news.title)
        published_epoch = func.extract("epoch", cast(news.published_at, DateTime))
        columns: list[Any] = [
            literal("news", String).label("kind"),
            news.id.label("id"),
            title_lower.label("title_lower"),
            func.char_length(news.title).label("title_len"),
            literal(len(KIND_ORDER), Integer).label("kind_order"),
            cast(-published_epoch, Float).label("browse_key"),
            news.published_at.label("published_at"),
            (relevance_rank(title_lower, c.q) if c.q else literal(0, Integer)).label("rank"),
        ]
        statement: Select[Any] = (
            select(*columns)
            .select_from(news)
            .join(category, category.id == news.category_id)
            .where(news.status == NewsStatus.PUBLISHED)
        )
        if c.q:
            statement = statement.where(
                _news_document(news, category).like(contains_pattern(c.q), escape=LIKE_ESCAPE)
            )
        if c.category:
            statement = statement.where(category.slug == c.category)
        return statement

    # ------------------------------------------------------------------ suggestions

    def suggest(self, q: str, type_: SearchType, limit: int) -> list[SuggestionRow]:
        """Ranked, de-duplicated autocomplete terms drawn only from searchable public content.

        Candidate terms are category names, tags (and Food menu-item names), tutor grades, the
        property "For Sale/Rent" label, and listing/news titles. Rows are first narrowed by the
        trigram-indexed ``search_document`` (every term is a substring of it), then ranked like
        the frontend: exact, starts-with, word-prefix, contains; shorter label first; then label
        and kind. One row per ``(kind, lower(label))``; a category/tag beats an item title.
        """
        pattern = contains_pattern(q)
        candidates = [
            *self._listing_term_selects(pattern, type_),
            *self._news_term_selects(pattern, type_),
        ]
        if not candidates:
            return []
        union = union_all(*candidates).subquery("candidates")
        lowered = func.lower(union.c.label)
        deduped = (
            select(union.c.kind, union.c.label, union.c.item_id, union.c.subtitle)
            .where(lowered.like(pattern, escape=LIKE_ESCAPE))
            .ext(distinct_on(union.c.kind, lowered))
            .order_by(union.c.kind, lowered, union.c.role, union.c.label, union.c.item_id)
            .subquery("deduped")
        )
        final_lower = func.lower(deduped.c.label)
        rows = self._session.execute(
            select(deduped.c.kind, deduped.c.label, deduped.c.item_id, deduped.c.subtitle)
            .order_by(
                relevance_rank(final_lower, q),
                func.char_length(deduped.c.label),
                final_lower,
                deduped.c.label,
                _kind_order(deduped.c.kind),
            )
            .limit(limit)
        ).all()
        return [
            SuggestionRow(
                kind=row.kind, label=row.label, item_id=row.item_id, subtitle=row.subtitle
            )
            for row in rows
        ]

    @staticmethod
    def _terms(
        kind: Any, label: Any, role: int, item_id: Any, subtitle: Any
    ) -> list[ColumnElement[Any]]:
        return [
            kind.label("kind"),
            label.label("label"),
            literal(role, Integer).label("role"),
            cast(item_id, Uuid()).label("item_id"),
            cast(subtitle, String).label("subtitle"),
        ]

    def _listing_term_selects(self, pattern: str, type_: SearchType) -> list[Select[Any]]:
        if type_ == "news":
            return []
        listing = Listing
        kind = cast(listing.kind, String)
        base = and_(
            listing.status == ListingStatus.APPROVED,
            listing.search_document.like(pattern, escape=LIKE_ESCAPE),
        )
        scope = [listing.kind == ListingKind(type_)] if type_ != "all" else []
        term = self._terms

        link, cat = aliased(ListingCategory), aliased(Category)
        categories = (
            select(*term(kind, cat.name, 1, null(), null()))
            .select_from(listing)
            .join(link, link.listing_id == listing.id)
            .join(cat, cat.id == link.category_id)
            .where(base, *scope)
        )
        tutor = aliased(TutorProfile)
        grades = (
            select(*term(kind, tutor.grade, 1, null(), null()))
            .select_from(listing)
            .join(tutor, tutor.listing_id == listing.id)
            .where(base, *scope)
        )
        prop = aliased(PropertyProfile)
        property_labels = (
            select(*term(kind, _sale_or_rent(prop.listing_type), 1, null(), null()))
            .select_from(listing)
            .join(prop, prop.listing_id == listing.id)
            .where(base, *scope)
        )
        tag = func.unnest(listing.tags).table_valued("tag").render_derived().lateral()
        tags = (
            select(*term(kind, _capitalize(tag.c.tag), 2, null(), null()))
            .select_from(listing)
            .join(tag, true())
            .where(base, *scope)
        )
        menu = aliased(FoodMenuItem)
        menu_names = (
            select(*term(kind, _capitalize(menu.name), 2, null(), null()))
            .select_from(listing)
            .join(menu, menu.listing_id == listing.id)
            .where(base, *scope)
        )
        primary_link, primary = aliased(ListingCategory), aliased(Category)
        grade_profile, property_profile = aliased(TutorProfile), aliased(PropertyProfile)
        subtitle = case(
            (listing.kind == ListingKind.TUTOR, primary.name + " · " + grade_profile.grade),
            (
                listing.kind == ListingKind.PROPERTY,
                primary.name + " · " + _sale_or_rent(property_profile.listing_type),
            ),
            else_=primary.name,
        )
        items = (
            select(*term(kind, listing.title, 3, listing.id, subtitle))
            .select_from(listing)
            .outerjoin(
                primary_link,
                and_(primary_link.listing_id == listing.id, primary_link.position == 1),
            )
            .outerjoin(primary, primary.id == primary_link.category_id)
            .outerjoin(grade_profile, grade_profile.listing_id == listing.id)
            .outerjoin(property_profile, property_profile.listing_id == listing.id)
            .where(base, *scope)
        )
        return [categories, grades, property_labels, tags, menu_names, items]

    def _news_term_selects(self, pattern: str, type_: SearchType) -> list[Select[Any]]:
        if type_ not in {"all", "news"}:
            return []
        news, cat = NewsArticle, aliased(Category)
        kind = literal("news", String)
        base = and_(
            news.status == NewsStatus.PUBLISHED,
            _news_document(news, cat).like(pattern, escape=LIKE_ESCAPE),
        )
        term = self._terms
        categories = (
            select(*term(kind, cat.name, 1, null(), null()))
            .select_from(news)
            .join(cat, cat.id == news.category_id)
            .where(base)
        )
        tag = func.unnest(news.tags).table_valued("tag").render_derived().lateral()
        tags = (
            select(*term(kind, _capitalize(tag.c.tag), 2, null(), null()))
            .select_from(news)
            .join(cat, cat.id == news.category_id)
            .join(tag, true())
            .where(base)
        )
        items = (
            select(*term(kind, news.title, 3, news.id, cat.name))
            .select_from(news)
            .join(cat, cat.id == news.category_id)
            .where(base)
        )
        return [categories, tags, items]
