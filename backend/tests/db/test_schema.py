"""The migrated database matches the models and the documented schema decisions."""

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.db.base import Base

EXPECTED_TABLES = {
    "auth_events",
    "auth_identities",
    "auth_rate_limits",
    "auth_sessions",
    "auth_tokens",
    "business_profiles",
    "categories",
    "food_menu_items",
    "food_profiles",
    "listing_categories",
    "listing_status_history",
    "oauth_flows",
    "listings",
    "news_articles",
    "professional_profiles",
    "property_profiles",
    "saved_items",
    "service_request_status_history",
    "service_requests",
    "tutor_profiles",
    "user_roles",
    "users",
}

# Indexes the approved data model calls for (DATA_MODEL.md §9); each has a query that uses it.
EXPECTED_INDEXES = {
    "ix_listings_status_kind_created_at",
    "ix_listings_owner_id_status",
    "ix_listing_categories_category_id_listing_id",
    "ix_categories_module_is_active_display_order",
    "ix_food_profiles_service_options",
    "ix_property_profiles_listing_type",
    "ix_saved_items_user_id_created_at",
    "ix_service_requests_provider_listing_id_status",
    "ix_service_requests_requester_id_created_at",
    "ix_service_request_status_history_request_id_created_at",
    "ix_listing_status_history_listing_id_created_at",
    "ix_news_articles_status_published_at",
    "uq_users_email_lower",
}


def test_the_migrated_database_has_exactly_the_approved_tables(db_session: Session) -> None:
    tables = set(
        db_session.scalars(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        ).all()
    )

    assert tables == EXPECTED_TABLES | {"alembic_version"}
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_deferred_tables_do_not_exist(db_session: Session) -> None:
    """Reserved/conceptual tables are not created merely because they were discussed."""
    tables = set(
        db_session.scalars(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        ).all()
    )

    for deferred in (
        "provider_profiles",  # no provider-specific data exists
        "media_assets",  # reserved for the media phase
        "listing_revisions",  # content-version history is deferred
        "modules",  # a module is code, not a row
    ):
        assert deferred not in tables


def test_every_named_model_constraint_and_index_exists_in_the_database(
    db_session: Session,
) -> None:
    constraints = set(
        db_session.scalars(
            text("SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace")
        ).all()
    )
    indexes = set(
        db_session.scalars(
            text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
        ).all()
    )

    for table in Base.metadata.tables.values():
        for constraint in table.constraints:
            if constraint.name is not None:
                assert str(constraint.name) in constraints, f"missing constraint {constraint.name}"
        for index in table.indexes:
            assert index.name in indexes, f"missing index {index.name}"
    assert indexes >= EXPECTED_INDEXES


def test_no_constraint_or_index_has_an_anonymous_generated_name(db_session: Session) -> None:
    constraint_names = db_session.scalars(
        text(
            "SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace "
            "AND conrelid::regclass::text <> 'alembic_version' "  # Alembic's own table
            "AND conname !~ '^(pk|fk|uq|ck)_'"
        )
    ).all()
    index_names = db_session.scalars(
        text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' "
            "AND tablename <> 'alembic_version' "  # Alembic's own table
            "AND indexname !~ '^(pk|ix|uq)_'"
        )
    ).all()

    assert constraint_names == []
    assert index_names == []


def test_constrained_values_are_varchar_checks_not_native_enums(db_session: Session) -> None:
    enum_types = db_session.scalar(text("SELECT count(*) FROM pg_type WHERE typtype = 'e'"))
    value_columns = db_session.scalars(
        text(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'listings' "
            "AND column_name IN ('kind', 'status')"
        )
    ).all()

    assert enum_types == 0
    assert value_columns == ["character varying", "character varying"]


def test_every_timestamp_is_timezone_aware_and_every_id_is_a_uuid(db_session: Session) -> None:
    naive = db_session.scalars(
        text(
            "SELECT table_name || '.' || column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'"
        )
    ).all()
    non_uuid_ids = db_session.scalars(
        text(
            "SELECT table_name || '.' || column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND (column_name = 'id' OR column_name LIKE '%\\_id') "
            "AND table_name <> 'alembic_version' AND data_type <> 'uuid' "
            "AND NOT (table_name = 'auth_events' AND column_name = 'request_id')"  # request id text
        )
    ).all()

    assert naive == []
    assert non_uuid_ids == []


def test_only_the_approved_extensions_are_installed(db_session: Session) -> None:
    """pg_trgm arrived with the search work (Phase 10D); PostGIS only if location search needs it."""
    extensions = set(db_session.scalars(text("SELECT extname FROM pg_extension")).all())

    assert extensions == {"plpgsql", "pg_trgm"}


def test_the_search_document_column_exists_and_is_never_null(db_session: Session) -> None:
    row = db_session.execute(
        text(
            "SELECT is_nullable, column_default FROM information_schema.columns "
            "WHERE table_name = 'listings' AND column_name = 'search_document'"
        )
    ).one()

    assert row.is_nullable == "NO"
    assert row.column_default is not None and "''" in row.column_default


def test_the_engine_fixture_points_at_the_validated_test_database(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        name = connection.execute(text("SELECT current_database()")).scalar_one()

    assert name.endswith("_test")
