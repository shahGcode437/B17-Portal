import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"
import type { ListingDto } from "@/lib/api/dto/public"

/**
 * `GET /listings/{id}` — one APPROVED listing in its public shape. A listing that is pending,
 * rejected, archived, unknown or malformed is the same `404 not_found`.
 */
export function fetchListing(id: string, signal?: AbortSignal): Promise<ListingDto> {
  return apiRequest<ListingDto>("GET", `/listings/${segment(id)}`, { signal })
}
