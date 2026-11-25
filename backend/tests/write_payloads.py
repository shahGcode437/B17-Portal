"""Request-body builders for the listing-write tests (DB-free: shared by unit and API tests).

Each builder returns the camelCase JSON a client would send; tests tweak a builder's dict instead
of re-typing whole bodies, so each test shows only what it is about.
"""

import copy
from typing import Any

LISTINGS = "/listings"
MINE = "/users/me/listings"
PROFILE = "/users/me/professional-profile"

#: Seeded reference slugs (app/db/reference_data.py).
SERVICES_SLUG = "electrical"
DIRECTORY_SLUG = "grocery"
EDUCATION_SLUG = "physics"
PROPERTY_SLUG = "house"
FOOD_SLUGS = ("bakeries", "cafes", "desi-food")

DESCRIPTION = "A clean, friendly place that has served the neighbourhood for years."

#: Listing CONTACT numbers (Listing Contact v1). A new owner-created Business / Tutor / Property must carry
#: one, so every builder below has it; ``provider_body`` does NOT (a Provider is portal-managed and
#: its API has no contact field). The numbers are fictional and are written in the national form a
#: person would type, so the builders also prove the API normalises them to E.164.
CONTACT_PHONE = "0300 1234567"
CONTACT_PHONE_E164 = "+923001234567"
WHATSAPP_PHONE = "0321 7654321"
WHATSAPP_PHONE_E164 = "+923217654321"


def exact(**overrides: Any) -> dict[str, Any]:
    location: dict[str, Any] = {
        "visibility": "exact",
        "block": "B",
        "address": "Shop 4, Main Market",
        "landmark": "Opposite the mosque",
        "latitude": 33.123456,
        "longitude": 72.123456,
    }
    location.update(overrides)
    return location


def approximate(**overrides: Any) -> dict[str, Any]:
    return exact(visibility="approximate", **overrides)


def area_only(**overrides: Any) -> dict[str, Any]:
    location: dict[str, Any] = {"visibility": "area_only", "block": "B"}
    location.update(overrides)
    return location


def provider_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "provider",
        "name": "Bright Spark Electricians",
        "description": DESCRIPTION,
        "area": "B-17",
        "category": SERVICES_SLUG,
        "tags": ["wiring", "repairs"],
    }
    body.update(overrides)
    return body


def staff_provider_body(**overrides: Any) -> dict[str, Any]:
    """The body of the STAFF Provider API (``POST /admin/providers``): the same content as
    ``provider_body`` but WITHOUT ``kind`` — the route fixes the kind, so ``kind`` is not a field.
    Overrides are applied last, so a test can add a forged key on purpose."""
    body = provider_body()
    del body["kind"]
    body.update(overrides)
    return body


def business_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "business",
        "vertical": "general",
        "name": "Capital Stationers",
        "description": DESCRIPTION,
        "area": "B-17",
        "category": DIRECTORY_SLUG,
        "tags": ["books", "copies"],
        "contactPhone": CONTACT_PHONE,
        "location": exact(),
    }
    body.update(overrides)
    return body


def food_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "business",
        "vertical": "food",
        "name": "Sweet Crumbs Bakery",
        "description": "Fresh cakes and bread baked every morning in B-17.",
        "area": "B-17",
        "tags": ["cakes", "bread"],
        "contactPhone": CONTACT_PHONE,
        "whatsappPhone": WHATSAPP_PHONE,
        "location": exact(),
        "food": {
            "categories": ["bakeries", "cafes"],
            "serviceOptions": ["takeaway", "delivery"],
            "hoursNote": "Daily, 8 AM-10 PM",
            "menuHighlights": [
                {"name": "Fudge Cake", "section": "Cakes", "price": "PKR 1,800"},
                {"name": "Sourdough"},
            ],
        },
    }
    body.update(overrides)
    return body


def tutor_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "tutor",
        "name": "Maryam Physics Tutor",
        "description": "Physics lessons for matric and A-levels, at home or online.",
        "area": "B-17",
        "category": EDUCATION_SLUG,
        "grade": "Matric / A-Levels",
        "tags": ["physics"],
        "contactPhone": CONTACT_PHONE,
    }
    body.update(overrides)
    return body


def property_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "property",
        "title": "Corner house, 5 marla",
        "description": "A bright corner house close to the market and the park.",
        "area": "B-17",
        "listingType": "sale",
        "propertyType": PROPERTY_SLUG,
        "price": "PKR 2.2 Cr",
        "contactPhone": CONTACT_PHONE,
        "bedrooms": 3,
        "furnished": "Unfurnished",
        "location": exact(),
    }
    body.update(overrides)
    return body


ALL_BODIES = {
    "provider": provider_body,
    "business": business_body,
    "food": food_body,
    "tutor": tutor_body,
    "property": property_body,
}


def clone(body: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(body)
