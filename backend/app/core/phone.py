"""Phone-number normalisation for LISTING CONTACT numbers (Listing Contact v1; API_CONTRACT.md
§10.11).

The ONE place a phone number is parsed, validated and canonicalised. Every write path (owner create,
owner PATCH) goes through :func:`normalize_phone`, so a stored number is always the same shape and
no second regex can drift from this one.

**Canonical stored form: E.164** — ``+`` then country code then the national significant number,
digits only (``+923001234567``). That is what the database holds and what every API response
returns; formatting for a human ("0300 1234567") is the reader's job, never storage.

**What a person may type** (B-17 is in Pakistan, so the national forms are the common case). Spaces,
dashes, dots, slashes, brackets and non-breaking spaces are ignored anywhere:

====================  ====================
typed                 stored
====================  ====================
``03001234567``       ``+923001234567``
``0300 123 4567``     ``+923001234567``
``+92 300 1234567``   ``+923001234567``
``923001234567``      ``+923001234567``
``0092 3001234567``   ``+923001234567``
``051 1234567``       ``+92511234567``   (an Islamabad landline)
====================  ====================

**Not Pakistan-only.** The rules are a generic E.164 parser plus two pieces of configuration:
:data:`DEFAULT_COUNTRY_CODE` (which country a national ``0...`` number belongs to) and
:data:`NATIONAL_LENGTHS` (how long a national number is, per country code, for the countries we can
state it for). An explicitly international number (``+...`` / ``00...``) of a country that is not in
that table is accepted on the generic E.164 rule alone, so supporting another country later is a
table entry, never a new parser.

**Nothing is invented.** A number that cannot be read as one of the forms above is REFUSED
(``invalid_phone``); it is never guessed at, truncated or partially repaired. There is no fallback
to any account-level number: a listing's contact number is listing data (``DATA_MODEL.md §19``).
"""

import re

#: The country a national (leading-zero) number belongs to, without the ``+``. Configuration, not a
#: rule: changing it changes which country ``0300...`` means.
DEFAULT_COUNTRY_CODE = "92"

#: Length of the NATIONAL significant number (what follows the country code), per country code, for
#: the countries whose plan we state. Pakistan: 10 digits for a mobile (``3xx xxxxxxx``) and 9 or 10
#: for a landline (``51 xxxxxxx`` Islamabad, ``21 xxxxxxxx`` Karachi). A country code absent from
#: this table is checked against the generic E.164 length only.
NATIONAL_LENGTHS: dict[str, frozenset[int]] = {"92": frozenset({9, 10})}

#: Longest raw input accepted (``+92 (300) 123-4567`` with room to spare); the schema caps it too.
MAX_RAW_LENGTH = 24

#: Characters a person may use as separators; they carry no meaning and are dropped.
_SEPARATORS = str.maketrans({character: None for character in " \t-.()[]/\u00a0\u2013\u2014"})
#: E.164: a non-zero country-code digit, then 7 to 14 more digits (8 to 15 digits in total).
_E164 = re.compile(r"^[1-9][0-9]{7,14}$")


def normalize_phone(raw: str) -> str | None:
    """``raw`` as E.164 (``+923001234567``), or ``None`` if it cannot be read as a phone number.

    Pure: no I/O, no clock, no settings lookup — so the schema, the services and the tests
    all agree.
    """
    if not raw or len(raw) > MAX_RAW_LENGTH:
        return None
    compact = raw.translate(_SEPARATORS)
    if not compact:
        return None

    if compact.startswith("+"):
        digits = compact[1:]
    elif compact.startswith("00"):  # the other way to write "+"
        digits = compact[2:]
    elif compact.startswith("0"):  # national: one leading 0 stands for the country code
        digits = DEFAULT_COUNTRY_CODE + compact[1:]
    else:
        digits = compact  # already country code first ("923001234567")
    if not digits.isdigit() or not _E164.match(digits):
        return None

    for code, lengths in NATIONAL_LENGTHS.items():
        if digits.startswith(code):
            if len(digits) - len(code) not in lengths:
                return None
            break
    return f"+{digits}"
