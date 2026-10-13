"""Routing defaults shared by every API router."""

from collections.abc import Callable
from typing import Any

from fastapi.routing import APIRoute


class ContractRoute(APIRoute):
    """An ``APIRoute`` that follows the API contract's null/omitted rule by default.

    Optional fields with no value are omitted from responses (docs/backend/API_CONTRACT.md §1),
    so ``response_model_exclude_none`` is always on. (FastAPI's route decorators pass an explicit
    ``False``, so this must override rather than default; the contract has no opt-out.)
    """

    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        kwargs["response_model_exclude_none"] = True
        super().__init__(path, endpoint, **kwargs)
