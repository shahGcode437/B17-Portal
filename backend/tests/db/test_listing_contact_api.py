"""Listing CONTACT numbers end to end against real PostgreSQL (Listing Contact v1).

A listing carries the number CUSTOMERS should use for IT: ``contactPhone`` (required for a new
owner-created Business / Tutor / Property) and an optional ``whatsappPhone``. Both are public by
design, both belong to the LISTING, and neither is ever derived from the person who owns it — the
schema has no account phone number at all, which these tests also pin.

What is proven here: the create / edit contract, normalisation to E.164, the PATCH semantics
(omitted vs ``null``), that only the owner can change them, the public and owner serialisations,
compatibility with rows created before the field, the moderation lifecycle, and that a
portal-managed Provider (RBAC-D) gains nothing.
"""

from typing import Any

import pytest
from sqlalchemy import select, text

from app.models import Listing
from app.models.enums import ListingStatus
from tests.db.admin_helpers import admin_signed_in, approve, detail, reject
from tests.db.auth_helpers import AuthApi, AuthEnv
from tests.db.write_helpers import (
    CONTACT_PHONE,
    CONTACT_PHONE_E164,
    MINE,
    WHATSAPP_PHONE,
    WHATSAPP_PHONE_E164,
    archive,
    business_body,
    codes,
    create,
    create_provider,
    created_id,
    error_code,
    food_body,
    history,
    mine,
    patch,
    property_body,
    provider_body,
    set_status,
    signed_in,
    staff_provider_body,
    stored,
    stored_columns,
    tutor_body,
)

#: The three kinds an OWNER creates and must give customers a number for (Food is a Business).
OWNED_BODIES: list[tuple[str, Any]] = [
    ("business", business_body),
    ("food", food_body),
    ("tutor", tutor_body),
    ("property", property_body),
]


def public(env: AuthEnv, listing_id: str) -> dict[str, Any]:
    response = env.client().get(f"/listings/{listing_id}")
    assert response.status_code == 200, response.text
    return dict(response.json()["data"])


def approved_listing(env: AuthEnv, api: AuthApi, body: dict[str, Any]) -> str:
    listing_id = created_id(api, body)
    set_status(env.session, listing_id, ListingStatus.APPROVED)
    return listing_id


# =================================================================================================
# 1. Create
# =================================================================================================


@pytest.mark.parametrize(("label", "builder"), OWNED_BODIES)
def test_a_new_owner_listing_stores_the_contact_number_it_was_given(
    auth_env: AuthEnv, label: str, builder: Any
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, builder())

    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] == CONTACT_PHONE_E164, label
    # Only the Food fixture carries a WhatsApp number; the others leave it unset rather than copying.
    expected_whatsapp = WHATSAPP_PHONE_E164 if label == "food" else None
    assert columns["whatsapp_phone"] == expected_whatsapp, label


@pytest.mark.parametrize(("label", "builder"), OWNED_BODIES)
def test_a_new_owner_listing_without_a_contact_number_is_refused(
    auth_env: AuthEnv, label: str, builder: Any
) -> None:
    api = signed_in(auth_env)
    body = builder()
    del body["contactPhone"]

    response = create(api, body)

    assert response.status_code == 422, label
    assert ("contactPhone", "required") in codes(response), label
    assert auth_env.session.scalar(select(Listing)) is None  # nothing was written


def test_the_whatsapp_number_is_optional_and_is_not_copied_from_the_contact_number(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())  # no whatsappPhone in the body

    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] == CONTACT_PHONE_E164
    assert columns["whatsapp_phone"] is None  # absent means absent: nothing is inferred
    assert "whatsappPhone" not in mine(api, listing_id)


@pytest.mark.parametrize(
    ("typed", "stored_value"),
    [
        ("03001234567", "+923001234567"),
        ("0300 123 4567", "+923001234567"),
        ("+92 300 1234567", "+923001234567"),
        ("923001234567", "+923001234567"),
        ("0092 3001234567", "+923001234567"),
        ("051 1234567", "+92511234567"),
    ],
)
def test_the_number_is_normalised_to_one_canonical_form(
    auth_env: AuthEnv, typed: str, stored_value: str
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body(contactPhone=typed, whatsappPhone=typed))

    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] == stored_value
    assert columns["whatsapp_phone"] == stored_value
    # ... and that is what every reader gets back, whatever was typed.
    assert mine(api, listing_id)["contactPhone"] == stored_value


