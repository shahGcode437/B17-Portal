"""Search-index maintenance: ``python -m app.db.search_index rebuild | check``.

``rebuild`` recomputes every listing's ``search_document`` (run it once after migration 0002, and
any time you suspect drift). ``check`` exits non-zero if any stored document is stale.
"""

import sys

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import create_db_engine, transaction
from app.services.search_index import SearchIndexer


def main(argv: list[str]) -> int:
    command = argv[0] if argv else ""
    if command not in {"rebuild", "check"}:
        print("usage: python -m app.db.search_index rebuild|check", file=sys.stderr)
        return 2
    settings = get_settings()
    if settings.database_url is None:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 1
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session:
            indexer = SearchIndexer(session)
            if command == "rebuild":
                with transaction(session):
                    count = indexer.rebuild_all()
                print(f"Search index: {count} listing document(s) rebuilt.")
                return 0
            stale = indexer.find_stale()
            if stale:
                print(f"Search index: {len(stale)} stale document(s): {[str(i) for i in stale]}")
                return 1
            print("Search index: all documents are current.")
            return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
