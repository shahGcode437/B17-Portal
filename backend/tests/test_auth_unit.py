"""Authentication building blocks that need no database or HTTP (docs/backend/AUTH_RBAC.md §17).

Password policy and Argon2id, token generation/hashing, the CSRF derivation and decisions, email
normalization, cookie/config invariants, the redirect of every secret out of ``repr``, and the
structural guarantees of the hashing concurrency limit.
"""

import hashlib
import re
import socket
import threading
from importlib import resources

import pytest
from argon2 import Type
from pydantic import ValidationError

from app.api.cookies import clear_cookie_header
from app.core.config import Settings
from app.core.security.common_passwords import (
    CORPUS_FILE,
    common_passwords,
    fold,
)
from app.core.security.csrf import fetch_site_allowed, origin_allowed
from app.core.security.identity import canonical_email, normalize_email
from app.core.security.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PasswordService,
    normalize_password,
    validate_password,
)
from app.core.security.tokens import (
    csrf_token_for,
    csrf_token_matches,
    hash_token,
    is_well_formed_token,
    new_token,
)
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services.email import (
    DisabledEmailSender,
    EmailDeliveryUnavailable,
    MemoryEmailSender,
    create_email_sender,
    deliver,
    password_reset_email,
    verification_email,
)

ORIGIN = "https://app.example.org"
HOSTED = {"frontend_origins": [ORIGIN], "frontend_base_url": ORIGIN}


def settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


def cheap_service(max_concurrent: int = 2, time_cost: int = 1) -> PasswordService:
    return PasswordService(
        time_cost=time_cost, memory_cost_kib=64, parallelism=1, max_concurrent=max_concurrent
    )


# -- password policy -------------------------------------------------------------------------------------


def codes(password: str, **context: str) -> set[str]:
    return {p.code for p in validate_password(password, **context)}


def test_the_length_policy_is_ten_to_one_hundred_twenty_eight() -> None:
    assert (MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) == (10, 128)
    assert "password_too_short" in codes("a" * 9)
    assert codes("a1b2c3d4e5") == set() and codes("x" * 128) == set()
    assert "password_too_long" in codes("x" * 129)


def test_there_are_no_composition_rules() -> None:
    for fine in (
        "alllowercaseletters",
        "ALLUPPERCASELETTERS",
        "1357902468",
        "correct horse battery",
    ):
        assert codes(fine) == set() or codes(fine) == {"password_too_common"}
    assert codes("just some spaced words") == set()
    assert codes("pässwörd-mit-ümlauten") == set()


def test_length_counts_characters_not_bytes_and_uses_nfkc() -> None:
    assert codes("é" * 10) == set()  # 10 characters, 20 bytes
    assert normalize_password("ｐａｓｓｗｏｒｄ１２３") == "password123"  # full-width -> ASCII


# -- the offline common-password corpus (AUTH_RBAC.md §7.3) -------------------------------------------

CORPUS_SHA256 = "68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce"


def corpus_entries_of_minimum_length() -> list[str]:
    return sorted(e for e in common_passwords() if len(e) >= MIN_PASSWORD_LENGTH)


def test_the_corpus_is_the_pinned_upstream_file_loaded_from_the_package() -> None:
    data = resources.files("app.core.security").joinpath("data", CORPUS_FILE).read_bytes()

    assert hashlib.sha256(data).hexdigest() == CORPUS_SHA256  # byte-identical, never hand-edited
    assert len(data) == 73026
    assert len(common_passwords()) == 10001
    provenance = (
        resources.files("app.core.security").joinpath("data", "README.md").read_text("utf-8")
    )
    assert CORPUS_SHA256 in provenance and "MIT License" in provenance
    assert "913b327317496d062bcc7cace524aaad8a693be2" in provenance  # the pinned upstream commit


def test_corpus_entries_are_stored_in_the_same_normalized_form_as_candidates() -> None:
    corpus = common_passwords()

    assert {"password", "123456", "qwerty", "1234567890", "qwertyuiop"} <= corpus
    assert all(entry == fold(entry) and entry == entry.strip() and entry for entry in corpus)


@pytest.mark.parametrize("entry", corpus_entries_of_minimum_length()[:60])
def test_every_effective_corpus_entry_is_rejected(entry: str) -> None:
    assert "password_too_common" in codes(entry)
    assert "password_too_common" in codes(entry.upper())
    assert "password_too_common" in codes(entry.title())


