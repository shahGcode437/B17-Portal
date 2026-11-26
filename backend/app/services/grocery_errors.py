"""Keeping delivery details out of the logs.

An unexpected database error is logged with its traceback. SQLAlchemy puts the statement's
PARAMETERS in that message, and PostgreSQL can quote the failing row — for a Grocery order that is
a name, a telephone number and an address. Every Grocery write runs inside
:func:`private_database_errors`, which replaces such an error with one that names only the
SQLSTATE and the constraint. The client still receives the ordinary ``500 internal_error``.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.exc import SQLAlchemyError


class GroceryPersistenceError(RuntimeError):
    """A Grocery write failed in the database. Carries no value from the statement."""


@contextmanager
def private_database_errors() -> Iterator[None]:
    try:
        yield
    except SQLAlchemyError as error:
        original = getattr(error, "orig", None)
        constraint = getattr(getattr(original, "diag", None), "constraint_name", None)
        raise GroceryPersistenceError(
            f"grocery write failed: {type(error).__name__} "
            f"sqlstate={getattr(original, 'sqlstate', None)} constraint={constraint}"
        ) from None  # the original, with its parameters, is never chained into a traceback
