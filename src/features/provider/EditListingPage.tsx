import { ListingWritesSoon } from "@/features/provider/ListingWritesSoon"

/**
 * Edit a listing (Phase 9D). Not available until Phase 12H connects the form to
 * `PATCH /listings/{id}` (with its `revision` conflict handling); see `ListingWritesSoon`.
 */
function EditListingPage() {
  return <ListingWritesSoon title="Editing a listing is coming soon" />
}

export { EditListingPage }