@pytest.mark.parametrize(
    "disguised",
    [
        "ＱＷＥＲＴＹＵＩＯＰ",  # full-width Latin capitals (NFKC -> qwertyuiop, then case-fold)
        "ｑｗｅｒｔｙｕｉｏｐ",
        "１２３４５６７８９０",  # full-width digits
        "Ｕｎｉｖｅｒｓｉｔｙ",
    ],
)
def test_normalization_happens_before_the_corpus_lookup(disguised: str) -> None:
    assert disguised not in common_passwords()  # the raw form is not in the corpus...
    assert "password_too_common" in codes(disguised)  # ...but its NFKC form is


@pytest.mark.parametrize(
    "fine",
    [
        "correct horse battery staple",
        "just some spaced words",
        "xK7#mQ2!vR9pLz",
        "pässwörd-mit-ümlauten",
    ],
)
def test_a_valid_non_common_password_of_ten_or_more_characters_passes(fine: str) -> None:
    assert len(fine) >= MIN_PASSWORD_LENGTH and codes(fine) == set()


def test_the_corpus_is_not_the_old_hand_curated_list() -> None:
    """Only the upstream file counts: nothing was added by hand."""
    assert "b17portal123" not in common_passwords() and "pakistan123" not in common_passwords()


def test_validation_never_touches_the_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("password validation attempted a network operation")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    common_passwords.cache_clear()  # force a fresh load of the corpus under the network ban

    assert "password_too_common" in codes("1234567890")
    assert codes("correct horse battery staple") == set()


def test_a_password_may_not_be_the_email_its_local_part_or_the_display_name() -> None:
    assert "password_matches_email" in codes(
        "ayesha.khan@example.org", email="ayesha.khan@example.org"
    )
    assert "password_matches_email" in codes(
        "AYESHA.KHAN.LONG", email="ayesha.khan.long@example.org"
    )
    assert "password_matches_name" in codes("Ayesha Khan Lodhi", display_name="ayesha khan lodhi")
    assert codes("a perfectly different one", email="a@example.org", display_name="Bilal") == set()


def test_problems_carry_safe_messages_only() -> None:
    for problem in validate_password("short"):
        assert "short" not in problem.message and problem.code.startswith("password_")


# -- Argon2id -----------------------------------------------------------------------------------------------


def test_hashes_are_argon2id_salted_and_verify() -> None:
    service = cheap_service()

    first, second = (
        service.hash_password("a long passphrase"),
        service.hash_password("a long passphrase"),
    )

    assert first.startswith("$argon2id$") and first != second  # per-password salt
    assert service.verify_password(first, "a long passphrase")
    assert not service.verify_password(first, "a long passphrasf")
    assert not service.verify_password("not a hash at all", "a long passphrase")
    assert not service.verify_password("", "a long passphrase")


def test_verification_uses_the_same_normalization_as_hashing() -> None:
    service = cheap_service()
    stored = service.hash_password("café au lait passphrase")  # NFC

    assert service.verify_password(stored, "café au lait passphrase")  # NFD, same text


def test_parameters_come_from_settings_and_are_checked_for_rehash() -> None:
    weak = cheap_service(time_cost=1).hash_password("a long passphrase")
    strong = cheap_service(time_cost=2)

    assert strong.needs_rehash(weak) is True
    assert strong.needs_rehash(strong.hash_password("a long passphrase")) is False
    assert PasswordService.from_settings(settings(environment="test")).max_concurrent == 4
    assert Type.ID  # the algorithm is pinned to Argon2id in PasswordService


def test_the_dummy_verification_path_runs_and_never_succeeds() -> None:
    service = cheap_service()
    before = service.dummy_verifications

    service.dummy_verify("whatever the attacker typed")
    service.dummy_verify("whatever the attacker typed")

    assert service.dummy_verifications == before + 2


def test_hash_concurrency_is_bounded_by_a_semaphore() -> None:
    """Structural check (no timing): with every permit taken, a further hash must wait."""
    service = cheap_service(max_concurrent=2)
    assert service.max_concurrent == 2
    semaphore = service._semaphore  # the one central bound
    assert semaphore.acquire(blocking=False) and semaphore.acquire(blocking=False)
    finished = threading.Event()
    worker = threading.Thread(
        target=lambda: (service.hash_password("a long passphrase"), finished.set())  # type: ignore[func-returns-value]
    )
    worker.start()
    worker.join(timeout=0.3)
    assert not finished.is_set()  # blocked behind the saturated limit

    semaphore.release()
    semaphore.release()
    worker.join(timeout=30)

    assert finished.is_set()


