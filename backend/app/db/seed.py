"""Seed the REFERENCE taxonomy: ``python -m app.db.seed``.

Safe in every environment (production included) and idempotent: it only inserts categories whose
``(module, slug)`` is missing, so running it twice adds nothing and never overwrites an admin's
edits. It does not create users, listings or any demo data — that is ``scripts/dev_fixtures.py``,
which refuses to run in production.
"""

import sys

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.reference_data import REFERENCE_CATEGORIES
from app.db.session import create_db_engine, transaction
from app.repositories.taxonomy import CategoryRepository


def seed_reference_data(session: Session) -> int:
    """Insert missing reference categories in one transaction; return how many were added."""
    with transaction(session):
        return CategoryRepository(session).insert_missing(REFERENCE_CATEGORIES)


def main() -> int:
    settings = get_settings()
    if settings.database_url is None:
        print("DATABASE_URL is not set; nothing to seed.", file=sys.stderr)
        return 1
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session:
            inserted = seed_reference_data(session)
    finally:
        engine.dispose()
    print(
        f"Reference taxonomy: {inserted} category(ies) inserted, "
        f"{len(REFERENCE_CATEGORIES) - inserted} already present."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
