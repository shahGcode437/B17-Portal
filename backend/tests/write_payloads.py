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


def business_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": "business",
        "vertical": "general",
        "name": "Capital Stationers",
        "description": DESCRIPTION,
        "area": "B-17",
        "category": DIRECTORY_SLUG,
        "tags": ["books", "copies"],
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
