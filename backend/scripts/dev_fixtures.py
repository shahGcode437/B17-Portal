"""Development / test FIXTURES: fake users and demo listings with deterministic ids.

    python -m scripts.dev_fixtures        # development / test / staging databases only

This is NOT reference data (that is ``python -m app.db.seed``, which every environment runs). These
are fictional records, so the loader **refuses to run when ``ENVIRONMENT=production``**.

IDs: production ids are random UUIDv4 (``uuid.uuid4()``). Fixture ids are *name-based UUIDv5*
under a fixed namespace, so they are genuine UUIDs yet identical on every machine and every run —
which is what backend tests and a future full-stack E2E suite need in place of the frontend's demo
ids (``business-01``). Never use ``fixture_id`` for real data.

The content is a small, real subset of the frontend seed data (``src/data/*``). The loader is
idempotent: existing fixture rows are left alone.
"""

import sys
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.reference_data import REFERENCE_CATEGORIES
from app.db.session import create_db_engine, transaction
from app.models import (
    BusinessProfile,
    FoodMenuItem,
    FoodProfile,
    Listing,
    ListingCategory,
    ListingStatusHistory,
    NewsArticle,
    ProfessionalProfile,
    PropertyProfile,
    SavedItem,
    TutorProfile,
    User,
    UserRole,
)
from app.models.enums import (
    ActorRole,
    BusinessVertical,
    CategoryModule,
    FoodServiceOption,
    Furnishing,
    HistoryAction,
    ListingKind,
    ListingStatus,
    NewsKind,
    NewsStatus,
    PropertyListingType,
    RoleName,
)
from app.repositories.taxonomy import CategoryRepository

#: A fixed, arbitrary namespace for the fixture ids below. Changing it changes every id.
FIXTURE_NAMESPACE = uuid.UUID("5d0f6c1e-3a2b-4c8d-9e7f-1b17b17b17b1")


def fixture_id(name: str) -> uuid.UUID:
    """The deterministic id for a named fixture, e.g. ``fixture_id("listing:capital-bakers")``."""
    return uuid.uuid5(FIXTURE_NAMESPACE, name)


ADMIN_ID = fixture_id("user:admin")
PROFESSIONAL_ID = fixture_id("user:professional")
RESIDENT_ID = fixture_id("user:resident")
SOLAR_ID = fixture_id("listing:sunrise-solar")
PHARMACY_ID = fixture_id("listing:family-pharmacy")
BAKERS_ID = fixture_id("listing:capital-bakers")
HOUSE_ID = fixture_id("listing:house-block-c")
TUTOR_ID = fixture_id("listing:physics-tutor")
NEWS_ID = fixture_id("news:park-cleanup")


@dataclass(frozen=True)
class FixtureResult:
    users: int
    listings: int
    news: int


def ensure_not_production(settings: Settings) -> None:
    if settings.environment == "production":
        raise SystemExit("Refusing to load development fixtures: ENVIRONMENT is 'production'.")


def load_dev_fixtures(session: Session) -> FixtureResult:
    """Insert the fixtures that are missing. The caller owns the transaction (this only flushes)."""
    CategoryRepository(session).insert_missing(REFERENCE_CATEGORIES)
    session.flush()
    users = _users(session)
    listings = sum(
        [
            _provider(session),
            _pharmacy(session),
            _bakery(session),
            _house(session),
            _tutor(session),
        ]
    )
    news = _news(session)
    if session.get(SavedItem, (RESIDENT_ID, BAKERS_ID)) is None:
        session.add(SavedItem(user_id=RESIDENT_ID, listing_id=BAKERS_ID))
    session.flush()
    return FixtureResult(users=users, listings=listings, news=news)


# -- users ----------------------------------------------------------------------------------


