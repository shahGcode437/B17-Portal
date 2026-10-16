"""Grant or revoke the Admin role: ``python -m app.cli.admin grant|revoke EMAIL``.

The only way to create an Admin (docs/backend/AUTH_RBAC.md §11.6): there is no public endpoint and
no client-supplied role anywhere. ``grant`` requires an existing, active, **verified** account; both
commands revoke all of the user's sessions and write an audit event.

First-admin runbook: register normally, verify the email, then run this against the target
database (``DATABASE_URL`` in the environment).
"""

import argparse
import sys
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.security.identity import canonical_email
from app.db.session import create_db_engine
from app.services.admin_roles import AdminRoleError, AdminRoleService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli.admin", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, text in (("grant", "grant the Admin role"), ("revoke", "revoke the Admin role")):
        command = commands.add_parser(name, help=text)
        command.add_argument("email", help="the account's email address")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    if settings.database_url is None:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 1
    email = canonical_email(args.email)
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session:
            service = AdminRoleService(session, utcnow)
            try:
                change = (
                    service.grant_admin(email)
                    if args.command == "grant"
                    else service.revoke_admin(email)
                )
            except AdminRoleError as error:
                print(f"Refused: {error}", file=sys.stderr)
                return 1
    finally:
        engine.dispose()
    if change.changed:
        print(
            f"Admin role {args.command}ed for {email}; "
            f"{change.sessions_revoked} session(s) revoked."
        )
    else:
        print(
            f"No change: {email} already {'is' if args.command == 'grant' else 'is not'} an admin."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
