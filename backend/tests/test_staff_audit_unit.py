"""RBAC-A, DB-free: the rules of the staff audit writer (docs/backend/AUTH_RBAC.md §27.11).

What may be written is decided here, before any row exists: a closed vocabulary, an allow-listed
payload (an unapproved or secret-looking key is REFUSED, loudly, naming the key and never the value),
a normalized bounded reason, and a web action that always has an actor.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.models.enums import (
    CategoryModule,
    RoleName,
    StaffAuditAction,
    StaffAuditResource,
    StaffAuditSource,
)
from app.models.staff import REASON_REQUIRED_ACTIONS
from app.services.staff_audit import (
    ALLOWED_STATE_KEYS,
    FORBIDDEN_KEY_FRAGMENTS,
    StaffAuditError,
    StaffAuditService,
    _has_forbidden_fragment,
    clean_reason,
    clean_state,
)

REASON = "Approved as the only available reviewer."
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def service() -> StaffAuditService:
    """A writer over an unbound session: every refusal below happens before the database is used."""
    return StaffAuditService(Session(), lambda: NOW)


# -- the payload allow-list -------------------------------------------------------------------------


def test_no_allowed_key_looks_like_a_secret() -> None:
    assert not [key for key in ALLOWED_STATE_KEYS if _has_forbidden_fragment(key)]


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "password_hash",
        "new_password",
        "session_token",
        "token",
        "csrf_token",
        "cookie",
        "Set-Cookie",
        "oauth_code",
        "client_secret",
        "authorization",
        "api_key",
        "credential",
        "hash",
    ],
)
def test_a_secret_looking_key_can_never_be_written(key: str) -> None:
    with pytest.raises(StaffAuditError) as refused:
        clean_state({key: "anything"})

    assert key in str(refused.value)
    assert "anything" not in str(refused.value)  # the error names the key, never the value


def test_the_independent_secret_guard_holds_even_if_the_allow_list_were_widened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two separate guards: adding a secret-looking key to the allow-list still does not let it in."""
    monkeypatch.setattr(
        "app.services.staff_audit.ALLOWED_STATE_KEYS", ALLOWED_STATE_KEYS | {"api_token"}
    )

    with pytest.raises(StaffAuditError):
        clean_state({"api_token": "x"})


def test_forbidden_fragments_cover_every_credential_family_named_in_the_design() -> None:
    for family in ("password", "token", "cookie", "oauth", "secret", "hash", "csrf"):
        assert family in FORBIDDEN_KEY_FRAGMENTS


def test_an_unapproved_key_is_refused_not_silently_dropped() -> None:
    with pytest.raises(StaffAuditError, match="'email'"):
        clean_state({"role": "moderator", "email": "someone@example.org"})


def test_an_allowed_payload_is_kept_and_made_json_safe() -> None:
    parent = uuid.uuid4()

    cleaned = clean_state(
        {
            "role": RoleName.MODERATOR,
            "scopes": [CategoryModule.FOOD, CategoryModule.DIRECTORY],
            "sessions_revoked": 3,
            "break_glass": False,
            "parent_id": parent,
            "status": None,
        }
    )

    assert cleaned == {
        "role": "moderator",
        "scopes": ["food", "directory"],
        "sessions_revoked": 3,
        "break_glass": False,
        "parent_id": str(parent),
        "status": None,
    }
    assert all(type(v) is not RoleName for v in cleaned.values())  # plain strings, not enums


def test_no_payload_is_none_and_an_empty_one_is_empty() -> None:
    assert clean_state(None) is None
    assert clean_state({}) == {}


@pytest.mark.parametrize(
    "value",
    [
        {"nested": "blob"},  # no nested objects
        object(),
        3.5,  # no floats
        "x" * 121,  # a value is short
        "line one\nline two",  # plain, printable text only
        ["a"] * 13,  # a list is short
        ["x" * 41],  # and so is each item
        [{"a": 1}],
    ],
)
def test_only_short_plain_scalars_and_short_lists_of_them_are_accepted(value: Any) -> None:
    with pytest.raises(StaffAuditError):
        clean_state({"name": value})


