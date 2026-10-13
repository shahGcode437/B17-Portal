"""Column helpers for closed value sets (docs/backend/DATA_MODEL.md §2 "Enums").

Decision (Phase 10C): constrained values are ``VARCHAR`` + a named ``CHECK`` constraint, **not**
native PostgreSQL ``ENUM`` types. Adding a value to a native enum is a one-way ``ALTER TYPE`` that
is awkward to roll back and cannot be done inside every transaction context; changing a CHECK is an
ordinary, reversible migration, which is the evolvability this product needs (new category modules,
new statuses, new roles). Python code still gets real ``StrEnum`` types.
"""

from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum

#: Every constrained column is VARCHAR(32), regardless of its current longest value, so adding a
#: (longer) value later is only a CHECK change — never a column-type change.
CONSTRAINED_VALUE_LENGTH = 32


def str_enum(enum_class: type[StrEnum]) -> Enum:
    """A ``VARCHAR`` column mapped to/from a ``StrEnum`` by *value* (CHECK declared apart)."""
    return Enum(
        enum_class,
        native_enum=False,
        create_constraint=False,
        validate_strings=True,
        length=CONSTRAINED_VALUE_LENGTH,
        values_callable=lambda members: [member.value for member in members],
    )


def in_values(
    column: str, enum_class: type[StrEnum], *, name: str, nullable: bool = False
) -> CheckConstraint:
    """``CHECK (column IN (...))`` over every value of ``enum_class`` (NULL ok if ``nullable``)."""
    values = ", ".join(f"'{member.value}'" for member in enum_class)
    condition = f"{column} IN ({values})"
    if nullable:
        condition = f"{column} IS NULL OR {condition}"
    return CheckConstraint(condition, name=name)
