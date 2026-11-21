"""Operator staff CLI: ``python -m app.cli.staff <command>`` (RBAC-C; AUTH_RBAC.md §27.6, §30).

Super Admin promotion and demotion are CLI-only — there is no web route for either — and this is the
only door. Every command delegates to ``StaffAuthorityService``, the same service the web
staff-management routes use, so the last-usable-Super-Admin guard, the session revocation and the
durable audit (``source = cli``, no actor) are identical. Nothing here writes ``user_roles``.

::

    promote-super-admin EMAIL --reason "..." [--override-policy] [--break-glass]
    demote-super-admin  EMAIL --reason "..."
    roster [--limit N]
    audit  [--limit N] [--action ACTION]

``--reason`` is mandatory (10-500 characters) for promotion and demotion and is stored in the audit.

Policy (``AUTH_RBAC.md §27.6``): the normal target is 2 usable Super Admins. A promotion that would
make a third needs ``--override-policy``; one beyond the safety ceiling (``SUPER_ADMIN_SAFETY_
CEILING``, default 3) needs ``--break-glass``. No flag ever lets a demotion remove the LAST usable
Super Admin, and no limit ever blocks recovery from zero. The target must be an active, verified
account that can sign in; in staging / production a fixture, demo or reserved-domain address is
refused.

First-Super-Admin runbook: register normally, verify the email, then run ``promote-super-admin``
against the target database (``DATABASE_URL`` in the environment).
"""

import argparse
import sys
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.db.session import create_db_engine
from app.models.enums import StaffAuditAction
from app.schemas.staff import StaffAuditQuery
from app.services.staff_authority import StaffAuthorityService, StaffPolicy
from app.services.staff_reads import StaffReadService
from app.services.staff_rules import StaffAuthorityError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli.staff", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    promote = commands.add_parser("promote-super-admin", help="grant the Super Admin (admin) role")
    promote.add_argument("email", help="the account's email address")
    promote.add_argument("--reason", required=True, help="why (10-500 characters; audited)")
    promote.add_argument(
        "--override-policy",
        action="store_true",
        help="allow a third usable Super Admin (the normal target is 2)",
    )
    promote.add_argument(
        "--break-glass",
        action="store_true",
        help="allow a promotion above the safety ceiling, or mark a recovery from zero",
    )

    demote = commands.add_parser("demote-super-admin", help="remove the Super Admin (admin) role")
    demote.add_argument("email", help="the account's email address")
    demote.add_argument("--reason", required=True, help="why (10-500 characters; audited)")

    roster = commands.add_parser("roster", help="list the staff")
    roster.add_argument("--limit", type=int, default=50)

    audit = commands.add_parser("audit", help="show the durable staff audit, newest first")
    audit.add_argument("--limit", type=int, default=25)
    audit.add_argument("--action", choices=[a.value for a in StaffAuditAction])
    return parser


def _roster(session: Session, limit: int) -> None:
    members, total = StaffReadService(session).roster(max(1, min(limit, 100)), 0)
    for member in members:
        scopes = ",".join(s.value for s in member.scopes) or ("PAUSED" if member.paused else "-")
        print(f"{member.role.value:<10} {member.email}  [{member.account_status.value}]  {scopes}")
    print(f"{len(members)} of {total} staff member(s).")


def _audit(session: Session, limit: int, action: str | None) -> None:
    query = StaffAuditQuery(limit=max(1, min(limit, 100)), action=action)
    entries, total = StaffReadService(session).audit(query)
    for entry in entries:
        print(
            f"{entry.occurred_at.isoformat()}  {entry.source.value:<3}  {entry.action.value:<22} "
            f"target={entry.target.user_id if entry.target else '-'}  reason={entry.reason or '-'}"
        )
    print(f"{len(entries)} of {total} event(s).")


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    if settings.database_url is None:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 1
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session:
            if args.command == "roster":
                _roster(session, args.limit)
                return 0
            if args.command == "audit":
                _audit(session, args.limit, args.action)
                return 0
            service = StaffAuthorityService(session, utcnow, StaffPolicy.from_settings(settings))
            try:
                if args.command == "promote-super-admin":
                    change = service.promote_super_admin(
                        args.email,
                        args.reason,
                        override_policy=args.override_policy,
                        break_glass=args.break_glass,
                    )
                else:
                    change = service.demote_super_admin(args.email, args.reason)
            except StaffAuthorityError as error:
                print(f"Refused: {error.message}", file=sys.stderr)
                return 1
    finally:
        engine.dispose()

    promoting = args.command == "promote-super-admin"
    if change.changed:
        print(
            f"Super Admin role {'granted to' if promoting else 'removed from'} {change.email}; "
            f"{change.sessions_revoked} session(s) revoked."
        )
    else:
        print(f"No change: {change.email} {'already is' if promoting else 'is not'} a Super Admin.")
    if change.warning:
        print(f"WARNING: {change.warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