def _users(session: Session) -> int:
    created = 0
    for user_id, email, name in (
        (ADMIN_ID, "admin@fixtures.example", "Fixture Admin"),
        (PROFESSIONAL_ID, "professional@fixtures.example", "Fixture Professional"),
        (RESIDENT_ID, "resident@fixtures.example", "Fixture Resident"),
    ):
        if session.get(User, user_id) is None:
            session.add(User(id=user_id, email=email, display_name=name))
            created += 1
    session.flush()
    if session.get(UserRole, (ADMIN_ID, RoleName.ADMIN)) is None:
        session.add(UserRole(user_id=ADMIN_ID, role=RoleName.ADMIN))
    if session.get(ProfessionalProfile, PROFESSIONAL_ID) is None:
        session.add(ProfessionalProfile(user_id=PROFESSIONAL_ID))
    session.flush()
    return created


# -- listings -------------------------------------------------------------------------------


def _approved_listing(
    session: Session,
    *,
    listing_id: uuid.UUID,
    kind: ListingKind,
    title: str,
    description: str,
    area: str,
    tags: list[str],
    image_url: str,
    module: CategoryModule,
    category_slugs: list[str],
    featured: bool = False,
) -> Listing | None:
    """Create an approved listing owned by the fixture professional, with categories and the
    submitted -> approved history. Returns ``None`` if it already exists."""
    if session.get(Listing, listing_id) is not None:
        return None
    categories = CategoryRepository(session).list_by_slugs(module, category_slugs)
    listing = Listing(
        id=listing_id,
        kind=kind,
        owner_id=PROFESSIONAL_ID,
        status=ListingStatus.APPROVED,
        title=title,
        description=description,
        area=area,
        tags=tags,
        image_url=image_url,
        is_featured=featured,
        revision=1,
    )
    listing.categories = [
        ListingCategory(position=position, category_id=categories[slug].id)
        for position, slug in enumerate(category_slugs, start=1)
    ]
    listing.status_history = [
        ListingStatusHistory(
            from_status=None,
            to_status=ListingStatus.PENDING,
            action=HistoryAction.SUBMITTED,
            revision=1,
            actor_user_id=PROFESSIONAL_ID,
            actor_role=ActorRole.OWNER,
        ),
        ListingStatusHistory(
            from_status=ListingStatus.PENDING,
            to_status=ListingStatus.APPROVED,
            action=HistoryAction.APPROVED,
            revision=1,
            actor_user_id=ADMIN_ID,
            actor_role=ActorRole.ADMIN,
        ),
    ]
    return listing


def _provider(session: Session) -> int:
    listing = _approved_listing(
        session,
        listing_id=SOLAR_ID,
        kind=ListingKind.PROVIDER,
        title="Sunrise Solar Solutions",
        description="Rooftop solar design and installation for homes in B-17.",
        area="B-17, Block C (Demo Area)",
        tags=["solar", "installation", "net metering"],
        image_url="/images/providers/solar-provider.jpg",
        module=CategoryModule.SERVICES,
        category_slugs=["solar"],
        featured=True,
    )
    return _save(session, listing)


def _pharmacy(session: Session) -> int:
    listing = _approved_listing(
        session,
        listing_id=PHARMACY_ID,
        kind=ListingKind.BUSINESS,
        title="B-17 Family Pharmacy",
        description="General pharmacy and healthcare essentials.",
        area="B-17, Block C (Demo Area)",
        tags=["pharmacy", "health", "medicine"],
        image_url="/images/businesses/retail-store.jpg",
        module=CategoryModule.DIRECTORY,
        category_slugs=["pharmacy"],
        featured=True,
    )
    if listing is not None:
        listing.business = BusinessProfile(vertical=BusinessVertical.GENERAL)
    return _save(session, listing)


