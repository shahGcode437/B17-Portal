import { apiRequest, apiRequestPage, type Page } from "@/lib/api/client"
import { queryString, segment } from "@/lib/api/query"
import type { ListingStatusDto, OwnerListingDto, StatusCountsDto } from "@/lib/api/dto/private"
import { parseCounts } from "@/lib/api/reads/counts"

export interface OwnerListingsParams {
  status?: ListingStatusDto
  kind?: OwnerListingDto["kind"]
  limit?: number
  offset?: number
}

export interface OwnerListingsPage {
  page: Page<OwnerListingDto>
  /** Per-status counts over ALL of the caller's listings (not just this page). */
  counts: StatusCountsDto
}

/** `GET /users/me/listings` — my listings in every status, with the private location. READ ONLY. */
export async function fetchOwnerListings(
  params: OwnerListingsParams = {},
  signal?: AbortSignal
): Promise<OwnerListingsPage> {
  const page = await apiRequestPage<OwnerListingDto>("GET", `/users/me/listings${queryString({ ...params })}`, {
    signal,
    session: true,
  })
  return { page, counts: parseCounts(page.extra.counts) }
}

/** `GET /users/me/listings/{id}` — one of my listings; another user's is the same `404` as a missing one. */
export function fetchOwnerListing(id: string, signal?: AbortSignal): Promise<OwnerListingDto> {
  return apiRequest<OwnerListingDto>("GET", `/users/me/listings/${segment(id)}`, { signal, session: true })
}