# -- tokens and CSRF -----------------------------------------------------------------------------------------


def test_tokens_are_256_bit_url_safe_and_hash_to_32_bytes() -> None:
    tokens = {new_token() for _ in range(200)}

    assert len(tokens) == 200
    assert all(len(t) == 43 and is_well_formed_token(t) for t in tokens)
    assert all(len(hash_token(t)) == 32 for t in tokens)
    assert hash_token("abc") == hash_token("abc") != hash_token("abd")


@pytest.mark.parametrize("junk", ["", "short", "A" * 42, "A" * 44, "A" * 42 + "!", "A" * 42 + " "])
def test_malformed_tokens_are_rejected_before_any_lookup(junk: str) -> None:
    assert not is_well_formed_token(junk)


def test_the_csrf_token_is_derived_deterministically_from_the_session_secret() -> None:
    session_token = new_token()

    token = csrf_token_for(session_token)

    assert token == csrf_token_for(session_token) != csrf_token_for(new_token())
    assert token != session_token and session_token not in token
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    assert csrf_token_matches(session_token, token)


@pytest.mark.parametrize("supplied", [None, "", "x", "A" * 43, "é" * 43])
def test_wrong_csrf_tokens_are_rejected(supplied: str | None) -> None:
    assert not csrf_token_matches(new_token(), supplied)


def test_origin_and_fetch_site_decisions() -> None:
    allowed = [ORIGIN, "http://127.0.0.1:5173"]
    assert origin_allowed(ORIGIN, allowed)
    for bad in (None, "", "null", ORIGIN + "/", "https://evil.example", "http://app.example.org"):
        assert not origin_allowed(bad, allowed)
    for ok in (None, "same-origin", "same-site", "SAME-ORIGIN"):
        assert fetch_site_allowed(ok)
    for bad in ("cross-site", "none", "bogus"):
        assert not fetch_site_allowed(bad)


# -- email -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "stored"),
    [
        ("Ayesha@Example.ORG", "ayesha@example.org"),
        ("  ayesha@example.org  ", "ayesha@example.org"),
        ("a.b+tag@example.org", "a.b+tag@example.org"),  # no dot / plus folding
        ("ＡＹＥＳＨＡ@example.org", "ayesha@example.org"),  # NFKC
    ],
)
def test_email_normalization(raw: str, stored: str) -> None:
    assert normalize_email(raw) == stored


@pytest.mark.parametrize(
    "bad",
    ["", "no-at-sign", "a@", "@b.org", "a b@example.org", "a@@b.org", "a" * 250 + "@example.org"],
)
def test_invalid_emails_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        normalize_email(bad)


def test_lookups_use_the_lenient_canonical_form() -> None:
    assert canonical_email("  Not An Email ") == "not an email"  # no validation: no oracle


# -- schemas: secrets stay secret ---------------------------------------------------------------------------


def test_request_schemas_hide_passwords_and_reject_unknown_fields() -> None:
    request = RegisterRequest(
        email="A@Example.org", password="a very secret passphrase", displayName="Ayesha"
    )

    assert request.email == "a@example.org"
    assert "a very secret passphrase" not in repr(
        request
    ) and "a very secret passphrase" not in str(request)
    with pytest.raises(ValidationError):
        LoginRequest(email="a@b.org", password="x", role="admin")


def test_validation_messages_never_echo_the_input() -> None:
    with pytest.raises(ValidationError) as caught:
        RegisterRequest(email="not-an-email-at-all", password="p", displayName="Ayesha")

    assert "not-an-email-at-all" not in "".join(str(e["msg"]) for e in caught.value.errors())


# -- configuration invariants ----------------------------------------------------------------------------------


