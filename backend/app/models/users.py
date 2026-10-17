"""Identity and ownership tables (schema only — Phase 11 owns authentication behavior).

Nothing here hashes a password, issues a token or links an OAuth account; these tables exist
because listings, history and Saved reference a user. See docs/backend/AUTH_RBAC.md.

Delete behavior: a user is *tombstoned*, not deleted (DATA_MODEL.md §11), so rows that carry
audit/ownership meaning (``listings.owner_id``, ``listing_status_history.actor_user_id``) RESTRICT
deletion, while data that only has meaning *with* the user (roles, identities, professional
profile, saved items) cascades.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import in_values, str_enum
from app.models.enums import AuthProvider, PlanCode, RoleName, UserStatus


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(Text, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    display_name: Mapped[str] = mapped_column(String(60), nullable=False)
    #: Argon2id PHC string; NULL for a social-only account (AUTH_RBAC.md §3, §7.3).
    password_hash: Mapped[str | None] = mapped_column(Text)
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus), nullable=False, default=UserStatus.ACTIVE, server_default="active"
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        in_values("status", UserStatus, name="status_valid"),
        CheckConstraint("char_length(btrim(display_name)) >= 2", name="display_name_length"),
        CheckConstraint("position('@' in email) > 1", name="email_has_at_sign"),
        # Phase 11B: the stored address is always trimmed and lower-cased (AUTH_RBAC.md §7.2).
        CheckConstraint("email = lower(btrim(email))", name="email_normalized"),
        CheckConstraint("char_length(email) <= 254", name="email_length"),
    )


# Case-insensitive uniqueness: "Ayesha@x.org" and "ayesha@x.org" are the same account.
Index("uq_users_email_lower", func.lower(User.email), unique=True)


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[RoleName] = mapped_column(str_enum(RoleName), primary_key=True)
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (in_values("role", RoleName, name="role_valid"),)


class AuthIdentity(UUIDPrimaryKeyMixin, Base):
    """A social identity. One user may have several; one (provider, subject) belongs to one user.

    Linking by matching e-mail is deliberately *not* modelled here — that is Phase 11 business
    logic with an explicit proof-of-control step.
    """

    __tablename__ = "auth_identities"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[AuthProvider] = mapped_column(str_enum(AuthProvider), nullable=False)
    #: The provider's stable subject id (OIDC ``sub``) — never the e-mail address.
    provider_subject: Mapped[str] = mapped_column(Text, nullable=False)
    provider_email: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        in_values("provider", AuthProvider, name="provider_valid"),
        CheckConstraint(
            "char_length(btrim(provider_subject)) > 0", name="provider_subject_not_blank"
        ),
        UniqueConstraint(
            "provider", "provider_subject", name="uq_auth_identities_provider_subject"
        ),
        # Phase 11C: one identity per provider per user (a provider identity has one owner above).
        UniqueConstraint("user_id", "provider", name="uq_auth_identities_user_id_provider"),
    )


class ProfessionalProfile(TimestampMixin, Base):
    """Exists once a user uses the professional workspace; anchors plan/entitlements.

    It is also the row a quota-checked listing create will lock (``SELECT ... FOR UPDATE``) in
    Phase 12 — a service-level concern, not a database one.
    """

    __tablename__ = "professional_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    plan_code: Mapped[PlanCode] = mapped_column(
        str_enum(PlanCode), nullable=False, default=PlanCode.FREE, server_default="free"
    )

    __table_args__ = (in_values("plan_code", PlanCode, name="plan_code_valid"),)
