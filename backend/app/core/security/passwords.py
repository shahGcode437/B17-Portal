"""Password policy and Argon2id hashing (docs/backend/AUTH_RBAC.md §7.3).

Everything about passwords lives here so there is one place to read and one place to tune:

* **Policy** — length-based (10-128 Unicode code points after NFKC normalization), a bundled
  denylist, and "not the email / its local part / the display name". No composition rules.
* **Hashing** — Argon2id through ``argon2-cffi``. Parameters come from ``Settings`` (defaults follow
  RFC 9106's low-memory profile) and are used only by :class:`PasswordService`. PHC hash strings
  carry their own parameters, so verification keeps working when the parameters change, and
  :meth:`PasswordService.needs_rehash` tells the login flow to upgrade a stored hash.
* **Bounded concurrency** — hashing is CPU- and memory-heavy and the API is synchronous
  (threadpool). A process-wide bounded semaphore limits simultaneous hashes so a burst of logins
  cannot exhaust memory.
* **Dummy verification** — logins for unknown or password-less accounts still pay for one Argon2
  verification (:meth:`PasswordService.dummy_verify`).

Passwords are never logged and hashes are never returned.
"""

import threading
import unicodedata
from dataclasses import dataclass

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings
from app.core.security.common_passwords import is_common_password

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 128


@dataclass(frozen=True)
class PasswordProblem:
    """One policy violation: a stable ``code`` and a safe, user-facing ``message``."""

    code: str
    message: str


def normalize_password(password: str) -> str:
    """NFKC-normalize. Whitespace is significant and is never trimmed."""
    return unicodedata.normalize("NFKC", password)


def validate_password(
    password: str, *, email: str | None = None, display_name: str | None = None
) -> list[PasswordProblem]:
    """Check the password policy. ``email`` / ``display_name`` are the normalized account values."""
    candidate = normalize_password(password)
    folded = candidate.casefold()
    problems: list[PasswordProblem] = []
    if len(candidate) < MIN_PASSWORD_LENGTH:
        problems.append(
            PasswordProblem("password_too_short", f"Use at least {MIN_PASSWORD_LENGTH} characters.")
        )
    if len(candidate) > MAX_PASSWORD_LENGTH:
        problems.append(
            PasswordProblem("password_too_long", f"Use at most {MAX_PASSWORD_LENGTH} characters.")
        )
    if is_common_password(candidate):
        problems.append(
            PasswordProblem("password_too_common", "That password is too common. Choose another.")
        )
    if email:
        normalized_email = email.casefold()
        if folded in {normalized_email, normalized_email.split("@", 1)[0]}:
            problems.append(
                PasswordProblem("password_matches_email", "The password must not be your email.")
            )
    if display_name and folded == normalize_password(display_name).strip().casefold():
        problems.append(
            PasswordProblem("password_matches_name", "The password must not be your name.")
        )
    return problems


class PasswordService:
    """Argon2id hashing with centrally configured parameters and bounded concurrency."""

    def __init__(
        self,
        *,
        time_cost: int,
        memory_cost_kib: int,
        parallelism: int,
        max_concurrent: int,
    ) -> None:
        self._hasher = PasswordHasher(
            time_cost=time_cost,
            memory_cost=memory_cost_kib,
            parallelism=parallelism,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )
        self._semaphore = threading.BoundedSemaphore(max_concurrent)
        self._max_concurrent = max_concurrent
        self._dummy_hash: str | None = None
        self._dummy_lock = threading.Lock()
        #: How many times the dummy path ran (observable in tests; not security-relevant).
        self.dummy_verifications = 0

    @classmethod
    def from_settings(cls, settings: Settings) -> "PasswordService":
        return cls(
            time_cost=settings.password_hash_time_cost,
            memory_cost_kib=settings.password_hash_memory_cost_kib,
            parallelism=settings.password_hash_parallelism,
            max_concurrent=settings.max_concurrent_password_hashes,
        )

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    def hash_password(self, password: str) -> str:
        """Argon2id PHC string for ``password`` (NFKC-normalized first)."""
        with self._semaphore:
            return self._hasher.hash(normalize_password(password))

    def verify_password(self, stored_hash: str, password: str) -> bool:
        """True iff ``password`` matches ``stored_hash``. Never raises for a bad hash/mismatch."""
        with self._semaphore:
            try:
                return self._hasher.verify(stored_hash, normalize_password(password))
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                return False

    def needs_rehash(self, stored_hash: str) -> bool:
        """True when the stored hash uses weaker/older parameters than the configured ones."""
        return self._hasher.check_needs_rehash(stored_hash)

    def dummy_verify(self, password: str) -> None:
        """Spend one Argon2 verification on a throw-away hash (unknown / password-less account)."""
        with self._dummy_lock:
            if self._dummy_hash is None:
                with self._semaphore:
                    self._dummy_hash = self._hasher.hash("dummy-password-for-timing-only")
            dummy = self._dummy_hash
        self.dummy_verifications += 1
        self.verify_password(dummy, password)
