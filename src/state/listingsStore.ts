import { create } from "zustand"
import type { PendingListing, ListingStatus } from "@/types/listing"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import { pendingListingsSeed } from "@/data/pendingListings"

interface ListingsState {
  listings: PendingListing[]
  /** The current demo session's own submitted listing, if any. */
  mySubmittedListingId: string | null
  submitListing: (listing: PendingListing) => void
  resubmitListing: (id: string, data: PendingListing["data"]) => void
  setStatus: (id: string, status: ListingStatus, rejectionReason?: string) => void
}

/**
 * Prototype-only listing state (Master Spec §17, §19). In-memory for this
 * session — no backend, no persistence, resets on reload. This is the one
 * piece of state genuinely shared across unrelated routes (Provider
 * Dashboard, and Admin moderation in Phase 4B), which is why it's the first
 * real use of Zustand rather than React Context.
 */
export const useListingsStore = create<ListingsState>((set) => ({
  listings: pendingListingsSeed,
  mySubmittedListingId: null,

  submitListing: (listing) =>
    set((state) => ({
      listings: [...state.listings, listing],
      mySubmittedListingId: listing.id,
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
        return listing.kind === "provider"
          ? { ...listing, ...resubmitted, data: data as Provider }
          : { ...listing, ...resubmitted, data: data as Business }
      }),
    })),

  setStatus: (id, status, rejectionReason) =>
    set((state) => ({
      listings: state.listings.map((listing) =>
        listing.id === id ? { ...listing, status, rejectionReason } : listing
      ),
    })),
}))
