"""Authentication data sweep: ``python -m app.cli.auth_maintenance purge``.

A safety net for rows that remain after login's own opportunistic cleanup. Deletes sessions and
one-time tokens expired/revoked/consumed more than 7 days ago, rate-limit windows
older than 2 days, and audit events older than 400 days. Safe to run any time and as often as
wanted; the application never depends on it (docs/backend/AUTH_RBAC.md §13.5). Schedule it from the
host (cron / scheduled task) — the application has no scheduler.
"""

import argparse
import sys
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.db.session import create_db_engine
from app.services.auth_maintenance import AuthMaintenanceService


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli.auth_maintenance", description=__doc__)
    parser.add_argument("command", choices=["purge"])
    parser.parse_args(argv)
    settings = get_settings()
    if settings.database_url is None:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 1
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session:
            counts = AuthMaintenanceService(session, utcnow).purge()
    finally:
        engine.dispose()
    print(
        f"Purged {counts.sessions} session(s), {counts.tokens} token(s), "
        f"{counts.rate_limits} rate-limit window(s), {counts.events} audit event(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
