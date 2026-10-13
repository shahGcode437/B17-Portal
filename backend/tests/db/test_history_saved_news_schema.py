"""listing_status_history (append-only audit), saved_items and news_articles."""

import uuid
from datetime import date

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Listing, ListingStatusHistory, NewsArticle, SavedItem, User
from app.models.enums import (
    ActorRole,
    CategoryModule,
    HistoryAction,
    ListingStatus,
    NewsKind,
    NewsStatus,
)
from app.repositories.listings import ListingRepository
from tests.db.helpers import category, make_listing, make_user, raw_insert, violates


def history(listing: Listing, actor: User, **overrides: object) -> ListingStatusHistory:
    values: dict[str, object] = {
        "listing_id": listing.id,
        "from_status": None,
        "to_status": ListingStatus.PENDING,
        "action": HistoryAction.SUBMITTED,
        "revision": 1,
        "actor_user_id": actor.id,
        "actor_role": ActorRole.OWNER,
    } | overrides
    return ListingStatusHistory(**values)


# -- listing_status_history ----------------------------------------------------------------------


def test_creation_is_recorded_as_a_submission_with_no_previous_status(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, owner=owner)
    row = history(listing, owner)
    db_session.add(row)
    db_session.flush()
    db_session.refresh(row)

    assert row.id.version == 4 and row.created_at.tzinfo is not None
    assert (row.from_status, row.to_status, row.action) == (
        None,
        ListingStatus.PENDING,
        HistoryAction.SUBMITTED,
    )


def test_the_full_lifecycle_including_a_pending_to_pending_resubmission_is_representable(
    db_session: Session,
) -> None:
    owner, admin = make_user(db_session), make_user(db_session)
    listing = make_listing(db_session, owner=owner)
    P, A, R = ListingStatus.PENDING, ListingStatus.APPROVED, ListingStatus.REJECTED
    steps = [
        history(listing, owner),
        history(
            listing,
            admin,
            from_status=P,
            to_status=R,
            action=HistoryAction.REJECTED,
            actor_role=ActorRole.ADMIN,
            reason="Please add opening hours.",
        ),
        history(
            listing, owner, from_status=R, to_status=P, action=HistoryAction.RESUBMITTED, revision=2
        ),
        # an edit while still pending is recorded too: pending -> pending, a new revision
        history(
            listing, owner, from_status=P, to_status=P, action=HistoryAction.RESUBMITTED, revision=3
        ),
        history(
            listing,
            admin,
            from_status=P,
            to_status=A,
            action=HistoryAction.APPROVED,
            actor_role=ActorRole.ADMIN,
            revision=3,
        ),
        history(
            listing,
            owner,
            from_status=A,
            to_status=ListingStatus.ARCHIVED,
            action=HistoryAction.ARCHIVED,
            revision=3,
        ),
    ]
    db_session.add_all(steps)
    db_session.flush()

    stored = db_session.scalars(
        select(ListingStatusHistory).where(ListingStatusHistory.listing_id == listing.id)
    ).all()
    assert len(stored) == 6
    assert sorted(row.revision for row in stored) == [1, 1, 2, 3, 3, 3]  # revision-aware


def test_only_creation_has_no_previous_status(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, owner=owner)

    with violates(db_session, "ck_listing_status_history_from_status_iff_submitted"):
        db_session.add(history(listing, owner, from_status=ListingStatus.PENDING))
    with violates(db_session, "ck_listing_status_history_from_status_iff_submitted"):
        db_session.add(history(listing, owner, action=HistoryAction.RESUBMITTED, from_status=None))


def test_the_action_determines_the_resulting_status(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, owner=owner)

    with violates(db_session, "ck_listing_status_history_action_matches_to_status"):
        db_session.add(
            history(
                listing,
                owner,
                from_status=ListingStatus.PENDING,
                to_status=ListingStatus.PENDING,
                action=HistoryAction.APPROVED,
            )
        )