def _bakery(session: Session) -> int:
    listing = _approved_listing(
        session,
        listing_id=BAKERS_ID,
        kind=ListingKind.BUSINESS,
        title="Capital Bakers",
        description="Fresh bread, cakes and daily bakery items.",
        area="B-17, Block C (Demo Area)",
        tags=["bakery", "cakes", "bread", "food"],
        image_url="/images/businesses/cafe.jpg",
        module=CategoryModule.FOOD,
        category_slugs=["bakeries", "sweets-desserts"],
    )
    if listing is not None:
        listing.business = BusinessProfile(vertical=BusinessVertical.FOOD)
        listing.business.food = FoodProfile(
            service_options=[FoodServiceOption.TAKEAWAY.value, FoodServiceOption.DELIVERY.value],
            hours_note="Daily, 8 AM–10 PM",
            menu_items=[
                FoodMenuItem(
                    position=1, name="Fresh Milk Bread", section="Bakery", price_text="PKR 250"
                ),
                FoodMenuItem(
                    position=2,
                    name="Chocolate Fudge Cake",
                    section="Cakes",
                    description="Made fresh daily.",
                    price_text="PKR 1,800",
                ),
                FoodMenuItem(
                    position=3, name="Chicken Patties", section="Savouries", price_text="PKR 180"
                ),
            ],
        )
    return _save(session, listing)


def _house(session: Session) -> int:
    listing = _approved_listing(
        session,
        listing_id=HOUSE_ID,
        kind=ListingKind.PROPERTY,
        title="5 Marla House — B-17 Block C",
        description="A family house in B-17 Block C.",
        area="B-17, Block C (Demo Area)",
        tags=["house", "sale", "5 marla"],
        image_url="/images/properties/house-sale-01.jpg",
        module=CategoryModule.PROPERTY,
        category_slugs=["house"],
    )
    if listing is not None:
        listing.property_profile = PropertyProfile(
            listing_type=PropertyListingType.SALE,
            price_text="PKR 2.2 Cr",
            bedrooms=3,
            furnished=Furnishing.UNFURNISHED,
        )
    return _save(session, listing)


def _tutor(session: Session) -> int:
    listing = _approved_listing(
        session,
        listing_id=TUTOR_ID,
        kind=ListingKind.TUTOR,
        title="Sara M.",
        description="Physics tutor focused on O/A-level and matric board preparation.",
        area="B-17, Block C (Demo Area)",
        tags=["physics", "tutor", "grade 9", "science"],
        image_url="/images/tutors/physics-tutor.jpg",
        module=CategoryModule.EDUCATION,
        category_slugs=["physics"],
    )
    if listing is not None:
        listing.tutor_profile = TutorProfile(grade="Grade 9")
    return _save(session, listing)


def _save(session: Session, listing: Listing | None) -> int:
    if listing is None:
        return 0
    session.add(listing)
    session.flush()
    return 1


# -- news -----------------------------------------------------------------------------------


def _news(session: Session) -> int:
    if session.get(NewsArticle, NEWS_ID) is not None:
        return 0
    category = CategoryRepository(session).list_by_slugs(CategoryModule.NEWS, ["community"])[
        "community"
    ]
    session.add(
        NewsArticle(
            id=NEWS_ID,
            kind=NewsKind.NEWS,
            status=NewsStatus.PUBLISHED,
            title="B-17 Community Park Cleanup Drive This Weekend",
            summary=(
                "Residents are invited to join a local cleanup drive at the B-17 community park, "
                "organized as part of an ongoing neighborhood initiative."
            ),
            category_id=category.id,
            image_url="/images/news/community.jpg",
            published_at=date(2026, 9, 5),
            tags=["community", "event", "cleanup"],
            created_by=ADMIN_ID,
        )
    )
    session.flush()
    return 1


def main() -> int:
    settings = get_settings()
    ensure_not_production(settings)
    if settings.database_url is None:
        print("DATABASE_URL is not set; nothing to load.", file=sys.stderr)
        return 1
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session, transaction(session):
            result = load_dev_fixtures(session)
    finally:
        engine.dispose()
    print(
        f"Dev fixtures: {result.users} user(s), {result.listings} listing(s), "
        f"{result.news} news article(s) created (existing ones left untouched)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