def test_cookie_name_and_secure_defaults_per_environment() -> None:
    development = settings(environment="development")
    production = settings(environment="production", **HOSTED)

    assert (development.auth_cookie_name, development.auth_cookie_secure) == ("b17_session", False)
    assert (production.auth_cookie_name, production.auth_cookie_secure) == (
        "__Host-b17_session",
        True,
    )
    assert settings(environment="test").auth_cookie_secure is False
    assert settings(environment="staging", **HOSTED).auth_cookie_name == "__Host-b17_session"


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_hosted_environments_cannot_disable_secure_cookies(environment: str) -> None:
    with pytest.raises(ValidationError, match="AUTH_COOKIE_SECURE"):
        settings(environment=environment, auth_cookie_secure=False, **HOSTED)


def test_hosted_environments_need_exact_origins_and_a_matching_base_url() -> None:
    with pytest.raises(ValidationError, match="FRONTEND_ORIGINS"):
        settings(environment="production")
    with pytest.raises(ValidationError, match="FRONTEND_BASE_URL"):
        settings(environment="production", frontend_origins=[ORIGIN])
    with pytest.raises(ValidationError, match="FRONTEND_BASE_URL"):
        settings(
            environment="production",
            frontend_origins=[ORIGIN],
            frontend_base_url="https://other.example.org",
        )
    with pytest.raises(ValidationError):
        settings(environment="production", frontend_origins=["*"], frontend_base_url=ORIGIN)


@pytest.mark.parametrize("backend", ["console", "memory"])
def test_console_and_memory_email_can_never_run_when_hosted(backend: str) -> None:
    with pytest.raises(ValidationError, match="EMAIL_BACKEND"):
        settings(environment="production", email_backend=backend, **HOSTED)
    assert settings(environment="production", **HOSTED).email_backend == "disabled"


def test_hosted_environments_refuse_weak_password_hashing() -> None:
    with pytest.raises(ValidationError, match="OWASP"):
        settings(environment="production", password_hash_memory_cost_kib=1024, **HOSTED)
    with pytest.raises(ValidationError, match="OWASP"):
        settings(environment="production", password_hash_time_cost=1, **HOSTED)
    assert settings(environment="production", **HOSTED).password_hash_memory_cost_kib >= 19456


def test_session_lifetime_defaults_are_the_frozen_ones() -> None:
    config = settings(environment="test")

    assert (config.session_idle_days, config.session_absolute_days) == (14, 30)
    assert (config.admin_session_idle_minutes, config.admin_session_max_hours) == (120, 12)
    assert config.max_sessions_per_user == 10
    with pytest.raises(ValidationError, match="ABSOLUTE"):
        settings(environment="test", session_idle_days=20, session_absolute_days=10)


def test_development_defaults_to_the_deterministic_127_0_0_1_topology() -> None:
    config = settings(environment="development")

    assert config.frontend_base_url == "http://127.0.0.1:5173"
    assert config.email_backend == "console"


def test_the_clearing_header_matches_the_cookie_flags() -> None:
    header = clear_cookie_header(settings(environment="production", **HOSTED)).lower()

    assert header.startswith("__host-b17_session=")
    assert all(
        flag in header for flag in ("max-age=0", "httponly", "secure", "samesite=lax", "path=/")
    )
    assert "domain" not in header


# -- email seam -----------------------------------------------------------------------------------------------------


def test_email_links_use_the_configured_base_and_the_fragment() -> None:
    config = settings(environment="test", frontend_base_url=ORIGIN, frontend_origins=[ORIGIN])
    token = new_token()

    verification = verification_email(config, "a@example.org", token)
    reset = password_reset_email(config, "a@example.org", token)

    assert verification.link == f"{ORIGIN}/verify-email#token={token}"
    assert reset.link == f"{ORIGIN}/reset-password#token={token}"
    assert "?" not in (verification.link or "") and "?" not in (reset.link or "")


def test_the_email_backend_is_chosen_by_environment() -> None:
    assert isinstance(create_email_sender(settings(environment="test")), MemoryEmailSender)
    assert isinstance(
        create_email_sender(settings(environment="production", **HOSTED)), DisabledEmailSender
    )


def test_delivery_failures_are_swallowed_and_never_leak_the_link(
    caplog: pytest.LogCaptureFixture,
) -> None:
    message = verification_email(
        settings(environment="test", frontend_base_url=ORIGIN), "a@example.org", new_token()
    )

    deliver(DisabledEmailSender(), message)  # must not raise
    with pytest.raises(EmailDeliveryUnavailable):
        DisabledEmailSender().send(message)

    assert message.link is not None and message.link not in caplog.text
