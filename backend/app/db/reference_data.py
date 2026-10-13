"""Reference taxonomy: the categories the current frontend depends on (DATA_MODEL.md §12).

This is **reference data** — needed by every environment, production included — and is kept apart
from development/test *fixtures* (``scripts/dev_fixtures.py``), which are fake listings and users.

Every value is taken from the real frontend source it names; nothing is invented. Slugs are the
frontend's own where it has them, so existing URLs and filters stay valid. Where the frontend only
has display strings (Directory categories, Education subjects, News categories, Property types)
the slug is the lower-cased, hyphenated label. ``display_order`` is the order the frontend shows.

If one of those frontend sources gains a category, add it here too: the seed is insert-only, so it
adds the new row to every database without touching rows an admin has since edited.
"""

from dataclasses import dataclass

from app.models.enums import CategoryModule


@dataclass(frozen=True)
class CategorySeed:
    module: CategoryModule
    slug: str
    name: str
    display_order: int


def _seeds(module: CategoryModule, rows: list[tuple[str, str]]) -> list[CategorySeed]:
    return [
        CategorySeed(module, slug, name, order) for order, (slug, name) in enumerate(rows, start=1)
    ]


# src/data/serviceCategories.ts
SERVICES = _seeds(
    CategoryModule.SERVICES,
    [
        ("construction", "Construction"),
        ("electrical", "Electrical"),
        ("solar", "Solar"),
        ("architecture", "Architecture"),
        ("painting", "Painting"),
        ("plumbing", "Plumbing"),
        ("interior-design", "Interior Design"),
        ("renovation", "Renovation"),
        ("finishing", "Finishing"),
        ("aluminium", "Aluminium"),
        ("hardware", "Hardware"),
    ],
)

# src/config/food.ts (FOOD_CATEGORIES)
FOOD = _seeds(
    CategoryModule.FOOD,
    [
        ("restaurants", "Restaurants"),
        ("fast-food", "Fast Food"),
        ("biryani-rice", "Biryani / Rice"),
        ("bbq", "BBQ"),
        ("pizza-burgers", "Pizza / Burgers"),
        ("cafes", "Cafes"),
        ("juice-shakes", "Juice / Shakes"),
        ("bakeries", "Bakeries"),
        ("sweets-desserts", "Sweets / Desserts"),
        ("desi-food", "Desi Food"),
        ("tea-snacks", "Tea / Snacks"),
    ],
)

# src/data/businesses.ts — the non-Food business categories present in the seed directory.
DIRECTORY = _seeds(
    CategoryModule.DIRECTORY,
    [
        ("pharmacy", "Pharmacy"),
        ("hairdressing", "Hairdressing"),
        ("tailoring", "Tailoring"),
        ("grocery", "Grocery"),
        ("automotive", "Automotive"),
        ("fitness", "Fitness"),
    ],
)

# src/features/provider/PropertyListingForm.tsx (the type <select>) and src/data/properties.ts.
PROPERTY = _seeds(
    CategoryModule.PROPERTY,
    [("house", "House"), ("flat", "Flat"), ("plot", "Plot")],
)

# src/data/tutors.ts — the subjects present in the seed.
EDUCATION = _seeds(
    CategoryModule.EDUCATION,
    [
        ("physics", "Physics"),
        ("mathematics", "Mathematics"),
        ("english", "English"),
        ("chemistry", "Chemistry"),
    ],
)

# src/data/news.ts — the categories present in the seed news.
NEWS = _seeds(
    CategoryModule.NEWS,
    [
        ("community", "Community"),
        ("utilities", "Utilities"),
        ("infrastructure", "Infrastructure"),
        ("local-business", "Local Business"),
    ],
)

REFERENCE_CATEGORIES: list[CategorySeed] = [
    *SERVICES,
    *DIRECTORY,
    *FOOD,
    *EDUCATION,
    *PROPERTY,
    *NEWS,
]