@pytest.mark.parametrize("bad", ["0300123", "abc", "0300 1234 567x", "+0300123456", "12345", ""])
def test_a_number_that_cannot_be_read_is_refused_and_never_guessed_at(
    auth_env: AuthEnv, bad: str
) -> None:
    api = signed_in(auth_env)

    contact = create(api, business_body(contactPhone=bad))
    whatsapp = create(api, business_body(whatsappPhone=bad))

    assert contact.status_code == 422 and whatsapp.status_code == 422
    # An empty string is a length problem; anything else is the phone rule itself.
    expected = "string_too_short" if bad == "" else "invalid_phone"
    assert ("contactPhone", expected) in codes(contact), bad
    assert ("whatsappPhone", expected) in codes(whatsapp), bad
    assert auth_env.session.scalar(select(Listing)) is None


def test_a_number_longer_than_the_field_allows_is_refused_as_a_length_problem(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    response = create(api, business_body(contactPhone="0" * 25))
    assert ("contactPhone", "string_too_long") in codes(response)


# =================================================================================================
# 2. Edit: omitted vs null, and what a change means
# =================================================================================================


def test_an_edit_can_change_both_numbers(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())

    response = patch(api, listing_id, 1, contactPhone="0321 7654321", whatsappPhone="0345 1112222")

    assert response.status_code == 200, response.text
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] == "+923217654321"
    assert columns["whatsapp_phone"] == "+923451112222"


def test_an_omitted_number_is_left_alone(auth_env: AuthEnv) -> None:
    """Omitted = unchanged (API_CONTRACT §10.3): an edit of the description keeps the numbers."""
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())

    response = patch(api, listing_id, 1, description="A new description, long enough to count.")

    assert response.status_code == 200, response.text
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] == CONTACT_PHONE_E164
    assert columns["whatsapp_phone"] == WHATSAPP_PHONE_E164


def test_the_whatsapp_number_can_be_cleared_with_null_but_the_contact_number_cannot(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())

    cleared = patch(api, listing_id, 1, whatsappPhone=None)
    refused = patch(api, listing_id, 2, contactPhone=None)

    assert cleared.status_code == 200, cleared.text
    assert stored_columns(auth_env.session, listing_id)["whatsapp_phone"] is None
    assert refused.status_code == 422
    assert ("contactPhone", "not_nullable") in codes(refused)
    # The refusal changed nothing: the contact number is still there.
    assert stored_columns(auth_env.session, listing_id)["contact_phone"] == CONTACT_PHONE_E164


def test_resending_the_stored_number_is_a_no_op_not_a_content_change(auth_env: AuthEnv) -> None:
    """The edit form sends the whole form, so an untouched field must not look like an edit."""
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, business_body())
    before = stored_columns(auth_env.session, listing_id)

    response = patch(api, listing_id, before["revision"], contactPhone=CONTACT_PHONE_E164)

    assert response.status_code == 200, response.text
    after = stored_columns(auth_env.session, listing_id)
    assert after["status"] == "approved" and after["revision"] == before["revision"]


def test_changing_a_number_is_a_material_edit_that_returns_the_listing_to_moderation(
    auth_env: AuthEnv,
) -> None:
    """A contact number is public content, so changing it follows the SAME moderation rule as any
    other content change (API_CONTRACT §10.3) — no special case was introduced for it."""
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, business_body())

    response = patch(api, listing_id, 1, contactPhone="0321 7654321")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["status"] == "pending" and data["revision"] == 2
    assert [entry.action for entry in history(auth_env.session, listing_id)][-1] == "resubmitted"


def test_adding_only_a_whatsapp_number_is_also_a_content_change(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, business_body())

    response = patch(api, listing_id, 1, whatsappPhone=WHATSAPP_PHONE)

    assert response.json()["data"]["status"] == "pending"
    assert stored_columns(auth_env.session, listing_id)["whatsapp_phone"] == WHATSAPP_PHONE_E164


def test_an_invalid_number_in_an_edit_changes_nothing(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())
    before = stored_columns(auth_env.session, listing_id)

    response = patch(api, listing_id, 1, contactPhone="0300123")

    assert response.status_code == 422
    assert ("contactPhone", "invalid_phone") in codes(response)
    assert stored_columns(auth_env.session, listing_id) == before


# =================================================================================================
# 3. Ownership: nobody edits somebody elses contact number
# =================================================================================================


