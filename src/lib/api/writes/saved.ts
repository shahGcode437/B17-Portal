import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"

/**
 * `PUT /saved/{listingId}` — idempotent save of an approved listing (API_CONTRACT §10.2, §10.8).
 * A listing that is not approved responds `404`. The body is empty.
 */
export function saveListing(listingId: string): Promise<void> {
  return apiRequest<void>("PUT", `/saved/${segment(listingId)}`, { session: true, body: {} })
}

/** `DELETE /saved/{listingId}` — idempotent (also when nothing was saved). */
export function unsaveListing(listingId: string): Promise<void> {
  return apiRequest<void>("DELETE", `/saved/${segment(listingId)}`, { session: true })
}
