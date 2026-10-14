"""The success envelope (docs/backend/API_CONTRACT.md §2): ``{"data": ..., "meta": ...}``.

JSON is camelCase; absent optional fields are omitted (``ContractRoute`` serializes with
``exclude_none``), so ``meta`` is simply missing when an endpoint has nothing to report.
"""

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class ApiModel(BaseModel):
    """Base for API schemas: camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Envelope(ApiModel, Generic[T]):  # noqa: UP046 - classic Generic keeps pydantic + mypy simple
    data: T
    meta: dict[str, Any] | None = None


class PageMeta(ApiModel):
    """Offset pagination (docs/backend/API_CONTRACT.md §4)."""

    total: int
    limit: int
    offset: int


class PagedEnvelope(ApiModel, Generic[T]):  # noqa: UP046
    data: list[T]
    meta: PageMeta