def test_another_professional_cannot_change_a_listings_contact_number(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env, "owner@example.org")
    listing_id = created_id(owner, business_body())
    stranger = signed_in(auth_env, "stranger@example.org")

    response = patch(stranger, listing_id, 1, contactPhone="0333 0000000")

    # The owner API is owner-scoped: another owners id is indistinguishable from a missing one.
    assert response.status_code == 404
    assert error_code(response) == "not_found"
    assert stored_columns(auth_env.session, listing_id)["contact_phone"] == CONTACT_PHONE_E164


def test_an_anonymous_caller_cannot_change_a_contact_number(auth_env: AuthEnv) -> None:
    owner = signed_in(auth_env)
    listing_id = created_id(owner, business_body())

    response = auth_env.client().request(
        "PATCH", f"/listings/{listing_id}", json={"revision": 1, "contactPhone": "0333 0000000"}
    )

    assert response.status_code == 401
    assert stored_columns(auth_env.session, listing_id)["contact_phone"] == CONTACT_PHONE_E164


def test_a_moderator_gains_no_way_to_write_a_contact_number(auth_env: AuthEnv) -> None:
    """RBAC-B / RBAC-C are unchanged: moderation decides status, never content."""
    owner = signed_in(auth_env, "owner@example.org")
    listing_id = created_id(owner, business_body())
    # A Super Admin who also has a professional profile, so the owner API gets as far as the
    # ownership check instead of stopping at the profile gate.
    staff = signed_in(auth_env, "staff@example.org", admin=True)

    # The moderation routes take a revision (and a reason) and nothing else.
    forged = staff.request(
        "POST",
        f"/admin/listings/{listing_id}/approve",
        json={"revision": 1, "contactPhone": "0333 0000000"},
    )
    # ... and the owner PATCH route is owner-scoped: somebody elses listing is simply not found.
    through_owner_api = patch(staff, listing_id, 1, contactPhone="0333 0000000")

    assert forged.status_code == 422
    assert ("contactPhone", "not_allowed") in codes(forged)
    assert through_owner_api.status_code == 404
    assert stored_columns(auth_env.session, listing_id)["contact_phone"] == CONTACT_PHONE_E164


# =================================================================================================
# 4. What each reader sees
# =================================================================================================


@pytest.mark.parametrize(("label", "builder"), OWNED_BODIES)
def test_the_public_detail_carries_the_listings_numbers(
    auth_env: AuthEnv, label: str, builder: Any
) -> None:
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, builder())

    data = public(auth_env, listing_id)

    assert data["contactPhone"] == CONTACT_PHONE_E164, label
    if label == "food":
        assert data["whatsappPhone"] == WHATSAPP_PHONE_E164
    else:
        assert "whatsappPhone" not in data, label


def test_the_owner_and_the_moderator_see_the_same_numbers(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = created_id(api, food_body())
    admin = admin_signed_in(auth_env)

    owner_view = mine(api, listing_id)
    review = detail(admin, listing_id)

    for view in (owner_view, review):
        assert view["contactPhone"] == CONTACT_PHONE_E164
        assert view["whatsappPhone"] == WHATSAPP_PHONE_E164


def test_a_pending_listings_numbers_are_not_public_yet(auth_env: AuthEnv) -> None:
    """The contact number is as public as the listing is — and a pending listing is not public."""
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())

    response = auth_env.client().get(f"/listings/{listing_id}")

    assert response.status_code == 404
    assert CONTACT_PHONE_E164 not in response.text


def test_the_contact_number_is_not_searchable(auth_env: AuthEnv) -> None:
    """A phone number is not a search key: it stays out of the search document (which is why this
    phase needed no reindex)."""
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, business_body())

    document = auth_env.session.execute(
        text("SELECT search_document FROM listings WHERE id = :i"), {"i": listing_id}
    ).scalar_one()
    assert CONTACT_PHONE_E164 not in str(document)
    assert "3001234567" not in str(document)
    assert auth_env.client().get("/search?q=3001234567").json()["data"] == []


@pytest.mark.parametrize(("label", "builder"), OWNED_BODIES)
def test_public_search_results_omit_contact_numbers(
    auth_env: AuthEnv, label: str, builder: Any
) -> None:
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, builder())

    client = auth_env.client()
    search_type = "business" if label == "food" else label
    results = client.get(f"/search?type={search_type}").json()["data"]
    hits = [h for h in results if str(h["item"]["id"]) == listing_id]
    assert len(hits) == 1, f"Expected {listing_id} in search results"
    item = hits[0]["item"]

    # Search cards MUST NOT expose contactPhone or whatsappPhone
    assert "contactPhone" not in item
    assert "whatsappPhone" not in item


