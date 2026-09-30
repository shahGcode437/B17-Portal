import { create } from "zustand"
import type { PendingListing, ListingStatus } from "@/types/listing"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Property } from "@/types/property"
import { pendingListingsSeed } from "@/data/pendingListings"

interface ListingsState {
  listings: PendingListing[]
  submitListing: (listing: PendingListing) => void
  resubmitListing: (id: string, data: PendingListing["data"]) => void
  setStatus: (id: string, status: ListingStatus, rejectionReason?: string) => void
  archiveListing: (id: string) => void
}

/**
 * Prototype-only listing state (Master Spec §17, §19). In-memory for this
 * session — no backend, no persistence, resets on reload. This is the one
 * piece of state genuinely shared across unrelated routes (Provider
 * Dashboard, and Admin moderation in Phase 4B), which is why it's the first
 * real use of Zustand rather than React Context.
 *
 * `listings` is the single source of truth for a user's own submissions too —
 * there is no separate "my listing id" field. A user can submit any number
 * of listings; callers derive "my listings" by filtering this array on
 * `submittedBy` (see `selectListingsBySubmitter` below).
 */
export const useListingsStore = create<ListingsState>((set) => ({
  listings: pendingListingsSeed,

  submitListing: (listing) =>
    set((state) => ({
      listings: [...state.listings, listing],
    })),

  resubmitListing: (id, data) =>
    set((state) => ({
      listings: state.listings.map((listing): PendingListing => {
        if (listing.id !== id) return listing
        const resubmitted = {
          status: "pending" as const,
          rejectionReason: undefined,
          submittedAt: new Date().toISOString(),
        }
        // Caller is expected to pass data matching this listing's own kind —
        // the branch below just satisfies the discriminated union's shape.
        if (listing.kind === "provider") return { ...listing, ...resubmitted, data: data as Provider }
        if (listing.kind === "business") return { ...listing, ...resubmitted, data: data as Business }
        return { ...listing, ...resubmitted, data: data as Property }
      }),
    })),

  setStatus: (id, status, rejectionReason) =>
    set((state) => ({
      listings: state.listings.map((listing) =>
        listing.id === id ? { ...listing, status, rejectionReason } : listing
      ),
    })),

  /** Professional-initiated removal (Phase 9D) — one-way; see `ListingStatus`'s doc comment. */
  archiveListing: (id) =>
    set((state) => ({
      listings: state.listings.map((listing) =>
        listing.id === id ? { ...listing, status: "archived" as const } : listing
      ),
    })),
}))

/** Derives one user's own submitted listings from the canonical `listings` array — no second source of truth. */
export function selectListingsBySubmitter(listings: PendingListing[], submittedBy: string): PendingListing[] {
  return listings.filter((listing) => listing.submittedBy === submittedBy)
}

/**
 * Statuses that count toward a plan's active-listing quota (Phase 9E). The
 * quota represents concurrently active/in-review listings, not a lifetime
 * creation cap — a rejected or archived listing isn't "using" anything, so
 * it must not permanently consume a Free professional's slot.
 */
const ACTIVE_LISTING_STATUSES: ReadonlySet<ListingStatus> = new Set(["pending", "approved"])

/** Whether a listing in this status counts toward a plan's active-listing quota — the single rule every limit check must share. */
export function isListingCountedTowardPlanLimit(status: ListingStatus): boolean {
  return ACTIVE_LISTING_STATUSES.has(status)
}

/**
 * Same as `selectListingsBySubmitter`, restricted to statuses that count
 * toward a plan's active-listing quota (Phase 9E) — use this, not
 * `selectListingsBySubmitter(...).length`, for any listing-limit check.
 * Listing *management* views should keep using the unfiltered
 * `selectListingsBySubmitter` so archived/rejected listings stay visible.
 */
export function selectActiveListingsBySubmitter(listings: PendingListing[], submittedBy: string): PendingListing[] {
  return selectListingsBySubmitter(listings, submittedBy).filter((listing) =>
    isListingCountedTowardPlanLimit(listing.status)
  )
}
