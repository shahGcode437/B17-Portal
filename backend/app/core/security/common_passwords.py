"""The offline common-password denylist (docs/backend/AUTH_RBAC.md §7.3).

The corpus is the SecLists ``10k-most-common.txt`` file, stored byte-identical in ``data/`` with its
provenance, pinned commit, checksum and MIT license (``data/README.md``). It is read from the
installed package on first use — **never over the network** — and each entry is normalized exactly
like a candidate password (NFKC, then case-fold) so the lookup compares like with like.

Nothing is added to or removed from the upstream list in code. (With a 10-character minimum only
the corpus' longer entries can ever be the deciding reason; shorter ones are already rejected by the
length rule.)
"""

import unicodedata
from functools import lru_cache
from importlib import resources

CORPUS_FILE = "10k-most-common.txt"


def fold(value: str) -> str:
    """The comparison form used for both corpus entries and candidate passwords."""
    return unicodedata.normalize("NFKC", value).casefold()


@lru_cache(maxsize=1)
def common_passwords() -> frozenset[str]:
    """The folded corpus (loaded once per process)."""
    text = resources.files("app.core.security").joinpath("data", CORPUS_FILE).read_text("utf-8")
    return frozenset(entry for line in text.splitlines() if (entry := fold(line.strip())))


def is_common_password(password: str) -> bool:
    """Is the (NFKC-normalized, case-folded) password in the corpus?"""
    return fold(password) in common_passwords()