@pytest.mark.parametrize(("label", "builder"), OWNED_BODIES)
def test_saved_collection_responses_omit_contact_numbers(
    auth_env: AuthEnv, label: str, builder: Any
) -> None:
    api = signed_in(auth_env)
    listing_id = approved_listing(auth_env, api, builder())

    # A signed-in resident saves the approved listing
    save_res = api.request("PUT", f"/saved/{listing_id}")
    assert save_res.status_code == 204

    # GET /saved returns the saved listing as a public card
    saved_hits = api.get("/saved").json()["data"]
    matched = [h for h in saved_hits if str(h["item"]["id"]) == listing_id]
    assert len(matched) == 1, f"Expected {listing_id} in saved hits"
    saved_item = matched[0]["item"]

    # Saved cards MUST NOT expose contactPhone or whatsappPhone
    assert "contactPhone" not in saved_item
    assert "whatsappPhone" not in saved_item


def test_public_search_suggestions_omit_contact_numbers(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    approved_listing(auth_env, api, business_body(name="Unique Salon Name"))

    suggestions = auth_env.client().get("/search/suggestions?q=Unique").json()["data"]
    assert len(suggestions) > 0
    for s in suggestions:
        assert "contactPhone" not in s
        assert "whatsappPhone" not in s


# =================================================================================================
# 5. Privacy: a listings number is listing data, never an accounts
# =================================================================================================


def test_no_account_phone_number_exists_to_leak_into_a_listing(auth_env: AuthEnv) -> None:
    """The guarantee is structural: neither ``users`` nor ``professional_profiles`` has a phone
    column, so there is nothing for a listing to copy and no account number to expose."""
    for table in ("users", "professional_profiles"):
        names = set(
            auth_env.session.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
                {"t": table},
            ).scalars()
        )
        assert not [name for name in names if "phone" in name or "mobile" in name], table

    # The only phone columns in the whole database are the listings own.
    phone_columns = set(
        auth_env.session.execute(
            text(
                "SELECT table_name || '.' || column_name FROM information_schema.columns "
                "WHERE column_name LIKE '%phone%'"
            )
        ).scalars()
    )
    assert phone_columns == {"listings.contact_phone", "listings.whatsapp_phone"}


def test_the_account_endpoints_return_no_phone_number(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    created_id(api, business_body())

    me = api.get("/auth/me")
    profile = api.request("PUT", "/users/me/professional-profile", json={})

    for response in (me, profile):
        assert response.status_code in (200, 201), response.text
        assert "phone" not in response.text.lower()
        assert CONTACT_PHONE_E164 not in response.text


# =================================================================================================
# 6. Listings created before the field (the migrations legacy state)
# =================================================================================================


def legacy_without_contact(env: AuthEnv, api: AuthApi, body: dict[str, Any]) -> str:
    """A row exactly as migration ``0009`` leaves one it did not touch: both columns NULL."""
    listing_id = created_id(api, body)
    env.session.execute(
        text("UPDATE listings SET contact_phone = NULL, whatsapp_phone = NULL WHERE id = :i"),
        {"i": listing_id},
    )
    env.session.commit()
    return listing_id


def test_a_listing_from_before_the_field_is_still_readable_and_public(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    listing_id = legacy_without_contact(auth_env, api, business_body())
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)

    data = public(auth_env, listing_id)

    assert data["id"] == listing_id
    assert "contactPhone" not in data and "whatsappPhone" not in data
    assert "contactPhone" not in mine(api, listing_id)


def test_a_listing_from_before_the_field_can_still_be_moderated_and_archived(
    auth_env: AuthEnv,
) -> None:
    """Moderation never validates content completeness, so no legacy row is ever stuck."""
    owner = signed_in(auth_env, "owner@example.org")
    first = legacy_without_contact(auth_env, owner, business_body())
    second = legacy_without_contact(auth_env, owner, tutor_body(name="Legacy Tutor"))
    third = legacy_without_contact(auth_env, owner, property_body(title="Legacy Plot"))
    admin = admin_signed_in(auth_env)

    assert approve(admin, first, 1).status_code == 200
    assert reject(admin, second, 1, reason="Please add more detail here.").status_code == 200
    assert archive(owner, third, 1).status_code == 200


def test_editing_a_listing_from_before_the_field_asks_for_the_number_first(
    auth_env: AuthEnv,
) -> None:
    """The documented rule (``DATA_MODEL.md §19``, the same one ``LOCATION_MAP.md §3.1`` set for a
    legacy Property map pin): an owner edit validates the RESULTING listing, so the first edit
    supplies the number. Nothing is invented, and nothing is written until it is there."""
    api = signed_in(auth_env)
    listing_id = legacy_without_contact(auth_env, api, business_body())

    refused = patch(api, listing_id, 1, name="Renamed Shop")

    assert refused.status_code == 422
    assert ("contactPhone", "required") in codes(refused)
    auth_env.session.expire_all()
    assert stored(auth_env.session, listing_id).title != "Renamed Shop"  # nothing was written

    accepted = patch(api, listing_id, 1, name="Renamed Shop", contactPhone=CONTACT_PHONE)

    assert accepted.status_code == 200, accepted.text
    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] == CONTACT_PHONE_E164
    assert columns["title"] == "Renamed Shop"


