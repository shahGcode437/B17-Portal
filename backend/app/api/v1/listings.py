"""Public listing detail."""

from fastapi import APIRouter

from app.api.routing import ContractRoute
from app.core.errors import ErrorResponse
from app.dependencies.db import DbSession
from app.schemas.envelope import Envelope
from app.schemas.read import ListingDetail
from app.services.public_reads import ListingReadService

router = APIRouter(route_class=ContractRoute, tags=["listings"])


@router.get(
    "/listings/{listing_id}",
    response_model=Envelope[ListingDetail],
    summary="Get one public listing",
    responses={404: {"model": ErrorResponse, "description": "Unknown or not public"}},
)
def get_listing(listing_id: str, session: DbSession) -> Envelope[ListingDetail]:
    """The full public record of an approved listing, shaped by its ``kind``
    (provider, business — General or Food —, tutor, property).

    Anything that is not publicly visible (unknown, pending, rejected, archived) answers the same
    404, so moderation state is never revealed.
    """
    return Envelope(data=ListingReadService(session).get_public(listing_id))
