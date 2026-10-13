"""initial schema

Phase 10C: the complete approved data model (docs/backend/DATA_MODEL.md) — 15 tables.
Constrained values are VARCHAR + named CHECK constraints (not native enums); every
constraint and index is explicitly named. Reviewed by hand after autogeneration.

Revision ID: 0001
Revises:
Create Date: 2026-10-13 22:05:53.950305
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "module",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("slug", sa.String(length=60), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("display_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "module IN ('services', 'directory', 'food', 'education', 'property', 'news')",
            name=op.f("ck_categories_module_valid"),
        ),
        sa.CheckConstraint(
            "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f("ck_categories_slug_format")
        ),
        sa.CheckConstraint(
            "char_length(btrim(name)) > 0", name=op.f("ck_categories_name_not_blank")
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name=op.f("ck_categories_parent_not_self")
        ),
        sa.ForeignKeyConstraint(
            ["parent_id", "module"],
            ["categories.id", "categories.module"],
            name="fk_categories_parent_id_module_categories",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categories")),
        sa.UniqueConstraint("id", "module", name="uq_categories_id_module"),
        sa.UniqueConstraint("module", "slug", name="uq_categories_module_slug"),
    )
    op.create_index(
        "ix_categories_module_is_active_display_order",
        "categories",
        ["module", "is_active", "display_order"],
        unique=False,
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("display_name", sa.String(length=60), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="active",
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("position('@' in email) > 1", name=op.f("ck_users_email_has_at_sign")),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')", name=op.f("ck_users_status_valid")
        ),
        sa.CheckConstraint(
            "char_length(btrim(display_name)) >= 2", name=op.f("ck_users_display_name_length")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(
        "uq_users_email_lower", "users", [sa.literal_column("lower(email)")], unique=True
    )
    op.create_table(
        "auth_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "provider",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("provider_subject", sa.Text(), nullable=False),
        sa.Column("provider_email", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "provider IN ('google', 'facebook', 'apple')",
            name=op.f("ck_auth_identities_provider_valid"),
        ),
        sa.CheckConstraint(
            "char_length(btrim(provider_subject)) > 0",
            name=op.f("ck_auth_identities_provider_subject_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_identities_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_identities")),
        sa.UniqueConstraint(
            "provider", "provider_subject", name="uq_auth_identities_provider_subject"
        ),
    )
    op.create_index(
        op.f("ix_auth_identities_user_id"), "auth_identities", ["user_id"], unique=False
    )
    op.create_table(
        "listings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("area", sa.Text(), nullable=False),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("is_featured", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "NOT is_featured OR kind IN ('provider', 'business')",
            name=op.f("ck_listings_featured_kinds"),
        ),
        sa.CheckConstraint(
            "kind IN ('provider', 'business', 'tutor', 'property')",
            name=op.f("ck_listings_kind_valid"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'archived')",
            name=op.f("ck_listings_status_valid"),
        ),
        sa.CheckConstraint("char_length(btrim(area)) > 0", name=op.f("ck_listings_area_not_blank")),
        sa.CheckConstraint(
            "char_length(btrim(title)) > 0", name=op.f("ck_listings_title_not_blank")
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_listings_revision_positive")),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_listings_owner_id_users"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_listings")),
        sa.UniqueConstraint("id", "kind", name="uq_listings_id_kind"),
    )
    op.create_index("ix_listings_owner_id_status", "listings", ["owner_id", "status"], unique=False)
    op.create_index(
        "ix_listings_status_kind_created_at",
        "listings",
        ["status", "kind", "created_at"],
        unique=False,
    )
    op.create_table(
        "news_articles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="draft",
            nullable=False,
        ),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("summary", sa.String(length=400), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column(
            "category_module",
            sa.String(length=32),
            server_default="news",
            nullable=False,
        ),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("published_at", sa.Date(), nullable=False),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "category_module = 'news'", name=op.f("ck_news_articles_category_module_is_news")
        ),
        sa.CheckConstraint("kind IN ('news', 'update')", name=op.f("ck_news_articles_kind_valid")),
        sa.CheckConstraint(
            "status IN ('draft', 'published')", name=op.f("ck_news_articles_status_valid")
        ),
        sa.CheckConstraint(
            "char_length(btrim(summary)) > 0", name=op.f("ck_news_articles_summary_not_blank")
        ),
        sa.CheckConstraint(
            "char_length(btrim(title)) > 0", name=op.f("ck_news_articles_title_not_blank")
        ),
        sa.ForeignKeyConstraint(
            ["category_id", "category_module"],
            ["categories.id", "categories.module"],
            name="fk_news_articles_category_id_category_module_categories",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_news_articles_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_news_articles")),
    )
    op.create_index("ix_news_articles_category_id", "news_articles", ["category_id"], unique=False)
    op.create_index(
        "ix_news_articles_status_published_at",
        "news_articles",
        ["status", sa.literal_column("published_at DESC")],
        unique=False,
    )
    op.create_table(
        "professional_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "plan_code",
            sa.String(length=32),
            server_default="free",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "plan_code IN ('free', 'premium')",
            name=op.f("ck_professional_profiles_plan_code_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_professional_profiles_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_professional_profiles")),
    )
    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=True),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("role IN ('admin')", name=op.f("ck_user_roles_role_valid")),
        sa.ForeignKeyConstraint(
            ["granted_by"],
            ["users.id"],
            name=op.f("fk_user_roles_granted_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_roles_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "role", name=op.f("pk_user_roles")),
    )
    op.create_table(
        "business_profiles",
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=32),
            server_default="business",
            nullable=False,
        ),
        sa.Column(
            "vertical",
            sa.String(length=32),
            server_default="general",
            nullable=False,
        ),
        sa.CheckConstraint("kind = 'business'", name=op.f("ck_business_profiles_kind_is_business")),
        sa.CheckConstraint(
            "vertical IN ('general', 'food')", name=op.f("ck_business_profiles_vertical_valid")
        ),
        sa.ForeignKeyConstraint(
            ["listing_id", "kind"],
            ["listings.id", "listings.kind"],
            name="fk_business_profiles_listing_id_kind_listings",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("listing_id", name=op.f("pk_business_profiles")),
        sa.UniqueConstraint(
            "listing_id", "vertical", name="uq_business_profiles_listing_id_vertical"
        ),
    )
    op.create_table(
        "listing_categories",
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("position >= 1", name=op.f("ck_listing_categories_position_positive")),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_listing_categories_category_id_categories"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["listing_id"],
            ["listings.id"],
            name=op.f("fk_listing_categories_listing_id_listings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("listing_id", "position", name=op.f("pk_listing_categories")),
        sa.UniqueConstraint(
            "listing_id", "category_id", name="uq_listing_categories_listing_id_category_id"
        ),
    )
    op.create_index(
        "ix_listing_categories_category_id_listing_id",
        "listing_categories",
        ["category_id", "listing_id"],
        unique=False,
    )
    op.create_table(
        "listing_status_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "from_status",
            sa.String(length=32),
            nullable=True,
        ),
        sa.Column(
            "to_status",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column(
            "action",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "actor_role",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(from_status IS NULL) = (action = 'submitted')",
            name=op.f("ck_listing_status_history_from_status_iff_submitted"),
        ),
        sa.CheckConstraint(
            "action IN ('submitted', 'resubmitted', 'approved', 'rejected', 'archived')",
            name=op.f("ck_listing_status_history_action_valid"),
        ),
        sa.CheckConstraint(
            "actor_role IN ('owner', 'admin')",
            name=op.f("ck_listing_status_history_actor_role_valid"),
        ),
        sa.CheckConstraint(
            "from_status IS NULL OR from_status IN ('pending', 'approved', 'rejected', 'archived')",
            name=op.f("ck_listing_status_history_from_status_valid"),
        ),
        sa.CheckConstraint(
            "to_status <> 'rejected' OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 10)",
            name=op.f("ck_listing_status_history_rejection_reason_required"),
        ),
        sa.CheckConstraint(
            "to_status = CASE action WHEN 'submitted' THEN 'pending' WHEN 'resubmitted' THEN 'pending' WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' WHEN 'archived' THEN 'archived' END",
            name=op.f("ck_listing_status_history_action_matches_to_status"),
        ),
        sa.CheckConstraint(
            "to_status IN ('pending', 'approved', 'rejected', 'archived')",
            name=op.f("ck_listing_status_history_to_status_valid"),
        ),
        sa.CheckConstraint(
            "revision >= 1", name=op.f("ck_listing_status_history_revision_positive")
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_listing_status_history_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["listing_id"],
            ["listings.id"],
            name=op.f("fk_listing_status_history_listing_id_listings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_listing_status_history")),
    )
    op.create_index(
        "ix_listing_status_history_listing_id_created_at",
        "listing_status_history",
        ["listing_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "property_profiles",
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=32),
            server_default="property",
            nullable=False,
        ),
        sa.Column(
            "listing_type",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("price_text", sa.String(), nullable=False),
        sa.Column("bedrooms", sa.SmallInteger(), nullable=True),
        sa.Column(
            "furnished",
            sa.String(length=32),
            nullable=True,
        ),
        sa.CheckConstraint(
            "furnished IS NULL OR furnished IN ('Furnished', 'Unfurnished', 'Semi-Furnished')",
            name=op.f("ck_property_profiles_furnished_valid"),
        ),
        sa.CheckConstraint("kind = 'property'", name=op.f("ck_property_profiles_kind_is_property")),
        sa.CheckConstraint(
            "listing_type IN ('sale', 'rent')", name=op.f("ck_property_profiles_listing_type_valid")
        ),
        sa.CheckConstraint(
            "bedrooms IS NULL OR bedrooms >= 0",
            name=op.f("ck_property_profiles_bedrooms_non_negative"),
        ),
        sa.CheckConstraint(
            "char_length(btrim(price_text)) > 0",
            name=op.f("ck_property_profiles_price_text_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["listing_id", "kind"],
            ["listings.id", "listings.kind"],
            name="fk_property_profiles_listing_id_kind_listings",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("listing_id", name=op.f("pk_property_profiles")),
    )
    op.create_index(
        "ix_property_profiles_listing_type", "property_profiles", ["listing_type"], unique=False
    )
    op.create_table(
        "saved_items",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["listing_id"],
            ["listings.id"],
            name=op.f("fk_saved_items_listing_id_listings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_saved_items_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "listing_id", name=op.f("pk_saved_items")),
    )
    op.create_index(
        "ix_saved_items_user_id_created_at",
        "saved_items",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "tutor_profiles",
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=32),
            server_default="tutor",
            nullable=False,
        ),
        sa.Column("grade", sa.Text(), nullable=False),
        sa.CheckConstraint("kind = 'tutor'", name=op.f("ck_tutor_profiles_kind_is_tutor")),
        sa.CheckConstraint(
            "char_length(btrim(grade)) > 0", name=op.f("ck_tutor_profiles_grade_not_blank")
        ),
        sa.ForeignKeyConstraint(
            ["listing_id", "kind"],
            ["listings.id", "listings.kind"],
            name="fk_tutor_profiles_listing_id_kind_listings",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("listing_id", name=op.f("pk_tutor_profiles")),
    )
    op.create_table(
        "food_profiles",
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "vertical",
            sa.String(length=32),
            server_default="food",
            nullable=False,
        ),
        sa.Column("service_options", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("hours_note", sa.String(length=80), nullable=True),
        sa.Column("menu_image_url", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "service_options <@ ARRAY['dine-in', 'takeaway', 'delivery']::text[]",
            name=op.f("ck_food_profiles_service_options_valid"),
        ),
        sa.CheckConstraint("vertical = 'food'", name=op.f("ck_food_profiles_vertical_is_food")),
        sa.CheckConstraint(
            "cardinality(service_options) >= 1",
            name=op.f("ck_food_profiles_service_options_not_empty"),
        ),
        sa.ForeignKeyConstraint(
            ["listing_id", "vertical"],
            ["business_profiles.listing_id", "business_profiles.vertical"],
            name="fk_food_profiles_listing_id_vertical_business_profiles",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("listing_id", name=op.f("pk_food_profiles")),
    )
    op.create_index(
        "ix_food_profiles_service_options",
        "food_profiles",
        ["service_options"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_table(
        "food_menu_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("section", sa.String(length=40), nullable=True),
        sa.Column("description", sa.String(length=120), nullable=True),
        sa.Column("price_text", sa.String(length=24), nullable=True),
        sa.CheckConstraint(
            "char_length(btrim(name)) > 0", name=op.f("ck_food_menu_items_name_not_blank")
        ),
        sa.CheckConstraint(
            "position BETWEEN 1 AND 8", name=op.f("ck_food_menu_items_position_range")
        ),
        sa.ForeignKeyConstraint(
            ["listing_id"],
            ["food_profiles.listing_id"],
            name=op.f("fk_food_menu_items_listing_id_food_profiles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_food_menu_items")),
        sa.UniqueConstraint(
            "listing_id", "position", name="uq_food_menu_items_listing_id_position"
        ),
    )


def downgrade() -> None:
    op.drop_table("food_menu_items")
    op.drop_index(
        "ix_food_profiles_service_options", table_name="food_profiles", postgresql_using="gin"
    )
    op.drop_table("food_profiles")
    op.drop_table("tutor_profiles")
    op.drop_index("ix_saved_items_user_id_created_at", table_name="saved_items")
    op.drop_table("saved_items")
    op.drop_index("ix_property_profiles_listing_type", table_name="property_profiles")
    op.drop_table("property_profiles")
    op.drop_index(
        "ix_listing_status_history_listing_id_created_at", table_name="listing_status_history"
    )
    op.drop_table("listing_status_history")
    op.drop_index("ix_listing_categories_category_id_listing_id", table_name="listing_categories")
    op.drop_table("listing_categories")
    op.drop_table("business_profiles")
    op.drop_table("user_roles")
    op.drop_table("professional_profiles")
    op.drop_index("ix_news_articles_status_published_at", table_name="news_articles")
    op.drop_index("ix_news_articles_category_id", table_name="news_articles")
    op.drop_table("news_articles")
    op.drop_index("ix_listings_status_kind_created_at", table_name="listings")
    op.drop_index("ix_listings_owner_id_status", table_name="listings")
    op.drop_table("listings")
    op.drop_index(op.f("ix_auth_identities_user_id"), table_name="auth_identities")
    op.drop_table("auth_identities")
    op.drop_index("uq_users_email_lower", table_name="users")
    op.drop_table("users")
    op.drop_index("ix_categories_module_is_active_display_order", table_name="categories")
    op.drop_table("categories")