def test_a_no_op_patch_of_a_listing_from_before_the_field_is_not_refused(
    auth_env: AuthEnv,
) -> None:
    """Nothing is written, so there is nothing to validate — the same exception a legacy Property
    location has."""
    api = signed_in(auth_env)
    listing_id = legacy_without_contact(auth_env, api, business_body())

    assert patch(api, listing_id, 1).status_code == 200


# =================================================================================================
# 7. A portal-managed Provider gains nothing (RBAC-D is unchanged)
# =================================================================================================


def test_the_owner_api_still_refuses_a_provider_whatever_the_contact_number_says(
    auth_env: AuthEnv,
) -> None:
    api = signed_in(auth_env, admin=True)

    plain = create(api, provider_body())
    with_contact = create(api, provider_body(contactPhone=CONTACT_PHONE))

    # RBAC-D is untouched: the owner API refuses a Provider for everyone...
    assert plain.status_code == 403
    assert ("kind", "provider_admin_only") in codes(plain)
    # ... and a Provider has no contact field at all, so sending one is an undeclared key.
    assert with_contact.status_code == 422
    assert ("contactPhone", "not_allowed") in codes(with_contact)


def test_the_staff_provider_api_does_not_accept_a_contact_number(auth_env: AuthEnv) -> None:
    """A Provider is portal-managed: this phase gives the portal no contact field, so the number is
    an undeclared key — refused, not silently ignored."""
    admin = admin_signed_in(auth_env)

    refused = create_provider(admin, staff_provider_body(contactPhone=CONTACT_PHONE))
    whatsapp = create_provider(admin, staff_provider_body(whatsappPhone=WHATSAPP_PHONE))

    assert refused.status_code == 422
    assert ("contactPhone", "not_allowed") in codes(refused)
    assert whatsapp.status_code == 422
    assert ("whatsappPhone", "not_allowed") in codes(whatsapp)


def test_a_provider_is_created_and_read_with_no_contact_number_at_all(auth_env: AuthEnv) -> None:
    admin = admin_signed_in(auth_env)
    response = create_provider(admin)
    assert response.status_code == 201, response.text
    listing_id = str(response.json()["data"]["id"])

    columns = stored_columns(auth_env.session, listing_id)
    assert columns["contact_phone"] is None and columns["whatsapp_phone"] is None
    set_status(auth_env.session, listing_id, ListingStatus.APPROVED)
    data = public(auth_env, listing_id)
    assert data["kind"] == "provider"
    assert "contactPhone" not in data and "whatsappPhone" not in data
    # ... and the staff review shape has no such field either.
    assert "contactPhone" not in detail(admin, listing_id)


# =================================================================================================
# 8. The database is the backstop
# =================================================================================================


def test_the_database_refuses_a_number_that_is_not_canonical(auth_env: AuthEnv) -> None:
    """Defence in depth: the column only ever holds canonical E.164, whatever a future path does."""
    api = signed_in(auth_env)
    listing_id = created_id(api, business_body())

    with pytest.raises(Exception, match="ck_listings_contact_phone_e164"):
        auth_env.session.execute(
            text("UPDATE listings SET contact_phone = '0300 123 4567' WHERE id = :i"),
            {"i": listing_id},
        )
        auth_env.session.flush()
    auth_env.session.rollback()


def test_the_owner_listing_list_shows_the_numbers_for_every_kind(auth_env: AuthEnv) -> None:
    api = signed_in(auth_env)
    created_id(api, business_body())
    created_id(api, tutor_body(name="Second Listing"))

    rows = api.get(MINE).json()["data"]

    assert len(rows) == 2
    assert all(row["contactPhone"] == CONTACT_PHONE_E164 for row in rows)
