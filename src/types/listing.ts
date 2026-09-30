import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Property } from "@/types/property"

/**
 * "archived" (Phase 9D) is a professional-initiated removal — the listing
 * stops being publicly resolvable (same `status === "approved"` checks in
 * `search.ts` simply no longer match) without deleting the record or
 * inventing backend moderation behavior. One-way in this phase: no
 * unarchive UI yet.
 */
export type ListingStatus = "pending" | "approved" | "rejected" | "archived"

interface PendingListingBase {
  id: string
  status: ListingStatus
  submittedAt: string
  submittedBy: string
  rejectionReason?: string
}

/**
 * A submitted (not-yet-published) listing awaiting moderation (Master Spec
 * §17, User Roles §6). Session-only prototype state — never persisted to a
 * backend. Discriminated on `kind` (mirrors `SearchHit` in types/search.ts)
 * so `data` narrows correctly; `data` itself reuses the existing
 * `Provider`/`Business`/`Property` shapes verbatim so an approved listing can
 * be merged straight into Search (Phase 4B, extended for Property onboarding).
 */
export type PendingListing =
  | (PendingListingBase & { kind: "provider"; data: Provider })
  | (PendingListingBase & { kind: "business"; data: Business })
  | (PendingListingBase & { kind: "property"; data: Property })

export type ListingKind = PendingListing["kind"]
