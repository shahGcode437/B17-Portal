"""Users, roles, social identities and professional profiles: schema guarantees only.

No authentication behavior exists in this phase; these tests pin the relational rules that Phase
11 will build on (and the delete behavior that protects ownership/audit history).
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from app.models import (
    AuthIdentity,
    ListingStatusHistory,
    ProfessionalProfile,
    User,
    UserRole,
)
from app.models.enums import (
    ActorRole,
    AuthProvider,
    HistoryAction,
    ListingStatus,
    PlanCode,
    RoleName,
    UserStatus,
)
from tests.db.helpers import make_listing, make_user, raw_insert, violates


def test_users_get_application_generated_uuid4_ids(db_session: Session) -> None:
    user = make_user(db_session)

    assert isinstance(user.id, uuid.UUID)
    assert user.id.version == 4
    assert user.status is UserStatus.ACTIVE
    assert user.created_at.tzinfo is not None
    assert user.password_hash is None  # a social-only account has no password


def test_email_is_stored_normalized_so_case_variants_cannot_exist(db_session: Session) -> None:
    """Phase 11B: the address is trimmed and lower-cased; the database refuses anything else."""
    make_user(db_session, email="ayesha@example.test")

    with violates(db_session, "ck_users_email_normalized"):
        db_session.add(User(email="Ayesha@Example.test", display_name="Someone Else"))
    with violates(db_session, "ck_users_email_normalized"):
        db_session.add(User(email=" ayesha2@example.test ", display_name="Someone Else"))


def test_email_is_unique_case_insensitively(db_session: Session) -> None:
    """The unique index on ``lower(email)`` stays the authority (also for any future writer)."""
    make_user(db_session, email="ayesha@example.test")

    with violates(db_session, "uq_users_email_lower"):
        db_session.add(User(email="ayesha@example.test", display_name="Someone Else"))


def test_email_length_is_bounded(db_session: Session) -> None:
    with violates(db_session, "ck_users_email_length"):
        db_session.add(User(email="a" * 250 + "@example.test", display_name="Long Address"))


def test_email_must_look_like_an_address_and_names_must_not_be_blank(db_session: Session) -> None:
    with violates(db_session, "ck_users_email_has_at_sign"):
        db_session.add(User(email="not-an-email", display_name="Ayesha Khan"))
    with violates(db_session, "ck_users_display_name_length"):
        db_session.add(User(email="a@example.test", display_name=" x "))


def test_user_status_is_constrained(db_session: Session) -> None:
    with violates(db_session, "ck_users_status_valid"):
        raw_insert(
            db_session,
            "users",
            id=uuid.uuid4(),
            email="s@example.test",
            display_name="Status Test",
            status="banned",
        )


def test_a_role_can_be_granted_to_a_user_only_once(db_session: Session) -> None:
    admin = make_user(db_session)
    db_session.add(UserRole(user_id=admin.id, role=RoleName.ADMIN))
    db_session.flush()

    with violates(db_session, "pk_user_roles"):
        db_session.execute(insert(UserRole).values(user_id=admin.id, role="admin"))


def test_unknown_roles_are_rejected_and_resident_is_not_a_role_row(db_session: Session) -> None:
    user = make_user(db_session)

    for role in ("moderator", "resident", "professional"):
        with violates(db_session, "ck_user_roles_role_valid"):
            raw_insert(db_session, "user_roles", user_id=user.id, role=role)


def test_a_social_identity_belongs_to_exactly_one_user(db_session: Session) -> None:
    first, second = make_user(db_session), make_user(db_session)
    db_session.add(
        AuthIdentity(user_id=first.id, provider=AuthProvider.GOOGLE, provider_subject="sub-123")
    )
    db_session.flush()

    # The same (provider, subject) can never be attached to another account...
    with violates(db_session, "uq_auth_identities_provider_subject"):
        db_session.add(
            AuthIdentity(
                user_id=second.id, provider=AuthProvider.GOOGLE, provider_subject="sub-123"
            )
        )
    # ...even when the second account has the same e-mail: nothing links by e-mail.
    assert db_session.scalar(select(AuthIdentity).where(AuthIdentity.user_id == second.id)) is None


def test_one_user_may_have_several_identities_and_subjects_are_per_provider(
    db_session: Session,
) -> None:
    user = make_user(db_session)
    db_session.add_all(
        [
            AuthIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_subject="same"),
            AuthIdentity(user_id=user.id, provider=AuthProvider.FACEBOOK, provider_subject="same"),
            AuthIdentity(user_id=user.id, provider=AuthProvider.APPLE, provider_subject="other"),
        ]
    )
    db_session.flush()

    assert (
        len(db_session.scalars(select(AuthIdentity).where(AuthIdentity.user_id == user.id)).all())
        == 3
    )


def test_identity_provider_and_subject_are_validated(db_session: Session) -> None:
    user = make_user(db_session)

    with violates(db_session, "ck_auth_identities_provider_valid"):
        raw_insert(
            db_session,
            "auth_identities",
            id=uuid.uuid4(),
            user_id=user.id,
            provider="github",
            provider_subject="x",
        )
    with violates(db_session, "ck_auth_identities_provider_subject_not_blank"):
        db_session.add(
            AuthIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_subject="  ")
        )


def test_professional_profile_is_one_to_one_with_a_user_and_defaults_to_free(
    db_session: Session,
) -> None:
    user = make_user(db_session)
    db_session.add(ProfessionalProfile(user_id=user.id))
    db_session.flush()

    profile = db_session.get(ProfessionalProfile, user.id)
    assert profile is not None and profile.plan_code is PlanCode.FREE
    with violates(db_session, "pk_professional_profiles"):
        db_session.execute(insert(ProfessionalProfile).values(user_id=user.id))
    with violates(db_session, "fk_professional_profiles_user_id_users"):
        db_session.add(ProfessionalProfile(user_id=uuid.uuid4()))
    with violates(db_session, "ck_professional_profiles_plan_code_valid"):
        raw_insert(
            db_session, "professional_profiles", user_id=make_user(db_session).id, plan_code="gold"
        )


def test_data_that_only_means_something_with_the_user_is_removed_with_them(
    db_session: Session,
) -> None:
    user = make_user(db_session)
    db_session.add_all(
        [
            UserRole(user_id=user.id, role=RoleName.ADMIN),
            ProfessionalProfile(user_id=user.id),
            AuthIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_subject="gone"),
        ]
    )
    db_session.flush()

    db_session.execute(delete(User).where(User.id == user.id))

    for model in (UserRole, ProfessionalProfile, AuthIdentity):
        assert db_session.scalars(select(model).where(model.user_id == user.id)).all() == []


def test_a_user_who_owns_a_listing_cannot_be_deleted(db_session: Session) -> None:
    """Ownership is history: accounts are tombstoned, never row-deleted, while they own listings."""
    owner = make_user(db_session)
    make_listing(db_session, owner=owner)

    with violates(db_session, "fk_listings_owner_id_users"):
        db_session.execute(delete(User).where(User.id == owner.id))


def test_a_user_who_appears_in_the_audit_trail_cannot_be_deleted(db_session: Session) -> None:
    actor = make_user(db_session)
    listing = make_listing(db_session)
    db_session.add(
        ListingStatusHistory(
            listing_id=listing.id,
            from_status=None,
            to_status=ListingStatus.PENDING,
            action=HistoryAction.SUBMITTED,
            revision=1,
            actor_user_id=actor.id,
            actor_role=ActorRole.OWNER,
        )
    )
    db_session.flush()

    with violates(db_session, "fk_listing_status_history_actor_user_id_users"):
        db_session.execute(delete(User).where(User.id == actor.id))


def test_granting_a_role_survives_the_granter_being_removed(db_session: Session) -> None:
    granter, grantee = make_user(db_session), make_user(db_session)
    db_session.add(UserRole(user_id=grantee.id, role=RoleName.ADMIN, granted_by=granter.id))
    db_session.flush()

    db_session.execute(delete(User).where(User.id == granter.id))
    db_session.expire_all()

    role = db_session.get(UserRole, (grantee.id, RoleName.ADMIN))
    assert role is not None and role.granted_by is None
    assert role.granted_at <= datetime.now(UTC)