@pytest.mark.parametrize("reason", [None, "", "   ", "too short"])
def test_a_rejection_must_carry_a_specific_reason_of_at_least_10_characters(
    db_session: Session, reason: str | None
) -> None:
    admin, listing = make_user(db_session), make_listing(db_session)

    with violates(db_session, "ck_listing_status_history_rejection_reason_required"):
        db_session.add(
            history(
                listing,
                admin,
                from_status=ListingStatus.PENDING,
                to_status=ListingStatus.REJECTED,
                action=HistoryAction.REJECTED,
                actor_role=ActorRole.ADMIN,
                reason=reason,
            )
        )


def test_status_action_actor_and_revision_values_are_constrained(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, owner=owner)
    base = {
        "id": uuid.uuid4(),
        "listing_id": listing.id,
        "from_status": None,
        "to_status": "pending",
        "action": "submitted",
        "revision": 1,
        "actor_user_id": owner.id,
        "actor_role": "owner",
    }
    for column, value, constraint in (
        (
            "to_status",
            "draft",
            "ck_listing_status_history_to_status_valid",
        ),  # (also trips the action check)
        ("action", "deleted", "ck_listing_status_history_action_valid"),
        ("actor_role", "system", "ck_listing_status_history_actor_role_valid"),
        ("revision", 0, "ck_listing_status_history_revision_positive"),
    ):
        with (
            violates(db_session, constraint, "ck_listing_status_history_action_matches_to_status")
            if column == "to_status"
            else violates(db_session, constraint)
        ):
            raw_insert(db_session, "listing_status_history", **(base | {column: value}))


def test_history_requires_a_real_listing_and_a_real_actor(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, owner=owner)

    with violates(db_session, "fk_listing_status_history_listing_id_listings"):
        db_session.add(history(listing, owner, listing_id=uuid.uuid4()))
    with violates(db_session, "fk_listing_status_history_actor_user_id_users"):
        db_session.add(history(listing, owner, actor_user_id=uuid.uuid4()))


def test_the_repository_offers_no_way_to_change_or_remove_history() -> None:
    """History is append-only at the application layer: ``record_history`` is the only write."""
    public = {name for name in vars(ListingRepository) if not name.startswith("_")}

    assert public == {"add", "get", "record_history"}


def test_the_repository_appends_history_without_committing(db_session: Session) -> None:
    owner = make_user(db_session)
    listing = make_listing(db_session, owner=owner)
    db_session.commit()  # the fixtures above are committed (released savepoint)

    ListingRepository(db_session).record_history(history(listing, owner))
    db_session.rollback()  # the repository did NOT commit, so this undoes the append

    count = db_session.scalar(
        select(func.count())
        .select_from(ListingStatusHistory)
        .where(ListingStatusHistory.listing_id == listing.id)
    )
    assert count == 0


# -- saved_items ---------------------------------------------------------------------------------


def test_a_user_cannot_save_the_same_listing_twice(db_session: Session) -> None:
    user, listing = make_user(db_session), make_listing(db_session)
    db_session.add(SavedItem(user_id=user.id, listing_id=listing.id))
    db_session.flush()

    with violates(db_session, "pk_saved_items"):
        raw_insert(db_session, "saved_items", user_id=user.id, listing_id=listing.id)


def test_many_users_can_save_one_listing_and_one_user_many_listings(db_session: Session) -> None:
    listing = make_listing(db_session)
    first, second = make_user(db_session), make_user(db_session)
    db_session.add_all(
        [
            SavedItem(user_id=first.id, listing_id=listing.id),
            SavedItem(user_id=second.id, listing_id=listing.id),
            SavedItem(user_id=first.id, listing_id=make_listing(db_session).id),
        ]
    )
    db_session.flush()

    assert (
        db_session.scalar(
            select(func.count()).select_from(SavedItem).where(SavedItem.user_id == first.id)
        )
        == 2
    )


def test_saved_items_require_a_real_user_and_listing(db_session: Session) -> None:
    user, listing = make_user(db_session), make_listing(db_session)

    with violates(db_session, "fk_saved_items_user_id_users"):
        db_session.add(SavedItem(user_id=uuid.uuid4(), listing_id=listing.id))
    with violates(db_session, "fk_saved_items_listing_id_listings"):
        db_session.add(SavedItem(user_id=user.id, listing_id=uuid.uuid4()))


