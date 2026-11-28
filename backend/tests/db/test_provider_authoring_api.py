"""RBAC-D: staff Provider authoring (``POST /admin/providers``, ``PATCH /admin/providers/{id}``,
``POST /admin/providers/{id}/archive``) — docs/backend/AUTH_RBAC.md §27.9 and §31.

**A Service / Professional listing is a portal-managed resource, not a personally owned one.** These
tests prove, on real PostgreSQL through the real app and real login, that:

* only a Super Admin and a Moderator holding the ``services`` scope can create or manage a Provider
  — every other actor (other-scope Moderators, scope-less Moderators, Professionals, Residents,
  unverified and anonymous callers) is refused, and a refusal writes nothing;
* a Provider has no owner (the stored ``owner_id`` is NULL), needs no Professional Profile, consumes
  no quota and never appears in anyone's owner dashboard;
* removing, pausing or re-scoping the staff member who created a Provider orphans nothing;
* an id that is not a Provider, or is out of a Moderator's scope, is indistinguishable from a
  missing one (``404``, same body);
* a client can forge neither authority nor ownership through a body;
* every staff mutation is durably audited, atomically with the change, and a failure at the audit
  write rolls the whole change back;
* the temporary RBAC-B Super Admin self-approval override is gone, ordinary self-moderation is not.

Races (a revoke against an in-flight write) live in ``test_provider_authoring_concurrency.py``.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import Response
from sqlalchemy import func, select, text

from app.core.rate_limit import RatePolicy
from app.models import (
    Listing,
    ListingStatusHistory,
    ProfessionalProfile,
    StaffAuditEvent,
    User,
)
from app.models.enums import (
    ActorRole,
    CategoryModule,
    HistoryAction,
    ListingKind,
    ListingStatus,
    PlanCode,
    StaffAuditAction,
    StaffAuditResource,
    StaffAuditSource,
    StaffScope,
)
from app.services.staff_audit import StaffAuditService
from tests.db.admin_helpers import ADMIN_LISTINGS, approve, reject
from tests.db.auth_helpers import AuthApi, AuthEnv, make_account, sessions_of
from tests.db.staff_helpers import (
    MODERATORS,
    appoint,
    audit_count,
    audit_events,
    no_secrets,
    remove,
    roles_of,
    scopes_of,
    super_admin,
)
from tests.db.write_helpers import (
    LISTINGS,
    MINE,
    approximate,
    archive,
    archive_provider,
    area_only,
    business_body,
    codes,
    create,
    create_provider,
    created_id,
    error_code,
    exact,
    food_body,
    history,
    patch,
    patch_provider,
    property_body,
    provider_body,
    set_status,
    signed_in,
    staff_provider_body,
    stored,
    stored_columns,
    tutor_body,
)

SERVICES = StaffScope.SERVICES
ALL_SCOPES = [
    StaffScope.SERVICES,
    StaffScope.DIRECTORY,
    StaffScope.FOOD,
    StaffScope.EDUCATION,
    StaffScope.PROPERTY,
]

ACCOUNTS: dict[str, dict[str, Any]] = {
    "super_admin": {"admin": True},
    "super_admin_professional": {"admin": True, "professional": PlanCode.PREMIUM},
    "services_moderator": {"moderator_scopes": [SERVICES]},
    "services_moderator_professional": {
        "moderator_scopes": [SERVICES],
        "professional": PlanCode.FREE,
    },
    "all_scopes_moderator": {"moderator_scopes": ALL_SCOPES},
    "all_scopes_moderator_professional": {
        "moderator_scopes": ALL_SCOPES,
        "professional": PlanCode.FREE,
    },
    "directory_moderator": {"moderator_scopes": [StaffScope.DIRECTORY]},
    "food_moderator": {"moderator_scopes": [StaffScope.FOOD]},
    "education_moderator": {"moderator_scopes": [StaffScope.EDUCATION]},
    "property_moderator": {"moderator_scopes": [StaffScope.PROPERTY]},
    "news_only_moderator": {"moderator_scopes": [StaffScope.NEWS]},
    "zero_scope_moderator": {"moderator_scopes": []},
    "professional": {"professional": PlanCode.FREE},
    "premium_professional": {"professional": PlanCode.PREMIUM},
    "resident": {},
    "unverified": {"verified": False},
    "unverified_admin": {"admin": True, "verified": False},
}

#: Who may create / manage a Provider, and who is refused, with the status each answers on CREATE.
CREATE_MATRIX: list[tuple[str, int]] = [
    ("super_admin", 201),
    ("super_admin_professional", 201),
    ("services_moderator", 201),  # no Professional Profile at all: authority is the scope
    ("services_moderator_professional", 201),
    ("all_scopes_moderator", 201),
    ("directory_moderator", 403),
    ("food_moderator", 403),
    ("education_moderator", 403),
    ("property_moderator", 403),
    ("news_only_moderator", 403),  # ``news`` confers nothing: no effective scope at all
    ("zero_scope_moderator", 403),
    ("professional", 403),
    ("premium_professional", 403),
    ("resident", 403),
    ("unverified", 403),
    ("unverified_admin", 403),
]
ALLOWED = [name for name, status in CREATE_MATRIX if status == 201]
REFUSED = [name for name, status in CREATE_MATRIX if status == 403]


def actor(env: AuthEnv, kind: str, email: str | None = None) -> tuple[AuthApi, User]:
    """``kind`` signed in through the real login; also the stored account."""
    address = email or f"{kind}-{uuid.uuid4().hex[:8]}@example.org"
    user = make_account(env.session, address, **ACCOUNTS[kind])
    api = env.client()
    assert api.login(address).status_code == 200
    return api, user


def api_of(env: AuthEnv, kind: str) -> AuthApi:
    return actor(env, kind)[0]


def provider_id_of(env: AuthEnv, author: AuthApi | None = None, **body: Any) -> str:
    """A Provider authored by ``author`` (default: a fresh Super Admin) through the staff API."""
    author = author or api_of(env, "super_admin")
    response = create_provider(author, staff_provider_body(**body))
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


def row(env: AuthEnv, listing_id: str) -> Listing:
    return stored(env.session, listing_id)


def listing_count(env: AuthEnv) -> int:
    env.session.expire_all()
    return int(env.session.scalar(select(func.count()).select_from(Listing)) or 0)


def provider_audit(env: AuthEnv, action: StaffAuditAction | None = None) -> list[StaffAuditEvent]:
    return [
        event
        for event in audit_events(env.session)
        if event.action
        in (
            {action}
            if action
            else {
                StaffAuditAction.PROVIDER_CREATED,
                StaffAuditAction.PROVIDER_UPDATED,
                StaffAuditAction.PROVIDER_ARCHIVED,
            }
        )
    ]


def approved_provider_id(env: AuthEnv, author: AuthApi | None = None, **body: Any) -> str:
    author = author or api_of(env, "super_admin")
    listing_id = provider_id_of(env, author, **body)
    set_status(env.session, listing_id, ListingStatus.APPROVED)
    return listing_id


def revision_of(env: AuthEnv, listing_id: str) -> int:
    return row(env, listing_id).revision


# =================================================================================================
# 1. Who may create — the whole actor matrix
# =================================================================================================


@pytest.mark.parametrize(("who", "expected"), CREATE_MATRIX)
def test_create_matrix(auth_env: AuthEnv, who: str, expected: int) -> None:
    api = api_of(auth_env, who)
    before = (listing_count(auth_env), audit_count(auth_env.session))

    response = create_provider(api)

    assert response.status_code == expected, response.text
    if expected == 201:
        assert listing_count(auth_env) == before[0] + 1
        assert audit_count(auth_env.session) == before[1] + 1
    else:
        assert error_code(response) in {"forbidden", "email_not_verified"}
        assert (listing_count(auth_env), audit_count(auth_env.session)) == before  # nothing written


def test_an_anonymous_caller_is_unauthenticated_and_nothing_is_written(auth_env: AuthEnv) -> None:
    anonymous = auth_env.client()

    for response in (
        create_provider(anonymous),
        patch_provider(anonymous, str(uuid.uuid4()), 1, name="Whatever Name"),
        archive_provider(anonymous, str(uuid.uuid4()), 1),
    ):
        assert response.status_code == 401
    assert listing_count(auth_env) == 0 and audit_count(auth_env.session) == 0


def test_the_matrix_covers_every_actor_class_the_design_names() -> None:
    names = {name for name, _ in CREATE_MATRIX}

    assert {
        "super_admin",
        "services_moderator",
        "directory_moderator",
        "food_moderator",
        "education_moderator",
        "property_moderator",
        "news_only_moderator",
        "zero_scope_moderator",
        "professional",
        "resident",
    } <= names


@pytest.mark.parametrize("who", REFUSED)
def test_a_refused_actor_cannot_edit_or_archive_an_existing_provider_either(
    auth_env: AuthEnv, who: str
) -> None:
    listing_id = provider_id_of(auth_env)
    before = (revision_of(auth_env, listing_id), audit_count(auth_env.session))
    api = api_of(auth_env, who)

    edited = patch_provider(api, listing_id, 1, name="Hijacked Name")
    archived = archive_provider(api, listing_id, 1)

    # 403 (not staff / no effective scope at the front door) or 404 (a Moderator with SOME scope
    # but not ``services``: the id is concealed). Never 200, never 409, never a leaked detail.
    assert edited.status_code in (403, 404) and archived.status_code in (403, 404)
    assert row(auth_env, listing_id).title == "Bright Spark Electricians"
    assert (revision_of(auth_env, listing_id), audit_count(auth_env.session)) == before


# =================================================================================================
# 2. Creation semantics — a portal-managed Provider has no owner
# =================================================================================================


def test_a_created_provider_is_pending_revision_one_and_has_no_owner(auth_env: AuthEnv) -> None:
    admin, user = actor(auth_env, "super_admin")

    response = create_provider(admin)

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["kind"] == "provider" and data["status"] == "pending" and data["revision"] == 1
    assert data["category"] == "electrical" and data["name"] == "Bright Spark Electricians"
    assert response.headers["Location"] == f"/api/v1/admin/listings/{data['id']}"
    assert response.headers["Cache-Control"] == "no-store"
    assert "submitter" not in data  # nobody owns it, so there is no submitter to show

    stored_row = row(auth_env, data["id"])
    assert stored_row.owner_id is None  # the invariant: never the author
    assert stored_row.kind is ListingKind.PROVIDER and stored_row.status is ListingStatus.PENDING
    assert stored_row.revision == 1 and stored_row.submitted_at is not None
    assert "bright spark electricians" in stored_row.search_document
    assert stored_row.is_featured is False
    assert user.id != stored_row.owner_id


def test_a_provider_cannot_be_given_an_owner_in_the_database_whatever_the_code_does(
    auth_env: AuthEnv,
) -> None:
    """The CHECK is the last line of defence: a future code path that tried would be refused by
    PostgreSQL, not by a convention."""
    listing_id = provider_id_of(auth_env)
    author = make_account(auth_env.session, "someone@example.org")

    with pytest.raises(Exception, match="ck_listings_provider_has_no_owner"):
        auth_env.session.execute(
            text("UPDATE listings SET owner_id = :u WHERE id = :i"),
            {"u": author.id, "i": uuid.UUID(listing_id)},
        )
        auth_env.session.flush()
    auth_env.session.rollback()


def test_a_created_provider_has_its_category_and_one_submission_history_row(
    auth_env: AuthEnv,
) -> None:
    listing_id = provider_id_of(auth_env, category="plumbing")

    categories = auth_env.session.execute(
        text(
            "SELECT c.module, c.slug, lc.position FROM listing_categories lc "
            "JOIN categories c ON c.id = lc.category_id WHERE lc.listing_id = :i"
        ),
        {"i": uuid.UUID(listing_id)},
    ).all()
    assert [(m, s, p) for m, s, p in categories] == [("services", "plumbing", 1)]
    entries = history(auth_env.session, listing_id)
    assert len(entries) == 1
    assert (entries[0].from_status, entries[0].to_status) == (None, ListingStatus.PENDING)
    assert entries[0].action is HistoryAction.SUBMITTED and entries[0].revision == 1


@pytest.mark.parametrize(
    ("who", "role"),
    [
        ("super_admin", ActorRole.ADMIN),
        ("services_moderator", ActorRole.MODERATOR),
    ],
)
def test_the_author_is_recorded_as_the_history_actor_with_their_staff_role(
    auth_env: AuthEnv, who: str, role: ActorRole
) -> None:
    api, user = actor(auth_env, who)

    listing_id = provider_id_of(auth_env, api)

    entry = history(auth_env.session, listing_id)[0]
    assert entry.actor_user_id == user.id  # the session's user, never a body field
    assert entry.actor_role is role  # NOT ``owner``: the actor never owned anything


def test_a_staff_member_without_a_professional_profile_authors_without_getting_one(
    auth_env: AuthEnv,
) -> None:
    api, user = actor(auth_env, "services_moderator")
    assert auth_env.session.get(ProfessionalProfile, user.id) is None

    assert create_provider(api).status_code == 201

    auth_env.session.expire_all()
    assert auth_env.session.get(ProfessionalProfile, user.id) is None  # none was created for them


def test_a_provider_consumes_no_quota_and_is_in_no_owner_dashboard(auth_env: AuthEnv) -> None:
    api, user = actor(auth_env, "super_admin_professional")
    for index in range(4):  # more than any plan's active-listing limit
        assert (
            create_provider(api, staff_provider_body(name=f"Provider number {index}")).status_code
            == 201
        )

    mine = api.get(MINE)
    assert mine.status_code == 200
    assert mine.json()["data"] == [] and mine.json()["meta"]["total"] == 0
    counts = mine.json()["meta"]["counts"]
    assert counts["pending"] == 0 and counts["activeQuota"] == 0
    assert api.get(MINE, params={"kind": "provider"}).json()["data"] == []
    # ...and the author's own owned listings still work exactly as before.
    owned = create(api, business_body(name="My Own Shop"))
    assert owned.status_code == 201, owned.text
    assert api.get(MINE).json()["meta"]["counts"]["activeQuota"] == 1
    assert row(auth_env, owned.json()["data"]["id"]).owner_id == user.id  # ownership unchanged


def test_two_providers_with_the_same_name_are_both_created(auth_env: AuthEnv) -> None:
    """There is no uniqueness rule on a name (nothing in the design asks for one)."""
    api = api_of(auth_env, "super_admin")

    first = provider_id_of(auth_env, api)
    second = provider_id_of(auth_env, api)

    assert first != second


def test_the_response_serialises_without_an_owner_and_with_the_creation_history(
    auth_env: AuthEnv,
) -> None:
    api, user = actor(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)

    detail = api.get(f"{ADMIN_LISTINGS}/{listing_id}")

    assert detail.status_code == 200, detail.text
    data = detail.json()["data"]
    assert data["kind"] == "provider" and "submitter" not in data
    assert [(h["action"], h["actor"]["role"]) for h in data["history"]] == [("submitted", "admin")]


def test_a_new_provider_is_not_public_until_it_is_approved(auth_env: AuthEnv) -> None:
    listing_id = provider_id_of(auth_env)
    visitor = auth_env.client()

    assert visitor.get(f"/listings/{listing_id}").status_code == 404

    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    shown = visitor.get(f"/listings/{listing_id}")
    assert shown.status_code == 200, shown.text
    assert shown.json()["data"]["kind"] == "provider"
    assert "owner" not in str(shown.json()).lower()


# -- categories: validated against the authoritative taxonomy ------------------------------------


@pytest.mark.parametrize(
    "slug",
    ["grocery", "physics", "house", "bakeries", "does-not-exist", "Electrical", " "],
    ids=["directory", "education", "property", "food", "unknown", "wrong-case", "blank"],
)
def test_a_category_outside_the_services_taxonomy_is_refused_on_create(
    auth_env: AuthEnv, slug: str
) -> None:
    api = api_of(auth_env, "super_admin")

    response = create_provider(api, staff_provider_body(category=slug))

    assert response.status_code == 422, response.text
    assert listing_count(auth_env) == 0 and audit_count(auth_env.session) == 0
    assert (
        any(field.startswith("category") for field, _ in codes(response))
        or error_code(response) == "validation_error"
    )


def test_an_inactive_services_category_is_refused_for_a_new_provider(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    auth_env.session.execute(
        text(
            "UPDATE categories SET is_active = false WHERE module = 'services' AND slug = 'plumbing'"
        )
    )
    auth_env.session.commit()

    response = create_provider(api, staff_provider_body(category="plumbing"))

    assert response.status_code == 422
    assert ("category", "unknown_category") in codes(response)
    assert listing_count(auth_env) == 0


def test_a_provider_keeps_a_category_that_was_deactivated_after_it_chose_it(
    auth_env: AuthEnv,
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api, category="plumbing")
    auth_env.session.execute(
        text(
            "UPDATE categories SET is_active = false WHERE module = 'services' AND slug = 'plumbing'"
        )
    )
    auth_env.session.commit()

    # An edit that does not touch the category is fine, and so is re-sending the same one...
    assert patch_provider(api, listing_id, 1, name="Renamed Plumbers").status_code == 200
    assert patch_provider(api, listing_id, 2, category="plumbing").status_code == 200
    # ...but moving to ANOTHER inactive one (or back to it after leaving) is not.
    assert patch_provider(api, listing_id, 2, category="electrical").status_code == 200
    again = patch_provider(api, listing_id, 3, category="plumbing")
    assert again.status_code == 422 and ("category", "unknown_category") in codes(again)


def test_the_category_check_reads_the_live_taxonomy_not_a_copy(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    admin_api = api  # a Super Admin can create categories through the real taxonomy API
    created = admin_api.request(
        "POST", "/admin/categories", json={"module": "services", "name": "Solar Installers"}
    )
    assert created.status_code == 201, created.text

    ok = create_provider(api, staff_provider_body(category=created.json()["data"]["slug"]))

    assert ok.status_code == 201, ok.text
    module = auth_env.session.scalar(
        text(
            "SELECT c.module FROM listing_categories lc "
            "JOIN categories c ON c.id = lc.category_id WHERE lc.listing_id = :i"
        ),
        {"i": uuid.UUID(ok.json()["data"]["id"])},
    )
    assert module == CategoryModule.SERVICES.value


def test_an_edit_to_a_wrong_module_category_is_refused_and_changes_nothing(
    auth_env: AuthEnv,
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    before = (revision_of(auth_env, listing_id), audit_count(auth_env.session))

    response = patch_provider(api, listing_id, 1, category="grocery")

    assert response.status_code == 422 and ("category", "unknown_category") in codes(response)
    assert (revision_of(auth_env, listing_id), audit_count(auth_env.session)) == before


# =================================================================================================
# 3. Other fields: validation reuses the owner API's content rules
# =================================================================================================


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"name": "x"}, "name"),
        ({"description": "too short"}, "description"),
        ({"area": "Nowhere Land"}, "area"),
        ({"tags": ["a"] * 21}, "tags"),
        ({"image": "javascript:alert(1)"}, "image"),
        ({"location": exact(latitude=95.0)}, "location.latitude"),
        ({"location": approximate(address=None, latitude=None)}, "location"),
    ],
)
def test_content_is_validated_like_every_other_listing(
    auth_env: AuthEnv, overrides: dict[str, Any], field: str
) -> None:
    api = api_of(auth_env, "super_admin")

    response = create_provider(api, staff_provider_body(**overrides))

    assert response.status_code == 422, response.text
    assert any(f.startswith(field.split(".")[0]) for f, _ in codes(response))
    assert listing_count(auth_env) == 0 and audit_count(auth_env.session) == 0


@pytest.mark.parametrize(
    ("location", "expected"),
    [
        (None, []),  # absent: area_only by default, never a forced public home point
        (exact(), []),
        (approximate(), []),
        (area_only(), []),
        (exact(address=None), [("location.address", "required")]),
        (
            approximate(latitude=None, longitude=None),
            [("location.latitude", "required"), ("location.longitude", "required")],
        ),
        (area_only(latitude=33.1, longitude=72.1), [("location.latitude", "not_allowed")]),
    ],
    ids=[
        "absent",
        "exact",
        "approximate",
        "area-only",
        "exact-no-address",
        "approximate-no-point",
        "area-only-with-point",
    ],
)
def test_a_providers_location_requiredness_matches_the_owner_api(
    auth_env: AuthEnv, location: dict[str, Any] | None, expected: list[tuple[str, str]]
) -> None:
    """Moved from the owner create tests: the Provider rules (LOCATION_MAP §6) are unchanged."""
    api = api_of(auth_env, "super_admin")
    body = staff_provider_body()
    if location is not None:
        body["location"] = location

    response = create_provider(api, body)

    if expected:
        assert response.status_code == 422, response.text
        assert codes(response) == expected
    else:
        assert response.status_code == 201, response.text


def test_a_provider_defaults_to_an_area_only_location(auth_env: AuthEnv) -> None:
    listing_id = provider_id_of(auth_env)

    columns = stored_columns(auth_env.session, listing_id)
    assert columns["location_visibility"] == "area_only"
    assert columns["latitude"] is None and columns["longitude"] is None


# =================================================================================================
# 4. Edit — cross-staff, lifecycle, concurrency tokens
# =================================================================================================


@pytest.mark.parametrize("editor", ["super_admin", "services_moderator", "all_scopes_moderator"])
def test_another_staff_member_can_edit_a_provider_they_did_not_create(
    auth_env: AuthEnv, editor: str
) -> None:
    creator = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, creator)
    other, other_user = actor(auth_env, editor)

    response = patch_provider(other, listing_id, 1, name="Edited By Someone Else")

    assert response.status_code == 200, response.text
    assert response.json()["data"]["name"] == "Edited By Someone Else"
    assert response.json()["data"]["revision"] == 2
    assert row(auth_env, listing_id).owner_id is None  # editing never makes the editor the owner
    updated = provider_audit(auth_env, StaffAuditAction.PROVIDER_UPDATED)
    assert [event.actor_user_id for event in updated] == [other_user.id]


def test_a_material_edit_of_an_approved_provider_returns_it_to_pending(auth_env: AuthEnv) -> None:
    api, user = actor(auth_env, "services_moderator")
    listing_id = approved_provider_id(auth_env, api)
    submitted_before = row(auth_env, listing_id).submitted_at

    response = patch_provider(
        api, listing_id, 1, description="A newly written, longer description."
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["status"] == "pending" and data["revision"] == 2
    entries = history(auth_env.session, listing_id)
    assert [e.action for e in entries][-1] is HistoryAction.RESUBMITTED
    assert entries[-1].from_status is ListingStatus.APPROVED
    assert entries[-1].to_status is ListingStatus.PENDING and entries[-1].revision == 2
    assert entries[-1].actor_user_id == user.id and entries[-1].actor_role is ActorRole.MODERATOR
    assert row(auth_env, listing_id).submitted_at >= submitted_before
    assert (
        auth_env.client().get(f"/listings/{listing_id}").status_code == 404
    )  # off the public site


def test_a_pure_visibility_narrowing_keeps_the_status_and_writes_no_history(
    auth_env: AuthEnv,
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = approved_provider_id(
        auth_env, api, location=approximate(address=None, landmark=None)
    )
    entries_before = len(history(auth_env.session, listing_id))

    response = patch_provider(api, listing_id, 1, location=area_only(block="B"))

    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "approved"
    assert response.json()["data"]["revision"] == 2
    assert len(history(auth_env.session, listing_id)) == entries_before
    audit = provider_audit(auth_env, StaffAuditAction.PROVIDER_UPDATED)[0]
    assert audit.after is not None and audit.after["status"] == "approved"
    assert audit.after["changed_fields"] == ["location"]


def test_a_no_op_edit_writes_nothing_at_all(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    before = (
        row(auth_env, listing_id).revision,
        len(history(auth_env.session, listing_id)),
        audit_count(auth_env.session),
    )

    response = patch_provider(api, listing_id, 1, name="Bright Spark Electricians")

    assert response.status_code == 200 and response.json()["data"]["revision"] == 1
    assert (
        row(auth_env, listing_id).revision,
        len(history(auth_env.session, listing_id)),
        audit_count(auth_env.session),
    ) == before


def test_an_unedited_rejected_provider_cannot_be_resubmitted(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED)

    response = patch_provider(api, listing_id, 1, name="Bright Spark Electricians")

    assert response.status_code == 422 and ("request", "no_changes") in codes(response)


def test_editing_a_rejected_provider_resubmits_it(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    set_status(auth_env.session, listing_id, ListingStatus.REJECTED)

    response = patch_provider(api, listing_id, 1, tags=["better", "tags"])

    assert response.status_code == 200 and response.json()["data"]["status"] == "pending"
    assert history(auth_env.session, listing_id)[-1].action is HistoryAction.RESUBMITTED


def test_a_stale_revision_is_a_conflict_and_changes_nothing(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    assert patch_provider(api, listing_id, 1, name="First Edit Wins").status_code == 200
    before = audit_count(auth_env.session)

    stale = patch_provider(api, listing_id, 1, name="Second Edit Loses")

    assert stale.status_code == 409 and error_code(stale) == "listing_conflict"
    assert ("revision", "stale_revision") in codes(stale)
    assert row(auth_env, listing_id).title == "First Edit Wins"
    assert audit_count(auth_env.session) == before


def test_an_archived_provider_cannot_be_edited_or_archived_again(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    assert archive_provider(api, listing_id, 1).status_code == 200
    before = audit_count(auth_env.session)

    edit = patch_provider(api, listing_id, 2, name="Zombie Edit Attempt")
    again = archive_provider(api, listing_id, 2)

    for response in (edit, again):
        assert response.status_code == 409 and error_code(response) == "invalid_state_transition"
    assert audit_count(auth_env.session) == before


def test_an_edit_changes_only_what_it_sends_and_lists_it_in_the_audit(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api, tags=["wiring", "repairs"])

    response = patch_provider(
        api, listing_id, 1, name="Brighter Spark", tags=["wiring"], category="plumbing"
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["name"] == "Brighter Spark" and data["tags"] == ["wiring"]
    assert data["category"] == "plumbing" and data["area"] == "B-17"  # untouched
    event = provider_audit(auth_env, StaffAuditAction.PROVIDER_UPDATED)[0]
    assert event.after is not None
    assert event.after["changed_fields"] == ["name", "category", "tags"]
    assert event.before == {"status": "pending", "revision": 1}
    assert event.after["revision"] == 2 and event.after["status"] == "pending"


def test_an_edit_refreshes_the_search_document(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)

    assert patch_provider(api, listing_id, 1, name="Zephyr Wiring Works").status_code == 200

    document = row(auth_env, listing_id).search_document
    assert "zephyr wiring works" in document and "bright spark" not in document


def test_null_clears_only_the_image_and_nothing_else(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api, image="/images/x.jpg")

    cleared = patch_provider(api, listing_id, 1, image=None)
    assert cleared.status_code == 200 and "image" not in cleared.json()["data"]

    for field in ("name", "description", "area", "category", "tags"):
        response = patch_provider(api, listing_id, 2, **{field: None})
        assert response.status_code == 422, (field, response.text)
        assert (field, "not_nullable") in codes(response)


# =================================================================================================
# 5. Archive
# =================================================================================================


@pytest.mark.parametrize("who", ["super_admin", "services_moderator"])
def test_staff_archive_a_provider_terminally(auth_env: AuthEnv, who: str) -> None:
    api, user = actor(auth_env, who)
    listing_id = approved_provider_id(auth_env, api)

    response = archive_provider(api, listing_id, 1)

    assert response.status_code == 200, response.text
    assert (
        response.json()["data"]["status"] == "archived" and response.json()["data"]["revision"] == 2
    )
    entry = history(auth_env.session, listing_id)[-1]
    assert entry.action is HistoryAction.ARCHIVED and entry.revision == 2
    assert entry.from_status is ListingStatus.APPROVED and entry.to_status is ListingStatus.ARCHIVED
    assert entry.actor_user_id == user.id
    event = provider_audit(auth_env, StaffAuditAction.PROVIDER_ARCHIVED)[0]
    assert event.before == {"status": "approved", "revision": 1}
    assert event.after == {"status": "archived", "revision": 2}
    assert auth_env.client().get(f"/listings/{listing_id}").status_code == 404
    assert row(auth_env, listing_id).owner_id is None


def test_archive_with_a_stale_revision_is_a_conflict(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    assert patch_provider(api, listing_id, 1, name="Edited First").status_code == 200

    stale = archive_provider(api, listing_id, 1)

    assert stale.status_code == 409 and error_code(stale) == "listing_conflict"
    assert row(auth_env, listing_id).status is ListingStatus.PENDING


def test_there_is_no_restore_route(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    archive_provider(api, listing_id, 1)

    for path in ("restore", "unarchive", "reactivate"):
        response = api.request(
            "POST", f"/admin/providers/{listing_id}/{path}", json={"revision": 2}
        )
        assert response.status_code in (404, 405)
    assert row(auth_env, listing_id).status is ListingStatus.ARCHIVED


# =================================================================================================
# 6. Demotion, removal and re-scoping orphan nothing
# =================================================================================================


def test_removing_the_moderator_who_created_a_provider_orphans_nothing(auth_env: AuthEnv) -> None:
    boss = super_admin(auth_env)
    author_email = "author-mod@example.org"
    make_account(auth_env.session, author_email, moderator_scopes=[SERVICES])
    author = auth_env.client()
    assert author.login(author_email).status_code == 200
    author_id = auth_env.session.scalar(select(User.id).where(User.email == author_email))
    assert author_id is not None
    listing_id = approved_provider_id(auth_env, author)

    assert remove(boss, author_id).status_code == 204  # a real RBAC-C removal (sessions revoked)

    assert roles_of(auth_env.session, author_id) == set()
    # The ex-moderator is out: their old session is gone and cannot touch the Provider...
    assert patch_provider(author, listing_id, 1, name="Revenge Edit Attempt").status_code == 401
    # ...while the Provider is untouched, still ownerless, and manageable by any other staff.
    assert row(auth_env, listing_id).owner_id is None
    assert row(auth_env, listing_id).status is ListingStatus.APPROVED
    edited = patch_provider(boss, listing_id, 1, name="Taken Over By The Portal")
    assert edited.status_code == 200, edited.text
    assert archive_provider(boss, listing_id, 2).status_code == 200
    # Their authorship is still on record.
    created = provider_audit(auth_env, StaffAuditAction.PROVIDER_CREATED)[0]
    assert created.actor_user_id == author_id
    assert history(auth_env.session, listing_id)[0].actor_user_id == author_id


def test_demoting_the_super_admin_who_created_a_provider_orphans_nothing(
    auth_env: AuthEnv,
) -> None:
    author, author_user = actor(auth_env, "super_admin")
    other = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, author)

    auth_env.session.execute(
        text("DELETE FROM user_roles WHERE user_id = :u AND role = 'admin'"), {"u": author_user.id}
    )
    auth_env.session.commit()

    assert patch_provider(author, listing_id, 1, name="Former Admin Edit").status_code == 403
    assert archive_provider(author, listing_id, 1).status_code == 403
    assert patch_provider(other, listing_id, 1, name="Still Manageable").status_code == 200
    assert row(auth_env, listing_id).owner_id is None


def test_a_super_admin_who_also_owned_listings_is_not_special(auth_env: AuthEnv) -> None:
    """An old (pre-RBAC-D) world: an admin who authored through the owner API is exactly like any
    other staff member now — the Provider belongs to the portal."""
    author, author_user = actor(auth_env, "super_admin_professional")
    listing_id = provider_id_of(auth_env, author)
    assert row(auth_env, listing_id).owner_id is None
    auth_env.session.execute(
        text("DELETE FROM professional_profiles WHERE user_id = :u"), {"u": author_user.id}
    )
    auth_env.session.commit()

    # Even with the Professional Profile gone, authority is unchanged (it never depended on it).
    assert patch_provider(author, listing_id, 1, name="No Profile Needed").status_code == 200


def test_changing_a_moderators_scope_away_from_services_ends_their_provider_authority(
    auth_env: AuthEnv,
) -> None:
    boss = super_admin(auth_env)
    email = "scoped-mod@example.org"
    user = make_account(auth_env.session, email, moderator_scopes=[SERVICES])
    moderator = auth_env.client()
    assert moderator.login(email).status_code == 200
    listing_id = provider_id_of(auth_env, moderator)

    replaced = boss.request(
        "PUT",
        f"{MODERATORS}/{user.id}/scopes",
        json={"scopes": ["directory"], "revision": 0},
    )
    assert replaced.status_code == 200, replaced.text
    assert scopes_of(auth_env.session, user.id) == ["directory"]

    again = auth_env.client()
    assert again.login(email).status_code == 200  # a fresh session, now a directory moderator
    created = create_provider(again)
    assert created.status_code == 403  # create: forbidden
    edited = patch_provider(again, listing_id, 1, name="Out Of Scope Edit")
    assert edited.status_code == 404  # existing id: concealed
    assert row(auth_env, listing_id).title == "Bright Spark Electricians"


def test_pausing_a_moderator_ends_their_provider_authority_but_not_the_provider(
    auth_env: AuthEnv,
) -> None:
    boss = super_admin(auth_env)
    email = "paused-mod@example.org"
    user = make_account(auth_env.session, email, moderator_scopes=[SERVICES])
    moderator = auth_env.client()
    assert moderator.login(email).status_code == 200
    listing_id = provider_id_of(auth_env, moderator)

    paused = boss.request("POST", f"{MODERATORS}/{user.id}/pause", json={"revision": 0})
    assert paused.status_code == 200

    assert patch_provider(moderator, listing_id, 1, name="Paused Edit").status_code in (401, 403)
    assert patch_provider(boss, listing_id, 1, name="Portal Edit").status_code == 200


# =================================================================================================
# 7. Concealment and IDOR
# =================================================================================================


def envelope(response: Response) -> tuple[int, str, list[tuple[str, str]]]:
    """Everything of an error a client can compare: status, code, detail codes (no request id)."""
    return response.status_code, error_code(response), codes(response)


def test_a_missing_id_and_an_out_of_scope_id_answer_identically(auth_env: AuthEnv) -> None:
    listing_id = provider_id_of(auth_env)
    outsider = api_of(auth_env, "directory_moderator")
    missing = str(uuid.uuid4())

    existing_out_of_scope = [
        patch_provider(outsider, listing_id, 1, name="Probing Edit Attempt"),
        archive_provider(outsider, listing_id, 1),
    ]
    absent = [
        patch_provider(outsider, missing, 1, name="Probing Edit Attempt"),
        archive_provider(outsider, missing, 1),
    ]

    assert [envelope(r) for r in existing_out_of_scope] == [envelope(r) for r in absent]
    assert all(r.status_code == 404 for r in absent)
    assert row(auth_env, listing_id).revision == 1


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "1", "../etc/passwd", "0" * 40, "%00"])
def test_a_malformed_id_is_a_plain_404(auth_env: AuthEnv, bad_id: str) -> None:
    api = api_of(auth_env, "super_admin")

    assert patch_provider(api, bad_id, 1, name="Whatever Name").status_code == 404
    assert archive_provider(api, bad_id, 1).status_code == 404


NON_PROVIDER_BODIES = {
    "business": business_body,
    "food": food_body,
    "tutor": tutor_body,
    "property": property_body,
}


@pytest.mark.parametrize("kind", list(NON_PROVIDER_BODIES))
@pytest.mark.parametrize("status", [ListingStatus.PENDING, ListingStatus.APPROVED])
def test_a_provider_route_never_touches_a_listing_of_another_kind(
    auth_env: AuthEnv, kind: str, status: ListingStatus
) -> None:
    owner = signed_in(auth_env, "owner-x@example.org", professional=PlanCode.PREMIUM)
    other_id = created_id(owner, NON_PROVIDER_BODIES[kind]())
    if status is ListingStatus.APPROVED:
        set_status(auth_env.session, other_id, status)
    before = stored_snapshot(auth_env, other_id)
    audit_before = audit_count(auth_env.session)

    for who in ("super_admin", "services_moderator", "all_scopes_moderator"):
        api = api_of(auth_env, who)
        edit = patch_provider(api, other_id, 1, name="Cross Kind Edit")
        archived = archive_provider(api, other_id, 1)
        assert envelope(edit)[0] == 404 and envelope(archived)[0] == 404, (who, kind)
        assert envelope(edit) == envelope(archived)

    assert stored_snapshot(auth_env, other_id) == before  # not one column of it moved
    assert audit_count(auth_env.session) == audit_before


def stored_snapshot(env: AuthEnv, listing_id: str) -> tuple[Any, ...]:
    env.session.expire_all()
    result = env.session.execute(
        text("SELECT status, revision, title, owner_id, updated_at FROM listings WHERE id = :i"),
        {"i": uuid.UUID(listing_id)},
    ).one()
    return tuple(result)


def test_a_provider_id_on_the_owner_api_is_not_found_for_everyone(auth_env: AuthEnv) -> None:
    """The legacy edit / archive path is owner-bound and a Provider has no owner, so it finds
    nothing — for a Professional, for the very staff member who created it, for anyone."""
    author, _ = actor(auth_env, "super_admin_professional")
    listing_id = provider_id_of(auth_env, author)
    snapshot = stored_snapshot(auth_env, listing_id)

    for who in ("super_admin_professional", "services_moderator_professional", "professional"):
        api = author if who == "super_admin_professional" else api_of(auth_env, who)
        assert patch(api, listing_id, 1, name="Legacy Path Edit").status_code == 404
        assert archive(api, listing_id, 1).status_code == 404
        assert api.get(f"{MINE}/{listing_id}").status_code == 404

    assert stored_snapshot(auth_env, listing_id) == snapshot


# =================================================================================================
# 8. The legacy /listings surface refuses Providers for everyone
# =================================================================================================


@pytest.mark.parametrize(
    "who",
    [
        "professional",
        "premium_professional",
        "super_admin_professional",
        "services_moderator_professional",
    ],
)
def test_post_listings_refuses_a_provider_for_every_user_including_staff(
    auth_env: AuthEnv, who: str
) -> None:
    api = api_of(auth_env, who)
    before = (listing_count(auth_env), audit_count(auth_env.session))

    response = create(api, provider_body())

    assert response.status_code == 403, response.text
    assert ("kind", "provider_admin_only") in codes(response)
    assert (listing_count(auth_env), audit_count(auth_env.session)) == before


@pytest.mark.parametrize("who", ["super_admin", "services_moderator", "resident"])
def test_post_listings_refuses_a_provider_for_a_user_without_a_profile_too(
    auth_env: AuthEnv, who: str
) -> None:
    api = api_of(auth_env, who)

    response = create(api, provider_body())

    assert response.status_code == 403
    assert listing_count(auth_env) == 0


def test_the_other_kinds_are_still_created_through_post_listings_by_staff(
    auth_env: AuthEnv,
) -> None:
    """Business / Tutor / Property ownership is untouched: a staff member who is also a
    professional still owns what they create there, quota and all."""
    api, user = actor(auth_env, "super_admin_professional")

    for body in (business_body(), tutor_body(), property_body()):
        response = create(api, body)
        assert response.status_code == 201, response.text
        assert row(auth_env, response.json()["data"]["id"]).owner_id == user.id


# =================================================================================================
# 9. Forged bodies
# =================================================================================================

FORGED = {
    "kind": "business",
    "vertical": "food",
    "ownerId": str(uuid.uuid4()),
    "status": "approved",
    "role": "admin",
    "roles": ["admin"],
    "scope": "services",
    "staffScopes": ["services"],
    "actorUserId": str(uuid.uuid4()),
    "managedBy": str(uuid.uuid4()),
    "featured": True,
    "revision": 9,
}


@pytest.mark.parametrize("key", list(FORGED))
def test_a_forged_key_on_create_is_a_422_and_writes_nothing(auth_env: AuthEnv, key: str) -> None:
    api = api_of(auth_env, "super_admin")

    response = create_provider(api, staff_provider_body(**{key: FORGED[key]}))

    assert response.status_code == 422, response.text
    assert (key, "not_allowed") in codes(response)
    assert listing_count(auth_env) == 0 and audit_count(auth_env.session) == 0
    forged = FORGED[key]
    if isinstance(forged, str) and len(forged) > 4:
        assert forged not in response.text  # the forged value is never echoed back


@pytest.mark.parametrize("key", [key for key in FORGED if key != "revision"])
def test_a_forged_key_on_edit_is_a_422_and_changes_nothing(auth_env: AuthEnv, key: str) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    before = (stored_snapshot(auth_env, listing_id), audit_count(auth_env.session))

    response = patch_provider(api, listing_id, 1, name="Honest Edit", **{key: FORGED[key]})

    assert response.status_code == 422, response.text
    assert (key, "not_allowed") in codes(response)
    assert (stored_snapshot(auth_env, listing_id), audit_count(auth_env.session)) == before


def test_forged_headers_and_query_claims_grant_no_authority(auth_env: AuthEnv) -> None:
    resident = api_of(auth_env, "resident")
    moderator = api_of(auth_env, "directory_moderator")
    forged_headers = {
        "X-Staff-Scope": "services",
        "X-Admin": "true",
        "X-Roles": "admin",
        "X-User-Id": str(uuid.uuid4()),
        "X-Forwarded-User": "admin",
    }

    for api in (resident, moderator):
        response = api.request(
            "POST",
            "/admin/providers",
            json=staff_provider_body(),
            headers=forged_headers,
            params={"scope": "services", "role": "admin", "module": "services"},
        )
        assert response.status_code == 403, response.text
    assert listing_count(auth_env) == 0


def test_a_malformed_json_body_is_a_422_not_a_500(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")

    bodies: tuple[Any, ...] = (None, [], "text", 1)
    for body in bodies:
        response = api.request("POST", "/admin/providers", json=body)
        assert response.status_code == 422, (body, response.text)
    raw = api.request(
        "POST",
        "/admin/providers",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )
    assert raw.status_code == 400  # unparseable JSON is the app's plain bad request
    assert listing_count(auth_env) == 0


def test_csrf_and_origin_are_required_on_every_provider_write(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)

    no_csrf = api.request("POST", "/admin/providers", json=staff_provider_body(), csrf=None)
    bad_origin = api.request(
        "PATCH",
        f"/admin/providers/{listing_id}",
        json={"revision": 1, "name": "Cross Site Edit"},
        origin="https://evil.example",
    )
    no_origin_archive = api.request(
        "POST", f"/admin/providers/{listing_id}/archive", json={"revision": 1}, origin=None
    )

    assert no_csrf.status_code == 403 and bad_origin.status_code == 403
    assert no_origin_archive.status_code == 403
    assert row(auth_env, listing_id).title == "Bright Spark Electricians"


# =================================================================================================
# 10. The staff audit
# =================================================================================================


def test_a_create_writes_one_allow_listed_audit_event_with_session_and_actor(
    auth_env: AuthEnv,
) -> None:
    api, user = actor(auth_env, "services_moderator")

    listing_id = provider_id_of(auth_env, api)

    events = provider_audit(auth_env)
    assert len(events) == 1
    event = events[0]
    assert event.action is StaffAuditAction.PROVIDER_CREATED
    assert event.source is StaffAuditSource.WEB and event.actor_user_id == user.id
    assert event.resource_type is StaffAuditResource.LISTING
    assert str(event.resource_id) == listing_id and event.target_user_id is None
    assert event.before is None
    assert event.after == {
        "kind": "provider",
        "status": "pending",
        "revision": 1,
        "name": "Bright Spark Electricians",
    }
    assert event.session_id == sessions_of(auth_env.session, user.id)[0].id
    assert event.reason is None
    no_secrets(str(event.after))


def test_the_audit_never_carries_content_a_location_or_a_secret(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(
        auth_env, api, location=exact(address="House 7, Street 9", landmark="Blue gate")
    )
    patch_provider(
        api, listing_id, 1, location=exact(address="Another Private Address", latitude=33.5)
    )
    archive_provider(api, listing_id, 2)

    for event in provider_audit(auth_env):
        blob = f"{event.before} {event.after} {event.reason}"
        for private in ("House 7", "Blue gate", "Another Private", "33.5", "72.123"):
            assert private not in blob
        no_secrets(blob)
        assert set(event.after or {}) <= {"kind", "status", "revision", "name", "changed_fields"}


def test_the_audit_api_shows_provider_events_to_a_super_admin_only(auth_env: AuthEnv) -> None:
    boss = super_admin(auth_env)
    moderator = api_of(auth_env, "services_moderator")
    provider_id_of(auth_env, moderator)

    shown = boss.get("/admin/audit", params={"action": "provider_created"})
    assert shown.status_code == 200, shown.text
    assert [e["action"] for e in shown.json()["data"]] == ["provider_created"]
    assert moderator.get("/admin/audit").status_code == 403


def test_a_refused_attempt_leaves_no_audit_row(auth_env: AuthEnv) -> None:
    listing_id = provider_id_of(auth_env)
    baseline = audit_count(auth_env.session)

    attempts = [
        create_provider(api_of(auth_env, "directory_moderator")),
        create_provider(api_of(auth_env, "professional")),
        patch_provider(api_of(auth_env, "food_moderator"), listing_id, 1, name="Nope Not Mine"),
        archive_provider(api_of(auth_env, "resident"), listing_id, 1),
        create_provider(api_of(auth_env, "super_admin"), staff_provider_body(category="grocery")),
        patch_provider(api_of(auth_env, "super_admin"), listing_id, 7, name="Stale Revision"),
    ]

    assert all(r.status_code >= 400 for r in attempts)
    assert audit_count(auth_env.session) == baseline


def test_moderation_decisions_stay_in_the_listing_history_and_are_not_duplicated(
    auth_env: AuthEnv,
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)
    baseline = audit_count(auth_env.session)

    assert approve(api, listing_id, 1).status_code == 200

    assert audit_count(auth_env.session) == baseline  # an approval is NOT a staff-audit event
    assert history(auth_env.session, listing_id)[-1].action is HistoryAction.APPROVED


# =================================================================================================
# 11. Atomicity: a failure at the audit write rolls the whole change back
# =================================================================================================


def explode(*_args: Any, **_kwargs: Any) -> None:
    raise RuntimeError("audit store unavailable")


def test_a_failed_audit_write_rolls_back_a_create_entirely(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = api_of(auth_env, "super_admin")
    monkeypatch.setattr(StaffAuditService, "record", explode)

    response = create_provider(api)

    assert response.status_code == 500
    monkeypatch.undo()
    assert listing_count(auth_env) == 0  # no listing...
    for table in ("listing_categories", "listing_status_history", "staff_audit_events"):
        assert auth_env.session.scalar(text(f"SELECT count(*) FROM {table}")) == 0  # ...no children


def test_a_failed_audit_write_rolls_back_an_edit_entirely(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = approved_provider_id(auth_env, api)
    before = (stored_snapshot(auth_env, listing_id), len(history(auth_env.session, listing_id)))
    document = row(auth_env, listing_id).search_document
    monkeypatch.setattr(StaffAuditService, "record", explode)

    response = patch_provider(api, listing_id, 1, name="Doomed Edit", category="plumbing")

    assert response.status_code == 500
    monkeypatch.undo()
    assert (
        stored_snapshot(auth_env, listing_id),
        len(history(auth_env.session, listing_id)),
    ) == before
    assert row(auth_env, listing_id).search_document == document  # not reindexed either
    categories = auth_env.session.execute(
        text(
            "SELECT c.slug FROM listing_categories lc JOIN categories c ON c.id = lc.category_id "
            "WHERE lc.listing_id = :i"
        ),
        {"i": uuid.UUID(listing_id)},
    ).all()
    assert [slug for (slug,) in categories] == ["electrical"]  # the category swap rolled back


def test_a_failed_audit_write_rolls_back_an_archive_entirely(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = approved_provider_id(auth_env, api)
    before = (stored_snapshot(auth_env, listing_id), len(history(auth_env.session, listing_id)))
    monkeypatch.setattr(StaffAuditService, "record", explode)

    response = archive_provider(api, listing_id, 1)

    assert response.status_code == 500
    monkeypatch.undo()
    assert (
        stored_snapshot(auth_env, listing_id),
        len(history(auth_env.session, listing_id)),
    ) == before
    assert row(auth_env, listing_id).status is ListingStatus.APPROVED


def test_a_failed_create_does_not_consume_a_listing_row_for_the_retry(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = api_of(auth_env, "super_admin")
    with monkeypatch.context() as patched:
        patched.setattr(StaffAuditService, "record", explode)
        assert create_provider(api).status_code == 500

    retry = create_provider(api)

    assert retry.status_code == 201 and listing_count(auth_env) == 1


# =================================================================================================
# 12. RBAC-B: the temporary self-approval override is gone, ordinary self-moderation is not
# =================================================================================================


def test_the_author_of_a_provider_approves_it_with_no_override_and_no_audit_row(
    auth_env: AuthEnv,
) -> None:
    """A Provider has no owner, so there is nothing to override: the staff member who created it
    approves it like any other staff member would. (There is no four-eyes rule between author and
    approver for portal-managed content — recorded in AUTH_RBAC.md §31.)"""
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)

    response = approve(api, listing_id, 1)

    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "approved"
    assert audit_count(auth_env.session) == 1  # only the creation: no moderation_self_override
    assert all(
        event.action is not StaffAuditAction.MODERATION_SELF_OVERRIDE
        for event in audit_events(auth_env.session)
    )


def test_a_services_moderator_can_approve_the_provider_they_created(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "services_moderator")
    listing_id = provider_id_of(auth_env, api)

    assert approve(api, listing_id, 1).status_code == 200


def test_override_reason_is_no_longer_accepted_at_all(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)

    response = approve(api, listing_id, 1, overrideReason="A perfectly good justification.")

    assert response.status_code == 422
    assert ("overrideReason", "not_allowed") in codes(response)
    assert row(auth_env, listing_id).status is ListingStatus.PENDING
    assert "A perfectly good justification" not in response.text


@pytest.mark.parametrize("who", ["super_admin_professional", "all_scopes_moderator_professional"])
def test_ordinary_self_moderation_is_still_forbidden_for_owned_listings(
    auth_env: AuthEnv, who: str
) -> None:
    """Staff who also own a Business / Tutor / Property listing still cannot decide on it."""
    api = api_of(auth_env, who)
    owned = [created_id(api, business_body()), created_id(api, tutor_body())]

    for listing_id in owned:
        for decision in (approve(api, listing_id, 1), reject(api, listing_id, 1)):
            assert decision.status_code == 403, decision.text
            assert ("request", "self_moderation_forbidden") in codes(decision)
        assert row(auth_env, listing_id).status is ListingStatus.PENDING


def test_a_super_admin_still_moderates_other_peoples_listings(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner-m@example.org", professional=PlanCode.PREMIUM)
    listing_id = created_id(owner, business_body())
    boss = api_of(auth_env, "super_admin")

    assert approve(boss, listing_id, 1).status_code == 200


# =================================================================================================
# 13. RBAC-B / RBAC-C compatibility
# =================================================================================================


def test_scoped_moderation_sees_staff_authored_providers_by_scope(auth_env: AuthEnv) -> None:
    creator = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, creator)
    services = api_of(auth_env, "services_moderator")
    directory = api_of(auth_env, "directory_moderator")

    visible = services.get(ADMIN_LISTINGS, params={"kind": "provider"})
    hidden = directory.get(ADMIN_LISTINGS, params={"kind": "provider"})

    assert [item["id"] for item in visible.json()["data"]] == [listing_id]
    assert "submitter" not in visible.json()["data"][0]
    assert hidden.json()["data"] == [] and hidden.json()["meta"]["counts"]["pending"] == 0
    assert directory.get(f"{ADMIN_LISTINGS}/{listing_id}").status_code == 404
    assert services.get(f"{ADMIN_LISTINGS}/{listing_id}").status_code == 200


def test_a_moderator_authors_and_reads_back_only_the_public_location(auth_env: AuthEnv) -> None:
    boss = api_of(auth_env, "super_admin")
    moderator = api_of(auth_env, "services_moderator")
    body = staff_provider_body(location=approximate(address=None, landmark=None))

    by_moderator = create_provider(moderator, body)
    by_admin = create_provider(boss, body)

    assert by_moderator.status_code == by_admin.status_code == 201
    assert by_moderator.json()["data"]["location"]["latitude"] == 33.12  # the public rounding
    assert by_admin.json()["data"]["location"]["latitude"] == 33.123456  # full precision


def test_provider_authoring_never_changes_a_role_or_a_scope(auth_env: AuthEnv) -> None:
    boss, boss_user = actor(auth_env, "super_admin")
    moderator, mod_user = actor(auth_env, "services_moderator")

    def snapshot() -> tuple[Any, ...]:
        return (
            roles_of(auth_env.session, boss_user.id),
            roles_of(auth_env.session, mod_user.id),
            scopes_of(auth_env.session, mod_user.id),
            auth_env.session.scalar(
                text("SELECT count(*) FROM auth_sessions WHERE revoked_at IS NOT NULL")
            ),
        )

    before = snapshot()

    listing_id = provider_id_of(auth_env, moderator)
    patch_provider(boss, listing_id, 1, name="Edited By The Boss")
    archive_provider(moderator, listing_id, 2)
    create_provider(api_of(auth_env, "directory_moderator"))  # a refusal

    assert snapshot() == before


def test_staff_management_is_unaffected_by_provider_activity(auth_env: AuthEnv) -> None:
    boss = super_admin(auth_env)
    make_account(auth_env.session, "new-mod@example.org")
    for index in range(3):
        assert (
            create_provider(boss, staff_provider_body(name=f"Busy Provider {index}")).status_code
            == 201
        )

    appointed = appoint(boss, "new-mod@example.org", [SERVICES])

    assert appointed.status_code == 201, appointed.text
    moderator = auth_env.client()
    assert moderator.login("new-mod@example.org").status_code == 200
    assert create_provider(moderator).status_code == 201  # and the new moderator can author at once


# =================================================================================================
# 14. The provider-write rate limit is its own bucket
# =================================================================================================


def test_the_provider_write_limit_is_its_own_per_actor_bucket(
    auth_env: AuthEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.dependencies.providers.PROVIDER_WRITE", RatePolicy("provider_write", 3, 900)
    )
    boss = super_admin(auth_env)
    other = api_of(auth_env, "services_moderator")
    make_account(auth_env.session, "mod-for-limit@example.org")

    for index in range(3):
        assert (
            create_provider(boss, staff_provider_body(name=f"Within Limit {index}")).status_code
            == 201
        )
    over = create_provider(boss)

    assert over.status_code == 429 and error_code(over) == "rate_limited"
    assert int(over.headers["Retry-After"]) > 0
    assert listing_count(auth_env) == 3  # the 429 performed no write
    assert audit_count(auth_env.session) == 3
    # Another staff member's bucket is untouched, and so is staff management's.
    assert create_provider(other).status_code == 201
    assert appoint(boss, "mod-for-limit@example.org", [SERVICES]).status_code == 201


def test_exhausting_staff_management_does_not_block_provider_authoring(
    auth_env: AuthEnv,
) -> None:
    boss = super_admin(auth_env)
    from app.core.rate_limit import STAFF_MUTATION
    from app.services.rate_limit import PostgresRateLimiter

    limiter = PostgresRateLimiter(auth_env.session, auth_env.clock)
    boss_id = auth_env.session.scalar(select(User.id).where(User.email == "sa@example.org"))
    for _ in range(STAFF_MUTATION.limit + 1):
        limiter.hit(f"staff-mutation:{boss_id}", STAFF_MUTATION)

    assert appoint(boss, "nobody@example.org", [SERVICES]).status_code == 429
    assert create_provider(boss).status_code == 201


# =================================================================================================
# 15. Public reads of staff-authored providers are unchanged
# =================================================================================================


def test_public_provider_discovery_works_without_an_owner(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = approved_provider_id(auth_env, api, name="Zephyr Electricians")
    visitor = auth_env.client()

    searched = visitor.get("/search", params={"q": "zephyr"})
    detail = visitor.get(f"/listings/{listing_id}")

    assert searched.status_code == detail.status_code == 200
    assert listing_id in {hit["item"]["id"] for hit in searched.json()["data"]}
    assert detail.json()["data"]["name"] == "Zephyr Electricians"
    for response in (searched, detail):
        assert "ownerId" not in response.text and "owner_id" not in response.text


def test_an_archived_provider_leaves_public_discovery(auth_env: AuthEnv) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = approved_provider_id(auth_env, api, name="Zephyr Electricians")
    visitor = auth_env.client()
    assert archive_provider(api, listing_id, 1).status_code == 200

    assert visitor.get(f"/listings/{listing_id}").status_code == 404
    searched = visitor.get("/search", params={"q": "zephyr"})
    assert searched.status_code == 200
    assert listing_id not in {hit["item"]["id"] for hit in searched.json()["data"]}


def test_a_status_filter_on_the_staff_queue_includes_staff_authored_providers(
    auth_env: AuthEnv,
) -> None:
    api = api_of(auth_env, "super_admin")
    listing_id = provider_id_of(auth_env, api)

    pending = api.get(ADMIN_LISTINGS, params={"status": "pending", "kind": "provider"})

    assert [item["id"] for item in pending.json()["data"]] == [listing_id]
    assert pending.json()["data"][0]["title"] == "Bright Spark Electricians"
    assert reject(api, listing_id, 1).status_code == 200
    taken = api.get(ADMIN_LISTINGS, params={"status": "rejected"})
    assert [item["id"] for item in taken.json()["data"]] == [listing_id]


def test_the_listing_kind_enum_in_the_audit_is_the_wire_value() -> None:
    assert ListingKind.PROVIDER.value == "provider"
    assert StaffAuditAction.PROVIDER_CREATED.value == "provider_created"
    assert StaffAuditAction.PROVIDER_UPDATED.value == "provider_updated"
    assert StaffAuditAction.PROVIDER_ARCHIVED.value == "provider_archived"
    assert LISTINGS == "/listings"
    assert ListingStatusHistory.__tablename__ == "listing_status_history"
