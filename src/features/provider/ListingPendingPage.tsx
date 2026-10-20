import { ListingWritesSoon } from "@/features/provider/ListingWritesSoon"

/**
 * The "your listing was submitted" confirmation (Master Spec Screen 22). It followed a local-only
 * submit that never reached the server, so it cannot honestly be shown until Phase 12H wires the
 * submit to the API; the real status of each listing is under Listings.
 */
function ListingPendingPage() {
  return <ListingWritesSoon title="Listing submission is coming soon" />
}

export { ListingPendingPage }