# -- reasons ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("action", REASON_REQUIRED_ACTIONS)
def test_the_actions_that_demand_a_reason_cannot_be_written_without_one(
    action: StaffAuditAction,
) -> None:
    with pytest.raises(StaffAuditError, match="reason is required"):
        clean_reason(action, None)


def test_the_reason_required_set_is_the_frozen_one() -> None:
    assert set(REASON_REQUIRED_ACTIONS) == {
        StaffAuditAction.SUPER_ADMIN_PROMOTED,
        StaffAuditAction.SUPER_ADMIN_DEMOTED,
        StaffAuditAction.MODERATION_SELF_OVERRIDE,
    }


def test_an_optional_reason_may_be_absent_but_never_malformed() -> None:
    assert clean_reason(StaffAuditAction.SCOPE_GRANTED, None) is None
    with pytest.raises(StaffAuditError, match="at least"):
        clean_reason(StaffAuditAction.SCOPE_GRANTED, "short")


def test_a_reason_is_normalized_like_a_rejection_reason() -> None:
    messy = "  The   only\treviewer\r\n\r\n\r\n\r\n available   today.  "

    assert (
        clean_reason(StaffAuditAction.MODERATION_SELF_OVERRIDE, messy)
        == "The only reviewer\n\navailable today."
    )


def test_a_reason_has_a_minimum_and_a_maximum() -> None:
    with pytest.raises(StaffAuditError, match="at least 10"):
        clean_reason(StaffAuditAction.SUPER_ADMIN_PROMOTED, "too short")
    with pytest.raises(StaffAuditError, match="at most"):
        clean_reason(StaffAuditAction.SUPER_ADMIN_PROMOTED, "x" * 501)
    assert clean_reason(StaffAuditAction.SUPER_ADMIN_PROMOTED, "x" * 10) == "x" * 10


# -- the closed vocabulary and the writer's own refusals --------------------------------------------


def test_the_audit_vocabulary_is_the_frozen_one() -> None:
    assert {action.value for action in StaffAuditAction} == {
        "moderator_appointed",
        "moderator_paused",
        "moderator_removed",
        "scope_granted",
        "scope_revoked",
        "super_admin_promoted",
        "super_admin_demoted",
        "moderation_self_override",
        "provider_created",
        "provider_updated",
        "provider_archived",
        "taxonomy_created",
        "taxonomy_updated",
        "taxonomy_reordered",
    }
    assert {s.value for s in StaffAuditSource} == {"web", "cli"}
    assert {r.value for r in StaffAuditResource} == {"listing", "category"}


def test_an_unsupported_action_is_rejected() -> None:
    with pytest.raises(StaffAuditError, match="unsupported staff audit action"):
        service().record(
            "deleted_everything",  # type: ignore[arg-type]
            source=StaffAuditSource.CLI,
        )


def test_an_unsupported_source_is_rejected() -> None:
    with pytest.raises(StaffAuditError, match="unsupported staff audit source"):
        service().record(
            StaffAuditAction.SCOPE_GRANTED,
            source="telepathy",  # type: ignore[arg-type]
            actor_user_id=uuid.uuid4(),
        )


def test_a_web_action_always_has_an_actor() -> None:
    with pytest.raises(StaffAuditError, match="needs an actor"):
        service().record(StaffAuditAction.SCOPE_GRANTED, source=StaffAuditSource.WEB)


def test_a_resource_type_and_id_go_together() -> None:
    with pytest.raises(StaffAuditError, match="go together"):
        service().record(
            StaffAuditAction.TAXONOMY_CREATED,
            source=StaffAuditSource.WEB,
            actor_user_id=uuid.uuid4(),
            resource_type=StaffAuditResource.CATEGORY,
        )
    with pytest.raises(StaffAuditError, match="go together"):
        service().record(
            StaffAuditAction.TAXONOMY_CREATED,
            source=StaffAuditSource.WEB,
            actor_user_id=uuid.uuid4(),
            resource_id=uuid.uuid4(),
        )
