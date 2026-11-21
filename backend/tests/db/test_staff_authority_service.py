"""The shared staff-authority service: Super Admin promotion / demotion (the CLI half), the
last-usable-Super-Admin invariant, the count policy, break-glass recovery, hosted identity refusal
and the "nothing else writes roles" guarantee (docs/backend/AUTH_RBAC.md §27.2, §27.6, §27.14).

Real PostgreSQL. Every assertion reads the STORED state (see ``staff_helpers``).
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

import app as app_package
from app.core.config import Settings
from app.models import AuthIdentity
from app.models.enums import (
    AuthEventType,
    AuthProvider,
    CategoryModule,
    RoleName,
    StaffAuditAction,
    StaffAuditSource,
)
from app.repositories.staff import StaffManagementRepository
from app.services.staff_authority import StaffPolicy
from app.services.staff_rules import StaffAuthorityError, StaffCode
from tests.db.auth_helpers import AuthEnv, make_account
from tests.db.helpers import violates
from tests.db.staff_helpers import (
    DIRECTORY,
    FOOD,
    REASON,
    audit_count,
    audit_events,
    auth_event_count,
    live_sessions,
    open_sessions,
    revoke_reasons,
    role_event_types,
    roles_of,
    scopes_of,
    service,
    snapshot,
)

HOSTED = {
    "frontend_origins": ["https://app.example.org"],
    "frontend_base_url": "https://app.example.org",
}


def refused(code: StaffCode) -> pytest.RaisesExc[StaffAuthorityError]:
    return pytest.raises(StaffAuthorityError, check=lambda e: e.code is code)


def admin(env: AuthEnv, email: str, **account: Any) -> Any:
    return make_account(env.session, email, admin=True, **account)


# -- promotion ------------------------------------------------------------------------------------


def test_promotion_grants_the_role_revokes_sessions_and_writes_audit_and_timeline(
    auth_env: AuthEnv,
) -> None:
    user = make_account(auth_env.session, "new-admin@example.org")
    open_sessions(auth_env, user.email, 2)

    change = service(auth_env.session, auth_env.clock).promote_super_admin(
        "  NEW-Admin@Example.org ", REASON
    )

    assert change.changed and change.sessions_revoked == 2 and change.warning is None
    assert roles_of(auth_env.session, user.id) == {"admin"}
    assert live_sessions(auth_env.session, user.id) == 0
    assert revoke_reasons(auth_env.session, user.id) == {"role_change"}
    assert role_event_types(auth_env.session, user.id) == [AuthEventType.ROLE_GRANTED]
    (event,) = audit_events(auth_env.session)
    assert event.action is StaffAuditAction.SUPER_ADMIN_PROMOTED
    assert event.source is StaffAuditSource.CLI and event.actor_user_id is None
    assert event.target_user_id == user.id and event.reason == REASON
    assert event.before == {"role": None, "scopes": []}
    assert event.after == {
        "role": "admin",
        "scopes": [],
        "super_admin_count": 1,
        "policy_override": False,
        "break_glass": False,
        "sessions_revoked": 2,
    }


def test_promoting_an_existing_super_admin_changes_nothing(auth_env: AuthEnv) -> None:
    user = admin(auth_env, "already@example.org")
    open_sessions(auth_env, user.email, 1)

    change = service(auth_env.session, auth_env.clock).promote_super_admin(user.email, REASON)

    assert not change.changed
    assert live_sessions(auth_env.session, user.id) == 1 and audit_count(auth_env.session) == 0
    assert auth_event_count(auth_env.session) == 1 + 0  # only the login of the session above


@pytest.mark.parametrize(
    ("account", "message"),
    [
        ({"verified": False}, "not verified"),
        ({"status": "suspended"}, "not active"),
        ({"status": "deleted"}, "not active"),
        ({"password": None}, "no way to sign in"),
    ],
)
def test_only_an_active_verified_account_that_can_sign_in_can_become_a_super_admin(
    auth_env: AuthEnv, account: dict[str, Any], message: str
) -> None:
    user = make_account(auth_env.session, "target@example.org", **account)
    before = snapshot(auth_env.session, user.id)

    with refused(StaffCode.TARGET_NOT_ELIGIBLE) as raised:
        service(auth_env.session, auth_env.clock).promote_super_admin(user.email, REASON)

    assert message in raised.value.message
    assert snapshot(auth_env.session, user.id) == before


def test_promoting_an_unknown_account_is_refused(auth_env: AuthEnv) -> None:
    with refused(StaffCode.ACCOUNT_NOT_FOUND):
        service(auth_env.session, auth_env.clock).promote_super_admin("ghost@example.org", REASON)
    assert audit_count(auth_env.session) == 0


@pytest.mark.parametrize("reason", [None, "", "   ", "too short", "x" * 501])
def test_a_promotion_or_demotion_needs_a_real_reason(auth_env: AuthEnv, reason: str | None) -> None:
    user = make_account(auth_env.session, "reasoned@example.org")
    other = admin(auth_env, "other-admin@example.org")
    before = snapshot(auth_env.session, user.id)

    with refused(StaffCode.REASON_REQUIRED):
        service(auth_env.session, auth_env.clock).promote_super_admin(user.email, reason or "")
    with refused(StaffCode.REASON_REQUIRED):
        service(auth_env.session, auth_env.clock).demote_super_admin(other.email, reason or "")

    assert snapshot(auth_env.session, user.id) == before
    assert roles_of(auth_env.session, other.id) == {"admin"}


def test_promoting_a_moderator_clears_the_moderator_role_and_scopes_in_one_transaction(
    auth_env: AuthEnv,
) -> None:
    user = make_account(
        auth_env.session, "mod-to-admin@example.org", moderator_scopes=[FOOD, DIRECTORY]
    )
    open_sessions(auth_env, user.email, 2)

    change = service(auth_env.session, auth_env.clock).promote_super_admin(user.email, REASON)

    assert change.changed
    assert roles_of(auth_env.session, user.id) == {"admin"}  # never both: the index backstop holds
    assert scopes_of(auth_env.session, user.id) == []
    assert role_event_types(auth_env.session, user.id) == [
        AuthEventType.ROLE_GRANTED,
        AuthEventType.ROLE_REVOKED,
    ]  # the moderator role revoked AND the admin role granted
    (event,) = audit_events(auth_env.session)
    assert event.before == {"role": "moderator", "scopes": ["directory", "food"]}
    assert event.after is not None and event.after["scopes"] == []


# -- a CURRENTLY usable sign-in method ---------------------------------------------------------------
#
# "Usable Super Admin" needs a way to sign in that works RIGHT NOW (docs/backend/AUTH_RBAC.md §27.6):
# a password, or a linked identity whose provider the OAuth flow would accept in the current
# configuration. A stored identity row that cannot authenticate must never make a Super Admin count.

GOOGLE_ON = (AuthProvider.GOOGLE,)
GOOGLE_OFF: tuple[AuthProvider, ...] = ()


def link_identity(env: AuthEnv, user: Any, provider: AuthProvider = AuthProvider.GOOGLE) -> None:
    env.session.add(
        AuthIdentity(user_id=user.id, provider=provider, provider_subject=f"{provider}-{user.id}")
    )
    env.session.commit()


def usable_count(env: AuthEnv, providers: tuple[AuthProvider, ...]) -> int:
    return StaffManagementRepository(env.session, providers).usable_super_admin_count()


def test_a_password_backed_super_admin_counts_whatever_the_providers(auth_env: AuthEnv) -> None:
    admin(auth_env, "password-admin@example.org")

    assert usable_count(auth_env, GOOGLE_OFF) == 1
    assert usable_count(auth_env, GOOGLE_ON) == 1


def test_an_oauth_only_super_admin_counts_exactly_while_its_provider_is_enabled(
    auth_env: AuthEnv,
) -> None:
    user = admin(auth_env, "google-admin@example.org", password=None)
    link_identity(auth_env, user)

    assert usable_count(auth_env, GOOGLE_OFF) == 0  # the row exists but cannot sign anyone in
    assert usable_count(auth_env, GOOGLE_ON) == 1  # the same row, once Google sign-in is enabled
    assert usable_count(auth_env, GOOGLE_OFF) == 0  # and it stops counting when it is turned off


@pytest.mark.parametrize("provider", [AuthProvider.FACEBOOK, AuthProvider.APPLE])
def test_an_identity_of_a_provider_with_no_login_adapter_never_counts(
    auth_env: AuthEnv, provider: AuthProvider
) -> None:
    user = admin(auth_env, f"{provider}-admin@example.org", password=None)
    link_identity(auth_env, user, provider)

    assert usable_count(auth_env, GOOGLE_ON) == 0  # stored vocabulary, but nothing can use it


def test_a_provider_name_outside_the_vocabulary_cannot_even_be_stored(auth_env: AuthEnv) -> None:
    """The database CHECK on ``auth_identities.provider`` means a truly unknown provider never
    reaches the usability query: the rule above covers every value that CAN be stored."""
    user = make_account(auth_env.session, "unknown-provider@example.org", password=None)

    with violates(auth_env.session, "ck_auth_identities_provider_valid"):
        auth_env.session.execute(
            text(
                "INSERT INTO auth_identities (id, user_id, provider, provider_subject) "
                "VALUES (gen_random_uuid(), :u, 'myspace', 'x')"
            ),
            {"u": user.id},
        )


def test_a_password_keeps_a_super_admin_usable_even_with_a_disabled_oauth_identity(
    auth_env: AuthEnv,
) -> None:
    user = admin(auth_env, "both-methods@example.org")
    link_identity(auth_env, user)

    assert usable_count(auth_env, GOOGLE_OFF) == 1  # the password carries it


def test_an_empty_password_hash_is_not_a_credential(auth_env: AuthEnv) -> None:
    user = admin(auth_env, "blank-hash@example.org")
    user.password_hash = ""
    auth_env.session.commit()

    assert usable_count(auth_env, GOOGLE_ON) == 0


def test_the_last_real_admin_cannot_be_demoted_when_the_other_admin_has_only_a_disabled_provider(
    auth_env: AuthEnv,
) -> None:
    """The lockout this rule exists to prevent: A signs in with a password; B only has a Google
    identity and Google sign-in is OFF. B must not count, or demoting A leaves nobody who can log in."""
    real = admin(auth_env, "real-admin@example.org")
    ghost = admin(auth_env, "google-only-admin@example.org", password=None)
    link_identity(auth_env, ghost)
    before = snapshot(auth_env.session, real.id)

    with refused(StaffCode.LAST_SUPER_ADMIN):
        service(auth_env.session, auth_env.clock, providers=GOOGLE_OFF).demote_super_admin(
            real.email, REASON
        )

    assert snapshot(auth_env.session, real.id) == before
    assert roles_of(auth_env.session, real.id) == {"admin"}


def test_enabling_the_provider_makes_the_identity_backed_admin_count_and_unblocks_the_demotion(
    auth_env: AuthEnv,
) -> None:
    real = admin(auth_env, "real-admin2@example.org")
    ghost = admin(auth_env, "google-only-admin2@example.org", password=None)
    link_identity(auth_env, ghost)
    with refused(StaffCode.LAST_SUPER_ADMIN):
        service(auth_env.session, auth_env.clock, providers=GOOGLE_OFF).demote_super_admin(
            real.email, REASON
        )

    change = service(auth_env.session, auth_env.clock, providers=GOOGLE_ON).demote_super_admin(
        real.email, REASON
    )

    assert change.changed and roles_of(auth_env.session, real.id) == set()
    assert roles_of(auth_env.session, ghost.id) == {
        "admin"
    }  # the Google admin now IS the usable one


def test_the_count_policy_ignores_an_admin_whose_provider_is_disabled(auth_env: AuthEnv) -> None:
    """The SAME promotion, judged under two configurations: with Google sign-in on there are two
    usable Super Admins already (so a third needs the override); with it off the Google-only admin
    cannot sign in, only one is usable, and no override is needed."""
    admin(auth_env, "p1@example.org")
    ghost = admin(auth_env, "p2@example.org", password=None)
    link_identity(auth_env, ghost)
    third = make_account(auth_env.session, "p3@example.org")

    with refused(StaffCode.POLICY_OVERRIDE_REQUIRED):
        service(auth_env.session, auth_env.clock, providers=GOOGLE_ON).promote_super_admin(
            third.email, REASON
        )
    assert roles_of(auth_env.session, third.id) == set()

    change = service(auth_env.session, auth_env.clock, providers=GOOGLE_OFF).promote_super_admin(
        third.email, REASON
    )

    assert change.changed and change.warning is None


@pytest.mark.parametrize(
    "setup",
    ["no-method", "disabled-google", "facebook-only", "blank-hash"],
)
def test_promoting_an_account_with_no_currently_usable_sign_in_is_refused(
    auth_env: AuthEnv, setup: str
) -> None:
    user = make_account(auth_env.session, f"{setup}@example.org", password=None)
    if setup == "disabled-google":
        link_identity(auth_env, user, AuthProvider.GOOGLE)
    elif setup == "facebook-only":
        link_identity(auth_env, user, AuthProvider.FACEBOOK)
    elif setup == "blank-hash":
        user.password_hash = ""
        auth_env.session.commit()
    before = snapshot(auth_env.session, user.id)

    with refused(StaffCode.TARGET_NOT_ELIGIBLE) as raised:
        service(auth_env.session, auth_env.clock, providers=GOOGLE_OFF).promote_super_admin(
            user.email, REASON
        )

    assert "no way to sign in" in raised.value.message
    assert snapshot(auth_env.session, user.id) == before


def test_promoting_a_google_only_account_works_only_once_google_sign_in_is_enabled(
    auth_env: AuthEnv,
) -> None:
    user = make_account(auth_env.session, "google-promote@example.org", password=None)
    link_identity(auth_env, user)

    with refused(StaffCode.TARGET_NOT_ELIGIBLE):
        service(auth_env.session, auth_env.clock, providers=GOOGLE_OFF).promote_super_admin(
            user.email, REASON
        )
    assert (
        service(auth_env.session, auth_env.clock, providers=GOOGLE_ON)
        .promote_super_admin(user.email, REASON)
        .changed
    )


def test_break_glass_recovery_from_zero_needs_a_target_that_can_actually_sign_in(
    auth_env: AuthEnv,
) -> None:
    """Recovery is only useful if the promoted account can authenticate, so break-glass does not
    waive the sign-in requirement (the frozen design does not ask it to)."""
    admin(auth_env, "dead@example.org", status="suspended")  # the system has ZERO usable admins
    ghost = make_account(auth_env.session, "ghost-rescuer@example.org", password=None)
    link_identity(auth_env, ghost)
    rescuer = make_account(auth_env.session, "real-rescuer@example.org")
    svc = service(auth_env.session, auth_env.clock, providers=GOOGLE_OFF)

    with refused(StaffCode.TARGET_NOT_ELIGIBLE):
        svc.promote_super_admin(ghost.email, REASON, break_glass=True)
    assert roles_of(auth_env.session, ghost.id) == set()

    change = svc.promote_super_admin(rescuer.email, REASON, break_glass=True)

    assert change.changed and roles_of(auth_env.session, rescuer.id) == {"admin"}
    event = audit_events(auth_env.session)[-1]
    assert event.source is StaffAuditSource.CLI and event.after is not None
    assert event.after["break_glass"] is True and event.after["super_admin_count"] == 1
    assert usable_count(auth_env, GOOGLE_OFF) == 1  # the system can sign in again


# -- the count policy -----------------------------------------------------------------------------


def test_the_third_usable_super_admin_needs_the_override_and_is_warned_about(
    auth_env: AuthEnv,
) -> None:
    admin(auth_env, "a1@example.org")
    admin(auth_env, "a2@example.org")
    third = make_account(auth_env.session, "a3@example.org")
    svc = service(auth_env.session, auth_env.clock)
    before = snapshot(auth_env.session, third.id)

    with refused(StaffCode.POLICY_OVERRIDE_REQUIRED):
        svc.promote_super_admin(third.email, REASON)
    assert snapshot(auth_env.session, third.id) == before

    change = svc.promote_super_admin(third.email, REASON, override_policy=True)

    assert change.changed and change.warning is not None and "3 usable" in change.warning
    after = audit_events(auth_env.session)[-1].after
    assert after is not None
    assert (after["super_admin_count"], after["policy_override"], after["break_glass"]) == (
        3,
        True,
        False,
    )


def test_a_promotion_above_the_ceiling_needs_break_glass_and_the_override_is_not_enough(
    auth_env: AuthEnv,
) -> None:
    for n in range(3):
        admin(auth_env, f"admin{n}@example.org")
    fourth = make_account(auth_env.session, "a4@example.org")
    svc = service(auth_env.session, auth_env.clock)

    with refused(StaffCode.BREAK_GLASS_REQUIRED):
        svc.promote_super_admin(fourth.email, REASON, override_policy=True)
    assert roles_of(auth_env.session, fourth.id) == set()

    assert svc.promote_super_admin(fourth.email, REASON, break_glass=True).changed
    after = audit_events(auth_env.session)[-1].after
    assert after is not None and after["break_glass"] is True and after["super_admin_count"] == 4


def test_the_ceiling_is_a_setting_not_a_constant(auth_env: AuthEnv) -> None:
    admin(auth_env, "c1@example.org")
    admin(auth_env, "c2@example.org")
    third = make_account(auth_env.session, "c3@example.org")

    with refused(StaffCode.BREAK_GLASS_REQUIRED):
        service(auth_env.session, auth_env.clock, ceiling=2).promote_super_admin(
            third.email, REASON, override_policy=True
        )


def test_super_admins_that_cannot_actually_sign_in_do_not_count_toward_the_policy(
    auth_env: AuthEnv,
) -> None:
    admin(auth_env, "usable@example.org")
    admin(auth_env, "unverified-admin@example.org", verified=False)
    admin(auth_env, "suspended-admin@example.org", status="suspended")
    admin(auth_env, "no-signin-admin@example.org", password=None)
    next_one = make_account(auth_env.session, "next@example.org")

    change = service(auth_env.session, auth_env.clock).promote_super_admin(next_one.email, REASON)

    assert change.changed and change.warning is None  # 1 usable -> 2: still the normal target


# -- recovery from zero ---------------------------------------------------------------------------


@pytest.mark.parametrize("flag", [False, True], ids=["plain", "break-glass"])
def test_a_system_with_no_usable_super_admin_can_always_recover_by_a_grant(
    auth_env: AuthEnv, flag: bool
) -> None:
    admin(auth_env, "dead-admin@example.org", status="suspended")  # holds the role, unusable
    rescuer = make_account(auth_env.session, "rescuer@example.org")

    change = service(auth_env.session, auth_env.clock).promote_super_admin(
        rescuer.email, REASON, break_glass=flag
    )

    assert change.changed and roles_of(auth_env.session, rescuer.id) == {"admin"}
    event = audit_events(auth_env.session)[-1]
    assert event.source is StaffAuditSource.CLI and event.reason == REASON
    assert event.after is not None and event.after["break_glass"] is flag  # recorded when used
    assert event.after["super_admin_count"] == 1


def test_break_glass_does_not_waive_the_mandatory_reason(auth_env: AuthEnv) -> None:
    rescuer = make_account(auth_env.session, "rescuer2@example.org")
    with refused(StaffCode.REASON_REQUIRED):
        service(auth_env.session, auth_env.clock).promote_super_admin(
            rescuer.email, "", break_glass=True
        )
    assert roles_of(auth_env.session, rescuer.id) == set()


# -- demotion and the last-usable-Super-Admin invariant ----------------------------------------------


def test_demotion_removes_the_role_revokes_sessions_and_audits(auth_env: AuthEnv) -> None:
    keeper = admin(auth_env, "keeper@example.org")
    leaving = admin(auth_env, "leaving@example.org")
    open_sessions(auth_env, leaving.email, 2)

    change = service(auth_env.session, auth_env.clock).demote_super_admin(leaving.email, REASON)

    assert change.changed and change.sessions_revoked == 2
    assert roles_of(auth_env.session, leaving.id) == set()  # not made a Moderator either
    assert roles_of(auth_env.session, keeper.id) == {"admin"}
    assert live_sessions(auth_env.session, leaving.id) == 0
    assert role_event_types(auth_env.session, leaving.id) == [AuthEventType.ROLE_REVOKED]
    (event,) = audit_events(auth_env.session)
    assert event.action is StaffAuditAction.SUPER_ADMIN_DEMOTED
    assert event.source is StaffAuditSource.CLI and event.actor_user_id is None
    assert event.reason == REASON and event.target_user_id == leaving.id
    assert event.before == {"role": "admin", "scopes": []}
    assert event.after == {
        "role": None,
        "scopes": [],
        "super_admin_count": 1,
        "sessions_revoked": 2,
    }


def test_the_last_usable_super_admin_cannot_be_demoted(auth_env: AuthEnv) -> None:
    only = admin(auth_env, "only@example.org")
    open_sessions(auth_env, only.email, 1)
    before = snapshot(auth_env.session, only.id)

    with refused(StaffCode.LAST_SUPER_ADMIN):
        service(auth_env.session, auth_env.clock).demote_super_admin(only.email, REASON)

    assert snapshot(auth_env.session, only.id) == before  # role, sessions, audit, timeline


@pytest.mark.parametrize(
    "account",
    [{"verified": False}, {"status": "suspended"}, {"status": "deleted"}, {"password": None}],
    ids=["unverified", "suspended", "deleted", "no-sign-in"],
)
def test_an_admin_that_is_not_usable_does_not_save_the_last_usable_one(
    auth_env: AuthEnv, account: dict[str, Any]
) -> None:
    usable = admin(auth_env, "usable@example.org")
    admin(auth_env, "unusable@example.org", **account)

    with refused(StaffCode.LAST_SUPER_ADMIN):
        service(auth_env.session, auth_env.clock).demote_super_admin(usable.email, REASON)

    assert roles_of(auth_env.session, usable.id) == {"admin"}


def test_demoting_an_admin_that_was_never_usable_is_allowed_even_with_no_usable_admin(
    auth_env: AuthEnv,
) -> None:
    dead = admin(auth_env, "dead@example.org", verified=False)

    change = service(auth_env.session, auth_env.clock).demote_super_admin(dead.email, REASON)

    assert change.changed and roles_of(auth_env.session, dead.id) == set()


def test_two_super_admins_can_demote_one_but_never_both(auth_env: AuthEnv) -> None:
    a = admin(auth_env, "pa@example.org")
    b = admin(auth_env, "pb@example.org")
    svc = service(auth_env.session, auth_env.clock)

    assert svc.demote_super_admin(a.email, REASON).changed
    with refused(StaffCode.LAST_SUPER_ADMIN):
        svc.demote_super_admin(b.email, REASON)

    assert roles_of(auth_env.session, b.id) == {"admin"}


def test_demoting_a_non_super_admin_or_an_unknown_account(auth_env: AuthEnv) -> None:
    admin(auth_env, "someone@example.org")
    plain = make_account(auth_env.session, "plain@example.org")
    svc = service(auth_env.session, auth_env.clock)

    assert not svc.demote_super_admin(plain.email, REASON).changed
    with refused(StaffCode.ACCOUNT_NOT_FOUND):
        svc.demote_super_admin("ghost@example.org", REASON)
    assert audit_count(auth_env.session) == 0


def test_there_is_no_flag_that_demotes_the_last_super_admin() -> None:
    """Break-glass exists for recovery and promotion; the demotion API has no such parameter."""
    import inspect

    from app.services.staff_authority import StaffAuthorityService

    assert list(inspect.signature(StaffAuthorityService.demote_super_admin).parameters) == [
        "self",
        "email",
        "reason",
    ]


def test_the_guard_is_a_public_hook_for_future_suspend_and_delete_paths(auth_env: AuthEnv) -> None:
    only = admin(auth_env, "hook-only@example.org")
    second = admin(auth_env, "hook-second@example.org")
    svc = service(auth_env.session, auth_env.clock)

    svc.guard_last_usable_super_admin(only.id)  # another usable admin exists: allowed
    admin_ids = {only.id, second.id}
    assert len(admin_ids) == 2
    svc.demote_super_admin(second.email, REASON)
    with refused(StaffCode.LAST_SUPER_ADMIN):
        svc.guard_last_usable_super_admin(only.id)
    svc.guard_last_usable_super_admin(uuid.uuid4())  # not a Super Admin at all: nothing to protect


# -- hosted environments ---------------------------------------------------------------------------


def policy_for(environment: str) -> StaffPolicy:
    hosted = environment in {"staging", "production"}
    return StaffPolicy.from_settings(
        Settings(_env_file=None, environment=environment, **(HOSTED if hosted else {}))  # type: ignore[arg-type]
    )


RESERVED = [
    "admin@fixtures.example",
    "staff@corp.test",
    "staff@corp.invalid",
    "staff@corp.localhost",
]


@pytest.mark.parametrize("environment", ["development", "test", "staging", "production"])
@pytest.mark.parametrize("address", RESERVED)
def test_hosted_environments_refuse_fixture_demo_and_reserved_identities(
    auth_env: AuthEnv, environment: str, address: str
) -> None:
    target = make_account(auth_env.session, address)
    actor = admin(auth_env, "actor@example.org")
    policy = policy_for(environment)
    hosted = environment in {"staging", "production"}
    from app.services.staff_authority import StaffAuthorityService

    svc = StaffAuthorityService(auth_env.session, auth_env.clock, policy)

    if hosted:
        with refused(StaffCode.TARGET_NOT_ELIGIBLE):
            svc.promote_super_admin(target.email, REASON)
        with refused(StaffCode.TARGET_NOT_ELIGIBLE):
            svc.appoint_moderator(actor.id, target.email, [FOOD])
        assert roles_of(auth_env.session, target.id) == set()
    else:  # local development / throwaway test databases: demo staff are allowed
        assert svc.appoint_moderator(actor.id, target.email, [FOOD]).changed
        assert roles_of(auth_env.session, target.id) == {"moderator"}


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_a_real_address_is_accepted_in_a_hosted_environment(
    auth_env: AuthEnv, environment: str
) -> None:
    target = make_account(auth_env.session, "jane.doe@portal.pk")
    from app.services.staff_authority import StaffAuthorityService

    svc = StaffAuthorityService(auth_env.session, auth_env.clock, policy_for(environment))

    assert svc.promote_super_admin(target.email, REASON).changed


def test_the_environment_maps_to_hosted_exactly_as_the_other_hosted_refusals_do() -> None:
    assert [policy_for(e).hosted for e in ("development", "test", "staging", "production")] == [
        False,
        False,
        True,
        True,
    ]


# -- the acting Super Admin is re-checked inside the transaction ---------------------------------------


def test_a_super_admin_who_lost_the_role_cannot_complete_a_staff_change(auth_env: AuthEnv) -> None:
    keeper = admin(auth_env, "k@example.org")
    actor = admin(auth_env, "gone@example.org")
    target = make_account(auth_env.session, "t@example.org")
    svc = service(auth_env.session, auth_env.clock)
    svc.demote_super_admin(actor.email, REASON)
    before = snapshot(auth_env.session, target.id)

    with refused(StaffCode.ACTOR_NOT_AUTHORISED):
        svc.appoint_moderator(actor.id, target.email, [FOOD])

    assert snapshot(auth_env.session, target.id) == before
    assert roles_of(auth_env.session, keeper.id) == {"admin"}


@pytest.mark.parametrize("account", [{"status": "suspended"}, {"verified": False}])
def test_a_suspended_or_unverified_actor_cannot_complete_a_staff_change(
    auth_env: AuthEnv, account: dict[str, Any]
) -> None:
    actor = admin(auth_env, "weak-actor@example.org", **account)
    target = make_account(auth_env.session, "tt@example.org")

    with refused(StaffCode.ACTOR_NOT_AUTHORISED):
        service(auth_env.session, auth_env.clock).appoint_moderator(actor.id, target.email, [FOOD])


# -- nothing else writes roles -------------------------------------------------------------------------

APP_ROOT = Path(app_package.__file__).parent
#: The ONLY modules that may touch a role or scope row.
ROLE_WRITERS = {
    "repositories/auth.py",  # RoleRepository (grant / revoke)
    "repositories/staff.py",  # scope assignments
    "services/staff_authority.py",  # the one service that calls them
}
WRITE_PATTERNS = [
    r"(?<!class )\bUserRole\(",
    r"(?<!class )\bStaffScopeAssignment\(",
    r"\bdelete\(\s*(UserRole|StaffScopeAssignment)\b",
    r"\bupdate\(\s*(UserRole|StaffScopeAssignment)\b",
    r"\binsert\(\s*(UserRole|StaffScopeAssignment)\b",
    r"\bRoleRepository\b",
    r"\bStaffManagementRepository\b",
]


def app_sources() -> list[tuple[str, str]]:
    return [
        (path.relative_to(APP_ROOT).as_posix(), path.read_text(encoding="utf-8"))
        for path in sorted(APP_ROOT.rglob("*.py"))
    ]


def test_nothing_outside_the_authority_service_writes_roles_or_scopes() -> None:
    offenders = [
        (name, pattern)
        for name, source in app_sources()
        if name not in ROLE_WRITERS
        for pattern in WRITE_PATTERNS
        if re.search(pattern, source)
    ]
    assert offenders == []


def test_only_the_authority_service_uses_the_role_and_scope_write_repositories() -> None:
    users_of = {
        name
        for name, source in app_sources()
        if re.search(r"\bRoleRepository\b|\bStaffManagementRepository\b", source)
    }
    # staff.py names them in its own docstring / definition; auth.py defines RoleRepository.
    assert users_of == ROLE_WRITERS


def test_the_clis_have_no_role_writes_and_delegate_to_the_one_service() -> None:
    cli = {name: source for name, source in app_sources() if name.startswith("cli/")}
    assert {"cli/staff.py", "cli/admin.py"} <= set(cli)
    for name, source in cli.items():
        for pattern in WRITE_PATTERNS:
            assert not re.search(pattern, source), (name, pattern)
    assert "StaffAuthorityService" in cli["cli/staff.py"]
    assert "staff_cli.main" in cli["cli/admin.py"]  # the deprecated wrapper adds no logic


def test_the_retired_role_service_is_gone() -> None:
    assert not (APP_ROOT / "services" / "admin_roles.py").exists()


def test_no_route_can_promote_or_demote_a_super_admin() -> None:
    """Promotion and demotion are CLI-only: no ``/admin`` path mentions a Super Admin role change,
    and no staff route accepts a ``role`` (the request schemas reject undeclared keys)."""
    from app.schemas.staff import (
        AppointModeratorRequest,
        ReplaceScopesRequest,
        ResumeModeratorRequest,
    )

    for schema in (AppointModeratorRequest, ReplaceScopesRequest, ResumeModeratorRequest):
        assert not {"role", "roles", "super_admin", "superAdmin"} & set(schema.model_fields)
    assert RoleName.ADMIN.value == "admin"
    assert CategoryModule.NEWS.value == "news"
