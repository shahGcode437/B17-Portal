"""The listing-contact phone parser (Listing Contact v1), DB-free: ``app.core.phone``.

The ONE place a number is read and canonicalised, so these cases are the contract the schema, the
services, the fixtures and the frontend's mirror of this parser all have to agree with.
"""

import pytest

from app.core.phone import (
    DEFAULT_COUNTRY_CODE,
    MAX_RAW_LENGTH,
    NATIONAL_LENGTHS,
    normalize_phone,
)

#: What a person in B-17 might type -> what is stored.
ACCEPTED = [
    # the national mobile form, with every separator style people use
    ("03001234567", "+923001234567"),
    ("0300 1234567", "+923001234567"),
    ("0300 123 4567", "+923001234567"),
    ("0300-123-4567", "+923001234567"),
    ("0300.123.4567", "+923001234567"),
    ("(0300) 123 4567", "+923001234567"),
    ("0300/1234567", "+923001234567"),
    ("  03001234567  ", "+923001234567"),
    # already international
    ("+923001234567", "+923001234567"),
    ("+92 300 1234567", "+923001234567"),
    ("+92-300-1234567", "+923001234567"),
    ("923001234567", "+923001234567"),
    ("92 300 1234567", "+923001234567"),
    ("0092 3001234567", "+923001234567"),
    ("00923001234567", "+923001234567"),
    # Islamabad (B-17's own city) and Karachi landlines: 9 and 10 national digits
    ("051 1234567", "+92511234567"),
    ("0511234567", "+92511234567"),
    ("+92 51 1234567", "+92511234567"),
    ("021 12345678", "+922112345678"),
    # a non-breaking space and an en dash, as a copy-paste from a web page brings them
    ("0300\u00a01234567", "+923001234567"),
    ("0300\u20131234567", "+923001234567"),
]

REFUSED = [
    "",
    "   ",
    "abc",
    "0300123",  # too short for a national number
    "03001234",  # still too short
    "030012345678",  # one digit too many
    "0300123456789012",  # far too many
    "12345",
    "0",
    "+",
    "++923001234567",
    "+0300123456",  # a country code may not start with 0
    "0300 1234 567x",  # a letter anywhere
    "03OO1234567",  # letters that look like digits
    "+92 1",
    "tel:03001234567",
    "0300,1234567",  # a comma is not a separator we accept
    "<script>03001234567</script>",
]


@pytest.mark.parametrize(("raw", "stored"), ACCEPTED)
def test_the_forms_people_type_are_stored_as_one_canonical_number(raw: str, stored: str) -> None:
    assert normalize_phone(raw) == stored


@pytest.mark.parametrize("raw", REFUSED)
def test_what_cannot_be_read_as_a_number_is_refused_and_never_repaired(raw: str) -> None:
    assert normalize_phone(raw) is None


def test_normalising_is_idempotent() -> None:
    """The stored form is a fixed point: an edit that resends it changes nothing."""
    for _, stored in ACCEPTED:
        assert normalize_phone(stored) == stored


def test_input_longer_than_the_cap_is_refused_whatever_it_contains() -> None:
    padded = "+92 300 1234567" + " " * MAX_RAW_LENGTH
    assert len(padded) > MAX_RAW_LENGTH
    assert normalize_phone(padded) is None
    # ... and the cap is applied to the RAW text, so a value right at the limit still works.
    assert normalize_phone("+92 (300) 123-4567") == "+923001234567"


def test_the_result_is_always_e164_digits_only() -> None:
    for raw, _ in ACCEPTED:
        stored = normalize_phone(raw)
        assert stored is not None
        assert stored.startswith("+") and stored[1:].isdigit()
        assert 8 <= len(stored[1:]) <= 15  # E.164


def test_a_country_outside_the_length_table_is_accepted_on_the_generic_e164_rule() -> None:
    """Internationalisation is a table entry, not a rewrite: an explicitly international number of a
    country we state no plan for is accepted if it is valid E.164 at all."""
    assert "1" not in NATIONAL_LENGTHS  # we make no claim about US numbers
    assert normalize_phone("+1 555 0100") == "+15550100"
    assert normalize_phone("+44 20 7946 0958") == "+442079460958"
    # The national (leading-zero) form still belongs to the configured country, and nothing else.
    assert DEFAULT_COUNTRY_CODE == "92"
    assert normalize_phone("03001234567") == f"+{DEFAULT_COUNTRY_CODE}3001234567"


def test_the_pakistani_national_length_rule_is_what_rejects_short_numbers() -> None:
    """Without it, `0300123` would pass the generic E.164 rule as `+92300123` (8 digits)."""
    assert NATIONAL_LENGTHS[DEFAULT_COUNTRY_CODE] == frozenset({9, 10})
    assert normalize_phone("0300123") is None
    assert normalize_phone("+92300123") is None  # the same number, written internationally


def test_nothing_is_inferred_from_an_empty_or_missing_value() -> None:
    assert normalize_phone("") is None
    assert normalize_phone(" \t ") is None
