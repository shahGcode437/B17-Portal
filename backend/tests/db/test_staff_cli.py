"""The operator staff CLI end to end (docs/backend/AUTH_RBAC.md §27.6, §30).

Real commits through the real ``main()`` entry points (the CLI opens its own engine from
``DATABASE_URL``), so these run against COMMITTED rows. They prove the CLI is the same authority as
the web service — same last-usable-Super-Admin rule, same session revocation, same audit
(``source = cli``) — and that the deprecated ``app.cli.admin`` wrapper adds nothing of its own.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.cli import admin as admin_cli
from app.cli import staff as staff_cli
from app.core.config import Settings, get_settings
from app.models import AuthIdentity, StaffAuditEvent, UserRole
from app.models.enums import AuthProvider, RoleName, StaffAuditAction, StaffAuditSource
from tests.db.auth_helpers import make_account
from tests.db.staff_helpers import REASON, purge_staff_audit
from tests.db.test_listing_write_concurrency import committed_world


@pytest.fixture
def cli_db(db_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    monkeypatch.setenv("DATABASE_URL", db_engine.url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    with purge_staff_audit(db_engine), committed_world(db_engine):
        try:
            yield db_engine
        finally:
            get_settings.cache_clear()


def account(engine: Engine, email: str, **kw: Any) -> None:
    with Session(engine) as session:
        make_account(session, email, **kw)


def admin_count(engine: Engine) -> int:
    with Session(engine) as session:
        return int(
            session.scalar(
                select(func.count()).select_from(UserRole).where(UserRole.role == RoleName.ADMIN)
            )
            or 0
        )


def audit_rows(engine: Engine) -> list[StaffAuditEvent]:
    with Session(engine) as session:
        return list(
            session.scalars(
                select(StaffAuditEvent).order_by(StaffAuditEvent.occurred_at, StaffAuditEvent.id)
            )
        )


def run(*argv: str) -> int:
    return staff_cli.main(list(argv))


def promote(email: str, *flags: str, reason: str = REASON) -> int:
    return run("promote-super-admin", email, "--reason", reason, *flags)


# -- promote / demote ----------------------------------------------------------------------------


def test_promoting_grants_the_role_and_audits_it_as_a_cli_event(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "first@example.org")

    assert promote("  FIRST@Example.org ") == 0

    assert "Super Admin role granted to first@example.org; 0 session(s) revoked." in (
        capsys.readouterr().out
    )
    assert admin_count(cli_db) == 1
    (event,) = audit_rows(cli_db)
    assert event.action is StaffAuditAction.SUPER_ADMIN_PROMOTED
    assert event.source is StaffAuditSource.CLI and event.actor_user_id is None
    assert event.reason == REASON


def test_promoting_twice_is_a_harmless_no_change(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "twice@example.org")
    assert promote("twice@example.org") == 0
    capsys.readouterr()

    assert promote("twice@example.org") == 0

    assert "No change: twice@example.org already is a Super Admin." in capsys.readouterr().out
    assert admin_count(cli_db) == 1 and len(audit_rows(cli_db)) == 1


def test_the_reason_is_mandatory_for_promotion_and_demotion(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "needs-reason@example.org")
    account(cli_db, "keeper@example.org", admin=True)
    account(cli_db, "leaver@example.org", admin=True)

    with pytest.raises(SystemExit) as no_reason:
        run("promote-super-admin", "needs-reason@example.org")
    with pytest.raises(SystemExit) as no_reason_demote:
        run("demote-super-admin", "leaver@example.org")
    assert no_reason.value.code == no_reason_demote.value.code == 2  # argparse: --reason required

    assert promote("needs-reason@example.org", reason="short") == 1
    assert "Refused: Give a reason" in capsys.readouterr().err
    assert run("demote-super-admin", "leaver@example.org", "--reason", "") == 1
    assert admin_count(cli_db) == 2 and audit_rows(cli_db) == []


@pytest.mark.parametrize(
    ("email", "account_args"),
    [
        ("unverified@example.org", {"verified": False}),
        ("suspended@example.org", {"status": "suspended"}),
        ("nosignin@example.org", {"password": None}),
        ("ghost@example.org", None),
    ],
)
def test_the_cli_refuses_an_account_that_cannot_hold_the_role(
    cli_db: Engine,
    capsys: pytest.CaptureFixture[str],
    email: str,
    account_args: dict[str, Any] | None,
) -> None:
    if account_args is not None:
        account(cli_db, email, **account_args)

    assert promote(email) == 1

    assert "Refused" in capsys.readouterr().err
    assert admin_count(cli_db) == 0 and audit_rows(cli_db) == []


def test_the_last_usable_super_admin_cannot_be_demoted_but_one_of_two_can(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "one@example.org", admin=True)
    account(cli_db, "two@example.org", admin=True)

    assert run("demote-super-admin", "one@example.org", "--reason", REASON) == 0
    capsys.readouterr()
    assert run("demote-super-admin", "two@example.org", "--reason", REASON) == 1

    assert "last usable Super Admin" in capsys.readouterr().err
    assert admin_count(cli_db) == 1
    assert [e.action for e in audit_rows(cli_db)] == [StaffAuditAction.SUPER_ADMIN_DEMOTED]


# -- the count policy ----------------------------------------------------------------------------


def test_the_cli_enforces_the_override_and_the_break_glass_ladder(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    for n in range(2):
        account(cli_db, f"admin{n}@example.org", admin=True)
    account(cli_db, "third@example.org")
    account(cli_db, "fourth@example.org")

    assert promote("third@example.org") == 1  # no flag: the third needs the override
    assert "--override-policy" in capsys.readouterr().err
    assert admin_count(cli_db) == 2

    assert promote("third@example.org", "--override-policy") == 0
    assert "WARNING" in capsys.readouterr().err  # above the normal target of 2
    assert admin_count(cli_db) == 3

    assert promote("fourth@example.org", "--override-policy") == 1  # beyond the ceiling
    assert "--break-glass" in capsys.readouterr().err
    assert promote("fourth@example.org", "--break-glass") == 0
    assert admin_count(cli_db) == 4
    last = audit_rows(cli_db)[-1]
    assert last.after is not None and last.after["break_glass"] is True


def test_break_glass_recovers_a_system_with_no_usable_super_admin(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "dead@example.org", admin=True, status="suspended")  # holds the role, unusable
    account(cli_db, "rescuer@example.org")

    assert promote("rescuer@example.org", "--break-glass") == 0

    (event,) = audit_rows(cli_db)
    assert event.source is StaffAuditSource.CLI and event.reason == REASON
    assert event.after is not None and event.after["break_glass"] is True
    assert event.after["super_admin_count"] == 1


# -- the deprecated wrapper ----------------------------------------------------------------------


def test_the_deprecated_admin_command_is_the_same_authority(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "legacy@example.org")
    account(cli_db, "other@example.org", admin=True)

    assert admin_cli.main(["grant", "legacy@example.org", "--reason", REASON]) == 0
    captured = capsys.readouterr()
    assert "DEPRECATED" in captured.err and "staff promote-super-admin" in captured.err
    assert "Super Admin role granted to legacy@example.org" in captured.out
    assert admin_count(cli_db) == 2
    assert audit_rows(cli_db)[-1].source is StaffAuditSource.CLI  # audited like the new command

    assert admin_cli.main(["revoke", "legacy@example.org", "--reason", REASON]) == 0
    assert admin_cli.main(["revoke", "other@example.org", "--reason", REASON]) == 1  # last: refused
    assert "last usable Super Admin" in capsys.readouterr().err
    assert admin_count(cli_db) == 1


def test_the_deprecated_command_also_needs_a_reason() -> None:
    with pytest.raises(SystemExit) as raised:
        admin_cli.main(["grant", "someone@example.org"])
    assert raised.value.code == 2


# -- roster and audit ----------------------------------------------------------------------------


def test_the_roster_and_audit_commands_show_the_staff_and_the_history(
    cli_db: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    account(cli_db, "boss@example.org")
    account(cli_db, "mod@example.org", moderator_scopes=[])  # a paused Moderator
    promote("boss@example.org")
    capsys.readouterr()

    assert run("roster") == 0
    roster = capsys.readouterr().out
    assert "admin" in roster and "boss@example.org" in roster
    assert "moderator" in roster and "PAUSED" in roster and "2 of 2 staff member(s)." in roster

    assert run("audit", "--limit", "5") == 0
    audit = capsys.readouterr().out
    assert "super_admin_promoted" in audit and "cli" in audit and "1 of 1 event(s)." in audit
    assert run("audit", "--action", "moderator_removed") == 0
    assert "0 of 0 event(s)." in capsys.readouterr().out
    with pytest.raises(SystemExit):
        run("audit", "--action", "not_an_action")


# -- hosted environments -------------------------------------------------------------------------


def test_a_hosted_cli_refuses_a_fixture_identity(
    cli_db: Engine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    hosted = Settings(
        _env_file=None,
        environment="production",
        database_url=cli_db.url.render_as_string(hide_password=False),
        frontend_origins=["https://app.example.org"],
        frontend_base_url="https://app.example.org",
    )
    monkeypatch.setattr(staff_cli, "get_settings", lambda: hosted)
    account(cli_db, "admin@fixtures.example")
    account(cli_db, "real.person@portal.pk")

    assert promote("admin@fixtures.example") == 1
    assert "hosted environment" in capsys.readouterr().err
    assert admin_count(cli_db) == 0

    assert promote("real.person@portal.pk") == 0  # a real address is fine
    assert admin_count(cli_db) == 1


# -- the configured login providers decide who is usable -----------------------------------------


def test_the_cli_judges_a_google_only_super_admin_by_the_providers_it_is_configured_with(
    cli_db: Engine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A signs in with a password; B only has a Google identity. With Google sign-in OFF (the CLI's
    default configuration) B cannot sign in, so A is the last usable Super Admin and cannot be
    demoted. Run the SAME CLI against the SAME database with Google enabled and B counts."""
    with Session(cli_db) as session:
        make_account(session, "pw-admin@example.org", admin=True)
        google_admin = make_account(session, "google-admin@example.org", admin=True, password=None)
        session.add(
            AuthIdentity(
                user_id=google_admin.id, provider=AuthProvider.GOOGLE, provider_subject="g-1"
            )
        )
        session.commit()

    assert run("demote-super-admin", "pw-admin@example.org", "--reason", REASON) == 1
    assert "last usable Super Admin" in capsys.readouterr().err
    assert admin_count(cli_db) == 2  # nothing changed

    monkeypatch.setenv("GOOGLE_OAUTH_PROVIDER", "fake")  # Google sign-in is now enabled
    monkeypatch.setenv("API_PUBLIC_BASE_URL", "http://127.0.0.1:8000")  # which Settings requires
    get_settings.cache_clear()
    assert run("demote-super-admin", "pw-admin@example.org", "--reason", REASON) == 0
    assert admin_count(cli_db) == 1  # the Google admin remains, and it can now really sign in


def test_the_cli_refuses_to_promote_a_google_only_account_while_google_sign_in_is_off(
    cli_db: Engine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    with Session(cli_db) as session:
        user = make_account(session, "google-target@example.org", password=None)
        session.add(
            AuthIdentity(user_id=user.id, provider=AuthProvider.GOOGLE, provider_subject="g-2")
        )
        session.commit()

    assert promote("google-target@example.org", "--break-glass") == 1  # not even break-glass
    assert "no way to sign in right now" in capsys.readouterr().err
    assert admin_count(cli_db) == 0

    monkeypatch.setenv("GOOGLE_OAUTH_PROVIDER", "fake")
    monkeypatch.setenv("API_PUBLIC_BASE_URL", "http://127.0.0.1:8000")
    get_settings.cache_clear()
    assert promote("google-target@example.org") == 0
    assert admin_count(cli_db) == 1
