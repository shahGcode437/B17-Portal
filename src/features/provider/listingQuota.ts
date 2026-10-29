import { useOwnerCounts } from "@/hooks/useWorkspaceReads"
import { usePlanEntitlements } from "@/hooks/useCapability"
import type { StatusCountsDto } from "@/lib/api/dto/private"

/**
 * Where the owner stands against the plan's active-listing limit, for the UI only (Phase 12S Step A).
 *
 * The SERVER is the authority: it counts under a lock and answers `403 plan_limit_reached`. This is the
 * browser's best knowledge, used to warn BEFORE a person fills in a form that would be refused. It can be
 * stale (another tab archived a listing) or missing (the counts have not loaded or could not be read), so:
 *  - `unknown` claims nothing - nothing is hidden or disabled, the server decides;
 *  - `full` only warns - it never blocks, and the server's refusal is still handled.
 * Only pending and approved listings are active (rejected and archived do not count - `API_CONTRACT` section 10.9).
 */
export type ListingQuota =
  | { state: "unknown" }
  | { state: "unlimited" }
  | { state: "open"; used: number; max: number }
  | { state: "full"; used: number; max: number }

/** Pure: the plan's limit (`null` = none) and the server's per-status counts (`undefined` = not known). */
export function listingQuota(maxListings: number | null, counts: StatusCountsDto | undefined): ListingQuota {
  if (maxListings === null) return { state: "unlimited" }
  if (!counts) return { state: "unknown" }
  const used = counts.pending + counts.approved
  return { state: used >= maxListings ? "full" : "open", used, max: maxListings }
}

/** The quota from its own tiny counts read (`GET /users/me/listings?limit=1`), for pages without the owner list. */
export function useListingQuota(): ListingQuota {
  const { entitlements } = usePlanEntitlements()
  const counts = useOwnerCounts()
  return listingQuota(entitlements.maxListings, counts.status === "success" ? counts.data : undefined)
}
