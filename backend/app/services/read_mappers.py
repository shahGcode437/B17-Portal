"""ORM objects -> public read schemas. The only place that knows both shapes.

Mapping never triggers a lazy load: callers load exactly the relations used here through
``ListingReadRepository`` (``card_options`` / ``detail_options``). Menu items are mapped only when
asked for (detail), so a search page never pays for them.
"""

from app.models import Category, Listing, NewsArticle
from app.models.enums import BusinessVertical, FoodServiceOption, ListingKind
from app.schemas.read import (
    BusinessRead,
    CategoryRead,
    CategoryRef,
    FoodRead,
    ListingDetail,
    MenuHighlightRead,
    NewsRead,
    PropertyRead,
    ProviderRead,
    TutorRead,
)


def map_category(category: Category) -> CategoryRead:
    return CategoryRead(
        id=category.id,
        module=category.module,
        slug=category.slug,
        name=category.name,
        parent_id=category.parent_id,
        display_order=category.display_order,
    )


def map_news(article: NewsArticle) -> NewsRead:
    return NewsRead(
        id=article.id,
        kind=article.kind,
        status="published",
        title=article.title,
        category=article.category.name,
        category_slug=article.category.slug,
        summary=article.summary,
        image=article.image_url,
        published_at=article.published_at,
        tags=list(article.tags),
    )


def map_listing(listing: Listing, *, include_menu: bool) -> ListingDetail:
    """One approved listing -> its kind-specific public shape (``include_menu``: Food detail)."""
    refs = [
        CategoryRef(slug=link.category.slug, name=link.category.name, is_primary=link.position == 1)
        for link in listing.categories
    ]
    primary = listing.categories[0].category if listing.categories else None
    primary_name = primary.name if primary else ""
    common = {
        "id": listing.id,
        "area": listing.area,
        "image": listing.image_url,
        "tags": list(listing.tags),
        "categories": refs,
    }
    featured = True if listing.is_featured else None

    if listing.kind is ListingKind.PROVIDER:
        return ProviderRead(
            kind="provider",
            name=listing.title,
            category=primary.slug if primary else "",
            category_label=primary_name,
            description=listing.description,
            featured=featured,
            **common,
        )

    if listing.kind is ListingKind.BUSINESS:
        business = listing.business
        assert business is not None  # guaranteed by the subtype composite FK + creation rules
        food = (
            _map_food(listing, include_menu=include_menu)
            if business.vertical is BusinessVertical.FOOD and business.food is not None
            else None
        )
        return BusinessRead(
            kind="business",
            name=listing.title,
            vertical=business.vertical,
            category=primary_name,
            description=listing.description,
            featured=featured,
            food=food,
            **common,
        )

    if listing.kind is ListingKind.TUTOR:
        tutor = listing.tutor_profile
        assert tutor is not None
        return TutorRead(
            kind="tutor",
            name=listing.title,
            subject=primary_name,
            grade=tutor.grade,
            bio=listing.description,
            **common,
        )

    prop = listing.property_profile
    assert prop is not None
    return PropertyRead(
        kind="property",
        title=listing.title,
        listing_type=prop.listing_type,
        property_type=primary_name,
        price=prop.price_text,
        description=listing.description,
        bedrooms=prop.bedrooms,
        furnished=prop.furnished,
        **common,
    )


def _map_food(listing: Listing, *, include_menu: bool) -> FoodRead:
    assert listing.business is not None and listing.business.food is not None
    food = listing.business.food
    menu = (
        [
            MenuHighlightRead(
                id=item.id,
                name=item.name,
                section=item.section,
                description=item.description,
                price=item.price_text,
            )
            for item in food.menu_items
        ]
        if include_menu and food.menu_items
        else None
    )
    return FoodRead(
        categories=[link.category.slug for link in listing.categories],
        service_options=[FoodServiceOption(value) for value in food.service_options],
        hours_note=food.hours_note,
        menu_highlights=menu,
        menu_image=food.menu_image_url,
    )
