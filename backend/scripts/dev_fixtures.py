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
from app.services.search_index import SearchIndexer

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

# Phase 10D additions: more public content, and records that must NEVER be public.
BIRYANI_ID = fixture_id("listing:karachi-biryani-house")
CAFE_ID = fixture_id("listing:mocha-corner-cafe")
SALON_ID = fixture_id("listing:glow-salon")
ELECTRIC_ID = fixture_id("listing:bright-electric")
FLAT_ID = fixture_id("listing:flat-rent-block-d")
MATH_TUTOR_ID = fixture_id("listing:math-tutor")
PENDING_PROVIDER_ID = fixture_id("listing:pending-plumber")
REJECTED_BUSINESS_ID = fixture_id("listing:rejected-tailor")
ARCHIVED_TUTOR_ID = fixture_id("listing:archived-tutor")
PENDING_FOOD_ID = fixture_id("listing:pending-kebab-house")
UPDATE_ID = fixture_id("news:water-schedule")
DRAFT_NEWS_ID = fixture_id("news:draft-announcement")

#: Every fixture listing, so a re-run refreshes their search documents (the loader is idempotent).
FIXTURE_LISTING_IDS = (
    SOLAR_ID,
    PHARMACY_ID,
    BAKERS_ID,
    HOUSE_ID,
    TUTOR_ID,
    BIRYANI_ID,
    CAFE_ID,
    SALON_ID,
    ELECTRIC_ID,
    FLAT_ID,
    MATH_TUTOR_ID,
    PENDING_PROVIDER_ID,
    REJECTED_BUSINESS_ID,
    ARCHIVED_TUTOR_ID,
    PENDING_FOOD_ID,
)


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
            _biryani(session),
            _cafe(session),
            _salon(session),
            _electrician(session),
            _flat(session),
            _math_tutor(session),
            _pending_provider(session),
            _rejected_business(session),
            _archived_tutor(session),
            _pending_food(session),
        ]
    )
    news = _news(session) + _more_news(session)
    SearchIndexer(session).refresh_ids(FIXTURE_LISTING_IDS)
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


