"""Public taxonomy."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.routing import ContractRoute
from app.dependencies.db import DbSession
from app.schemas.envelope import Envelope
from app.schemas.read import CategoryQuery, CategoryRead
from app.services.public_reads import CategoryReadService

router = APIRouter(route_class=ContractRoute, tags=["categories"])


@router.get(
    "/categories",
    response_model=Envelope[list[CategoryRead]],
    summary="List active categories",
)
def list_categories(
    session: DbSession, query: Annotated[CategoryQuery, Query()]
) -> Envelope[list[CategoryRead]]:
    """Active categories, optionally of one ``module``, ordered by module, display order, slug.

    Feeds listing forms, Search filters and discovery pages. Inactive categories are never
    listed here.
    """
    return Envelope(data=CategoryReadService(session).list_public(query.module))
