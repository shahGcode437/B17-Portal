"""DEPRECATED: ``python -m app.cli.admin grant|revoke EMAIL`` — use ``python -m app.cli.staff``.

Kept only so an operator's muscle memory and old runbooks do not silently stop working. It has NO
logic of its own: ``grant`` is ``staff promote-super-admin`` and ``revoke`` is ``staff
demote-super-admin``, run through the same shared authority service, so the same rules apply —
including the one that changed: **a reason is now mandatory** (``--reason "..."``), because the
frozen design (docs/backend/AUTH_RBAC.md §27.6) requires every promotion and demotion to be
explained and audited. ``grant`` also accepts ``--override-policy`` and ``--break-glass``.

Remove this module once no runbook mentions it.
"""

import argparse
import sys
from collections.abc import Sequence

from app.cli import staff as staff_cli


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli.admin", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    grant = commands.add_parser("grant", help="DEPRECATED: staff promote-super-admin")
    grant.add_argument("email")
    grant.add_argument("--reason", required=True)
    grant.add_argument("--override-policy", action="store_true")
    grant.add_argument("--break-glass", action="store_true")
    revoke = commands.add_parser("revoke", help="DEPRECATED: staff demote-super-admin")
    revoke.add_argument("email")
    revoke.add_argument("--reason", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    replacement = "promote-super-admin" if args.command == "grant" else "demote-super-admin"
    print(
        f"DEPRECATED: use `python -m app.cli.staff {replacement}` instead of "
        f"`python -m app.cli.admin {args.command}`.",
        file=sys.stderr,
    )
    forwarded = [replacement, args.email, "--reason", args.reason]
    if args.command == "grant":
        forwarded += (["--override-policy"] if args.override_policy else []) + (
            ["--break-glass"] if args.break_glass else []
        )
    return staff_cli.main(forwarded)


if __name__ == "__main__":
    raise SystemExit(main())
