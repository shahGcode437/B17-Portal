"""Development only: print a fresh e-mail verification link for a local account.

    python -m app.cli.dev_verify someone@example.org
    python -m app.cli.dev_verify someone@example.org --origin http://localhost:5173

In development no e-mail is sent (the ``console`` backend prints it in the API terminal). This
issues a real one-time token and prints the same link the e-mail would contain; opening it in
the browser verifies the account through the normal ``POST /auth/verify-email``. It refuses to
run outside ``ENVIRONMENT=development|test`` or against a non-local database - see
``app/services/dev_verification.py`` and ``docs/backend/AUTH_RBAC.md`` (Development verification).

Exit codes: ``0`` link printed, ``1`` refused for a data reason (unknown / already verified
account), ``2`` refused because this is not a development setup.
"""

import argparse
import sys
from collections.abc import Sequence

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.db.session import create_db_engine
from app.services.dev_verification import (
    DevVerificationRefused,
    ensure_development_only,
    issue_dev_verification_link,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli.dev_verify", description=__doc__)
    parser.add_argument("email", help="the local account's email address")
    parser.add_argument(
        "--origin",
        help="the frontend origin to put in the link (default: FRONTEND_BASE_URL); "
        "must be one of FRONTEND_ORIGINS, e.g. http://localhost:5173",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = get_settings()
    except ValidationError:
        # A hosted environment with incomplete configuration refuses to load at all; for this
        # command that is simply "not a development setup" (no traceback, no connection).
        print(
            "Refused: the configuration is not a valid development setup "
            "(this command only works with ENVIRONMENT=development).",
            file=sys.stderr,
        )
        return 2
    try:
        ensure_development_only(settings)
    except DevVerificationRefused as refusal:
        print(f"Refused: {refusal}.", file=sys.stderr)
        return 2
    engine = create_db_engine(settings)
    try:
        with Session(engine, expire_on_commit=False) as session:
            try:
                link = issue_dev_verification_link(
                    session, settings, utcnow, args.email, origin=args.origin
                )
            except DevVerificationRefused as refusal:
                print(f"Refused: {refusal}.", file=sys.stderr)
                return 1
    finally:
        engine.dispose()
    print(f"Open this link in the browser to verify {link.email} (works once, expires in 24 h):")
    print(link.url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
