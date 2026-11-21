"""RBAC-C pure rules (DB-free): scopes, hosted identities, reasons, the Super Admin count policy and
the two new settings (docs/backend/AUTH_RBAC.md §27.6, §27.7, §27.14)."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.models.enums import AuthProvider, CategoryModule
from app.services.oauth import create_oauth_providers, enabled_login_providers
from app.services.staff_audit import clean_state
from app.services.staff_authority import StaffPolicy
from app.services.staff_rules import (
    FIXTURE_EMAIL_DOMAIN,
    NORMAL_SUPER_ADMIN_TARGET,
    StaffAuthorityError,
    StaffCode,
    clean_reason,
    decide_promotion,
    is_reserved_identity,
    validate_scopes,
)

FOOD, DIRECTORY, NEWS = CategoryModule.FOOD, CategoryModule.DIRECTORY, CategoryModule.NEWS


def build(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


HOSTED = {
    "frontend_origins": ["https://app.example.org"],
    "frontend_base_url": "https://app.example.org",
}


def refused(code: StaffCode) -> pytest.RaisesExc[StaffAuthorityError]:
    return pytest.raises(StaffAuthorityError, check=lambda e: e.code is code)


# -- scopes ---------------------------------------------------------------------------------------


def test_scopes_are_deduplicated_and_must_be_assignable() -> None:
    assert validate_scopes([FOOD, FOOD, DIRECTORY]) == {FOOD, DIRECTORY}
    assert validate_scopes(list(CategoryModule)[:0] + [FOOD]) == {FOOD}


def test_an_empty_scope_set_is_a_pause_not_an_update() -> None:
    with refused(StaffCode.INVALID_STAFF_SCOPE) as raised:
        validate_scopes([])
    assert "pause" in raised.value.message and raised.value.field == "scopes"


@pytest.mark.parametrize("scopes", [[NEWS], [NEWS, FOOD], [FOOD, DIRECTORY, NEWS]])
def test_the_reserved_news_scope_can_never_be_stored(scopes: list[CategoryModule]) -> None:
    with refused(StaffCode.INVALID_STAFF_SCOPE):
        validate_scopes(scopes)


# -- hosted identities ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "email",
    [
        f"admin@{FIXTURE_EMAIL_DOMAIN}",
        "someone@corp.example",
        "someone@corp.test",
        "someone@corp.invalid",
        "someone@corp.localhost",
        "someone@localhost",
        "SOMEONE@Corp.TEST",
        "someone@corp.test.",
        "",
        "no-at-sign",
    ],
)
def test_reserved_and_fixture_addresses_are_refused(email: str) -> None:
    assert is_reserved_identity(email)


@pytest.mark.parametrize(
    "email",
    [
        "jane@portal.pk",
        "jane@example.org",  # an RFC 2606 second-level domain is not a reserved TLD
        "jane@testing.com",  # contains "test" but is not the .test TLD
        "jane@example.com.pk",
        "example@portal.pk",
    ],
)
def test_real_addresses_are_not_judged_by_a_substring(email: str) -> None:
    assert not is_reserved_identity(email)


# -- reasons --------------------------------------------------------------------------------------


def test_a_reason_is_normalised_and_bounded() -> None:
    assert clean_reason("  Rotating   credentials  now. ") == "Rotating credentials now."
    for bad in (None, "", "   ", "too short", "x" * 501):
        with refused(StaffCode.REASON_REQUIRED):
            clean_reason(bad)


# -- the count policy -----------------------------------------------------------------------------


def decide(before: int, *, ceiling: int = 3, override: bool = False, glass: bool = False):  # type: ignore[no-untyped-def]
    return decide_promotion(before, ceiling=ceiling, override_policy=override, break_glass=glass)


@pytest.mark.parametrize("before", [0, 1])
def test_up_to_the_normal_target_needs_no_flag(before: int) -> None:
    decision = decide(before)
    assert decision.new_count == before + 1 <= NORMAL_SUPER_ADMIN_TARGET
    assert not decision.policy_override_used and not decision.break_glass_used
    assert not decision.above_target


def test_the_third_needs_the_override_and_break_glass_also_satisfies_it() -> None:
    with refused(StaffCode.POLICY_OVERRIDE_REQUIRED):
        decide(2)
    with_override = decide(2, override=True)
    assert with_override.policy_override_used and not with_override.break_glass_used
    assert with_override.above_target and with_override.new_count == 3
    assert decide(2, glass=True).policy_override_used  # stronger flag, same effect


def test_above_the_ceiling_only_break_glass_works_and_override_is_not_enough() -> None:
    with refused(StaffCode.BREAK_GLASS_REQUIRED):
        decide(3)
    with refused(StaffCode.BREAK_GLASS_REQUIRED):
        decide(3, override=True)
    decision = decide(3, glass=True)
    assert decision.break_glass_used and decision.new_count == 4


def test_the_ceiling_is_configurable() -> None:
    with refused(StaffCode.BREAK_GLASS_REQUIRED):
        decide(2, ceiling=2, override=True)  # ceiling 2: the third is already beyond it
    assert decide(4, ceiling=6, override=True).new_count == 5


def test_a_flag_that_was_not_needed_is_not_recorded_as_used_except_for_recovery() -> None:
    assert not decide(1, glass=True).break_glass_used  # a normal promotion: break-glass unneeded
    assert decide(0, glass=True).break_glass_used  # recovery from zero IS recorded
    assert not decide(0).break_glass_used  # ...and recovery never NEEDS the flag


# -- settings -------------------------------------------------------------------------------------


def test_the_new_settings_have_the_frozen_defaults() -> None:
    config = build()
    assert (config.staff_sensitive_window_minutes, config.super_admin_safety_ceiling) == (15, 3)


def test_the_ceiling_cannot_be_below_the_normal_target() -> None:
    with pytest.raises(ValidationError):
        build(super_admin_safety_ceiling=1)


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_a_hosted_environment_refuses_a_weakened_sensitive_window(environment: str) -> None:
    with pytest.raises(ValidationError, match="STAFF_SENSITIVE_WINDOW_MINUTES"):
        build(environment=environment, staff_sensitive_window_minutes=16, **HOSTED)
    assert (
        build(
            environment=environment, staff_sensitive_window_minutes=5, **HOSTED
        ).staff_sensitive_window_minutes
        == 5
    )  # shortening is fine


def test_development_may_widen_the_window_for_local_work() -> None:
    assert build(staff_sensitive_window_minutes=60).staff_sensitive_window_minutes == 60


# -- the audit allow-list --------------------------------------------------------------------------


def test_the_audit_accepts_the_paused_and_policy_override_markers() -> None:
    cleaned = clean_state(
        {"role": "moderator", "scopes": ["food"], "paused": True, "policy_override": False}
    )
    assert cleaned == {
        "role": "moderator",
        "scopes": ["food"],
        "paused": True,
        "policy_override": False,
    }


# -- which providers can actually sign anyone in -----------------------------------------------------

REAL_GOOGLE: dict[str, Any] = {
    "google_oauth_provider": "google",
    "google_oauth_client_id": "client-id",
    "google_oauth_client_secret": "client-secret",
    "api_public_base_url": "http://127.0.0.1:8000",
}
LOGIN_CONFIGURATIONS: list[tuple[dict[str, Any], frozenset[AuthProvider]]] = [
    ({}, frozenset()),  # the default: Google sign-in is off
    ({"google_oauth_provider": "disabled"}, frozenset()),
    (
        {"google_oauth_provider": "fake", "api_public_base_url": "http://127.0.0.1:8000"},
        frozenset({AuthProvider.GOOGLE}),
    ),
    (REAL_GOOGLE, frozenset({AuthProvider.GOOGLE})),
]


@pytest.mark.parametrize(("overrides", "expected"), LOGIN_CONFIGURATIONS)
def test_the_enabled_login_providers_follow_the_configuration(
    overrides: dict[str, Any], expected: frozenset[AuthProvider]
) -> None:
    assert enabled_login_providers(build(**overrides)) == expected


@pytest.mark.parametrize(("overrides", "expected"), LOGIN_CONFIGURATIONS)
def test_the_enablement_rule_and_the_adapter_factory_can_never_disagree(
    overrides: dict[str, Any], expected: frozenset[AuthProvider]
) -> None:
    """The OAuth flow answers ``503`` for any provider outside ``create_oauth_providers``; the
    last-admin guard asks ``enabled_login_providers``. They must be the same set, always."""
    config = build(**overrides)
    assert frozenset(create_oauth_providers(config)) == enabled_login_providers(config) == expected


@pytest.mark.parametrize(("overrides", "expected"), LOGIN_CONFIGURATIONS)
def test_the_staff_policy_carries_the_providers_of_its_configuration(
    overrides: dict[str, Any], expected: frozenset[AuthProvider]
) -> None:
    policy = StaffPolicy.from_settings(build(**overrides))
    assert policy.login_providers == expected


def test_facebook_and_apple_are_never_login_providers() -> None:
    for overrides, _ in LOGIN_CONFIGURATIONS:
        providers = enabled_login_providers(build(**overrides))
        assert AuthProvider.FACEBOOK not in providers and AuthProvider.APPLE not in providers