def _listing(
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
    status: ListingStatus = ListingStatus.APPROVED,
) -> Listing | None:
    """Create a listing owned by the fixture professional, with categories and the history that
    leads to ``status``. Returns ``None`` if it already exists."""
    if session.get(Listing, listing_id) is not None:
        return None
    categories = CategoryRepository(session).list_by_slugs(module, category_slugs)
    listing = Listing(
        id=listing_id,
        kind=kind,
        owner_id=PROFESSIONAL_ID,
        status=status,
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
    listing.status_history = _history(status)
    return listing


def _history(status: ListingStatus) -> list[ListingStatusHistory]:
    """submitted, then the moderation steps that end in ``status``."""

    def step(
        from_status: ListingStatus | None,
        to_status: ListingStatus,
        action: HistoryAction,
        *,
        admin: bool,
        reason: str | None = None,
    ) -> ListingStatusHistory:
        return ListingStatusHistory(
            from_status=from_status,
            to_status=to_status,
            action=action,
            revision=1,
            actor_user_id=ADMIN_ID if admin else PROFESSIONAL_ID,
            actor_role=ActorRole.ADMIN if admin else ActorRole.OWNER,
            reason=reason,
        )

    pending = ListingStatus.PENDING
    history = [step(None, pending, HistoryAction.SUBMITTED, admin=False)]
    if status is ListingStatus.REJECTED:
        history.append(
            step(
                pending,
                status,
                HistoryAction.REJECTED,
                admin=True,
                reason="Fixture rejection: the listing needs clearer details.",
            )
        )
    elif status in (ListingStatus.APPROVED, ListingStatus.ARCHIVED):
        history.append(step(pending, ListingStatus.APPROVED, HistoryAction.APPROVED, admin=True))
        if status is ListingStatus.ARCHIVED:
            history.append(
                step(ListingStatus.APPROVED, status, HistoryAction.ARCHIVED, admin=False)
            )
    return history


def _provider(session: Session) -> int:
    listing = _listing(
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
    listing = _listing(
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
    listing = _listing(
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
    listing = _listing(
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
    listing = _listing(
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


def _food_business(
    session: Session,
    *,
    listing_id: uuid.UUID,
    title: str,
    description: str,
    tags: list[str],
    category_slugs: list[str],
    service_options: list[FoodServiceOption],
    menu: list[FoodMenuItem],
    hours_note: str | None = None,
    status: ListingStatus = ListingStatus.APPROVED,
    area: str = "B-17, Block C (Demo Area)",
) -> int:
    listing = _listing(
        session,
        listing_id=listing_id,
        kind=ListingKind.BUSINESS,
        title=title,
        description=description,
        area=area,
        tags=tags,
        image_url="/images/businesses/cafe.jpg",
        module=CategoryModule.FOOD,
        category_slugs=category_slugs,
        status=status,
    )
    if listing is not None:
        listing.business = BusinessProfile(vertical=BusinessVertical.FOOD)
        listing.business.food = FoodProfile(
            service_options=[option.value for option in service_options],
            hours_note=hours_note,
            menu_items=menu,
        )
    return _save(session, listing)


def _biryani(session: Session) -> int:
    return _food_business(
        session,
        listing_id=BIRYANI_ID,
        title="Karachi Biryani House",
        description="Dum biryani, pulao and desi platters cooked fresh every day.",
        tags=["biryani", "rice", "desi", "lunch"],
        category_slugs=["biryani-rice", "desi-food"],
        service_options=[FoodServiceOption.DINE_IN, FoodServiceOption.DELIVERY],
        hours_note="Daily, 12 PM–11 PM",
        menu=[
            FoodMenuItem(position=1, name="Chicken Biryani", section="Rice", price_text="PKR 450"),
            FoodMenuItem(position=2, name="Mutton Pulao", section="Rice", price_text="PKR 700"),
        ],
    )


def _cafe(session: Session) -> int:
    return _food_business(
        session,
        listing_id=CAFE_ID,
        title="Mocha Corner Cafe",
        description="Specialty coffee, cold brew and light bites.",
        tags=["coffee", "cafe", "snacks"],
        category_slugs=["cafes"],
        service_options=[FoodServiceOption.DINE_IN, FoodServiceOption.TAKEAWAY],
        menu=[
            FoodMenuItem(position=1, name="Cold Brew", section="Coffee", price_text="PKR 550"),
            FoodMenuItem(position=2, name="Chicken Patties", section="Bites", price_text="PKR 200"),
        ],
    )


def _salon(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=SALON_ID,
        kind=ListingKind.BUSINESS,
        title="Glow Salon",
        description="Haircuts, styling and grooming for the whole family.",
        area="B-17, Block D (Demo Area)",
        tags=["salon", "haircut", "grooming"],
        image_url="/images/businesses/retail-store.jpg",
        module=CategoryModule.DIRECTORY,
        category_slugs=["hairdressing"],
    )
    if listing is not None:
        listing.business = BusinessProfile(vertical=BusinessVertical.GENERAL)
    return _save(session, listing)


def _electrician(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=ELECTRIC_ID,
        kind=ListingKind.PROVIDER,
        title="Bright Electric Works",
        description="Wiring, fault finding and safe electrical repairs.",
        area="B-17, Block D (Demo Area)",
        tags=["electrician", "wiring", "repair"],
        image_url="/images/providers/electrician.jpg",
        module=CategoryModule.SERVICES,
        category_slugs=["electrical"],
    )
    return _save(session, listing)


def _flat(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=FLAT_ID,
        kind=ListingKind.PROPERTY,
        title="2 Bed Flat for Rent — B-17 Block D",
        description="A bright, furnished flat close to the main market.",
        area="B-17, Block D (Demo Area)",
        tags=["flat", "rent", "furnished"],
        image_url="/images/properties/flat-rent-01.jpg",
        module=CategoryModule.PROPERTY,
        category_slugs=["flat"],
    )
    if listing is not None:
        listing.property_profile = PropertyProfile(
            listing_type=PropertyListingType.RENT,
            price_text="PKR 55,000 / month",
            bedrooms=2,
            furnished=Furnishing.FURNISHED,
        )
    return _save(session, listing)


def _math_tutor(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=MATH_TUTOR_ID,
        kind=ListingKind.TUTOR,
        title="Ali R.",
        description="Mathematics tutor for matric and O-level students.",
        area="B-17, Block D (Demo Area)",
        tags=["mathematics", "tutor", "grade 10"],
        image_url="/images/tutors/math-tutor.jpg",
        module=CategoryModule.EDUCATION,
        category_slugs=["mathematics"],
    )
    if listing is not None:
        listing.tutor_profile = TutorProfile(grade="Grade 10")
    return _save(session, listing)


# -- listings that must never be public ------------------------------------------------------
# Each carries a distinctive word (quokka, wombat, ...) so tests can prove it never leaks through
# search, suggestions or detail.


def _pending_provider(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=PENDING_PROVIDER_ID,
        kind=ListingKind.PROVIDER,
        title="Quokka Plumbing (pending)",
        description="Awaiting moderation.",
        area="B-17, Block C (Demo Area)",
        tags=["quokka", "plumbing"],
        image_url="/images/providers/plumber.jpg",
        module=CategoryModule.SERVICES,
        category_slugs=["plumbing"],
        status=ListingStatus.PENDING,
    )
    return _save(session, listing)


def _rejected_business(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=REJECTED_BUSINESS_ID,
        kind=ListingKind.BUSINESS,
        title="Wombat Tailors (rejected)",
        description="Rejected by moderation.",
        area="B-17, Block C (Demo Area)",
        tags=["wombat", "tailor"],
        image_url="/images/businesses/retail-store.jpg",
        module=CategoryModule.DIRECTORY,
        category_slugs=["tailoring"],
        status=ListingStatus.REJECTED,
    )
    if listing is not None:
        listing.business = BusinessProfile(vertical=BusinessVertical.GENERAL)
    return _save(session, listing)


def _archived_tutor(session: Session) -> int:
    listing = _listing(
        session,
        listing_id=ARCHIVED_TUTOR_ID,
        kind=ListingKind.TUTOR,
        title="Platypus Tutor (archived)",
        description="Retired by its owner.",
        area="B-17, Block C (Demo Area)",
        tags=["platypus", "tutor"],
        image_url="/images/tutors/english-tutor.jpg",
        module=CategoryModule.EDUCATION,
        category_slugs=["english"],
        status=ListingStatus.ARCHIVED,
    )
    if listing is not None:
        listing.tutor_profile = TutorProfile(grade="Grade 8")
    return _save(session, listing)


def _pending_food(session: Session) -> int:
    return _food_business(
        session,
        listing_id=PENDING_FOOD_ID,
        title="Echidna Kebab House (pending)",
        description="Awaiting moderation.",
        tags=["echidna", "kebab"],
        category_slugs=["bbq"],
        service_options=[FoodServiceOption.TAKEAWAY],
        menu=[FoodMenuItem(position=1, name="Echidna Platter", price_text="PKR 999")],
        status=ListingStatus.PENDING,
    )


def _save(session: Session, listing: Listing | None) -> int:
    if listing is None:
        return 0
    session.add(listing)
    session.flush()
    SearchIndexer(session).refresh(listing)
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


def _more_news(session: Session) -> int:
    """A second published item (an update) and a DRAFT that must never be public."""
    created = 0
    categories = CategoryRepository(session).list_by_slugs(
        CategoryModule.NEWS, ["utilities", "infrastructure"]
    )
    if session.get(NewsArticle, UPDATE_ID) is None:
        session.add(
            NewsArticle(
                id=UPDATE_ID,
                kind=NewsKind.UPDATE,
                status=NewsStatus.PUBLISHED,
                title="Water Supply Schedule Update for Block D",
                summary="Water will be supplied from 6 AM to 9 AM daily while pipe work continues.",
                category_id=categories["utilities"].id,
                image_url=None,
                published_at=date(2026, 9, 12),
                tags=["water", "schedule"],
                created_by=ADMIN_ID,
            )
        )
        created += 1
    if session.get(NewsArticle, DRAFT_NEWS_ID) is None:
        session.add(
            NewsArticle(
                id=DRAFT_NEWS_ID,
                kind=NewsKind.NEWS,
                status=NewsStatus.DRAFT,
                title="Narwhal Announcement (draft)",
                summary="An unpublished draft that must stay invisible.",
                category_id=categories["infrastructure"].id,
                published_at=date(2026, 9, 20),
                tags=["narwhal"],
                created_by=ADMIN_ID,
            )
        )
        created += 1
    session.flush()
    return created


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