def test_a_saved_row_survives_the_listing_leaving_public_view(db_session: Session) -> None:
    """Visibility is the *query's* job: archiving (or rejecting) never deletes a favorite."""
    user, listing = make_user(db_session), make_listing(db_session)
    db_session.add(SavedItem(user_id=user.id, listing_id=listing.id))
    db_session.flush()

    for status in (ListingStatus.REJECTED, ListingStatus.ARCHIVED, ListingStatus.APPROVED):
        listing.status = status
        db_session.flush()
        assert db_session.get(SavedItem, (user.id, listing.id)) is not None


def test_hard_deleting_the_listing_or_the_account_removes_the_favorite(db_session: Session) -> None:
    user, other = make_user(db_session), make_user(db_session)
    doomed, kept = make_listing(db_session), make_listing(db_session)
    db_session.add_all(
        [
            SavedItem(user_id=user.id, listing_id=doomed.id),
            SavedItem(user_id=other.id, listing_id=kept.id),
        ]
    )
    db_session.flush()

    db_session.execute(delete(Listing).where(Listing.id == doomed.id))
    db_session.execute(delete(User).where(User.id == other.id))

    assert (
        db_session.scalar(
            select(func.count())
            .select_from(SavedItem)
            .where(SavedItem.user_id.in_([user.id, other.id]))
        )
        == 0
    )


# -- news_articles -------------------------------------------------------------------------------


def article(session: Session, **overrides: object) -> NewsArticle:
    values: dict[str, object] = {
        "kind": NewsKind.NEWS,
        "title": "Park cleanup drive",
        "summary": "Join the cleanup at the community park.",
        "category_id": category(session, CategoryModule.NEWS, "community").id,
        "published_at": date(2026, 9, 5),
    } | overrides
    row = NewsArticle(**values)
    session.add(row)
    return row


def test_news_defaults_to_draft_and_keeps_a_date_only_publication_date(db_session: Session) -> None:
    row = article(db_session)
    db_session.flush()
    db_session.refresh(row)

    assert row.status is NewsStatus.DRAFT
    assert row.published_at == date(2026, 9, 5)
    assert row.tags == [] and row.id.version == 4


def test_a_news_article_can_only_use_a_news_category(db_session: Session) -> None:
    """DB-enforced via the composite FK (category_id, 'news'): a Food category is refused."""
    food = category(db_session, CategoryModule.FOOD, "bakeries")

    with violates(db_session, "fk_news_articles_category_id_category_module_categories"):
        article(db_session, category_id=food.id)


def test_news_values_are_constrained(db_session: Session) -> None:
    ok = {
        "id": uuid.uuid4(),
        "kind": "news",
        "title": "T",
        "summary": "S",
        "published_at": date(2026, 1, 1),
        "category_id": category(db_session, CategoryModule.NEWS, "community").id,
    }
    for column, value, constraint in (
        ("kind", "blog", "ck_news_articles_kind_valid"),
        ("status", "archived", "ck_news_articles_status_valid"),
        ("title", "  ", "ck_news_articles_title_not_blank"),
        ("summary", "", "ck_news_articles_summary_not_blank"),
    ):
        with violates(db_session, constraint):
            raw_insert(db_session, "news_articles", **(ok | {column: value}))


def test_a_news_category_in_use_cannot_be_deleted_and_authorship_survives_the_author(
    db_session: Session,
) -> None:
    from app.models import Category

    admin = make_user(db_session)
    row = article(db_session, created_by=admin.id)
    db_session.flush()

    with violates(db_session, "fk_news_articles_category_id_category_module_categories"):
        db_session.execute(delete(Category).where(Category.id == row.category_id))

    db_session.execute(delete(User).where(User.id == admin.id))
    db_session.refresh(row)
    assert row.created_by is None  # SET NULL: the article outlives its author's account


def test_news_and_update_kinds_share_the_table(db_session: Session) -> None:
    article(db_session, kind=NewsKind.UPDATE, status=NewsStatus.PUBLISHED)
    article(db_session, kind=NewsKind.NEWS)
    db_session.flush()

    kinds = db_session.scalars(select(NewsArticle.kind)).all()
    assert {NewsKind.NEWS, NewsKind.UPDATE} <= set(kinds)
