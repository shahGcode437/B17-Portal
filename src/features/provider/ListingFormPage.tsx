import { ListingWritesSoon } from "@/features/provider/ListingWritesSoon"

/**
 * Create a listing (Master Spec Screen 21). Not available until Phase 12H connects the form to
 * `POST /listings`; see `ListingWritesSoon` for why this is a plain notice rather than a form that
 * would only pretend to save.
 */
function ListingFormPage() {
  return <ListingWritesSoon title="Creating a listing is coming soon" />
}

export { ListingFormPage }
