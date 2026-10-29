import { FactList } from "@/features/provider/FactList"
import type { OwnerListingView } from "@/types/ownerListing"

/**
 * The kind-specific facts of one of the owner's own listings, from the fields the owner API already returns (nothing
 * is invented, and nothing private: the location has its own block). A Property shows what the public page will
 * show - sale or rent, type, price, bedrooms, furnishing; a Tutor shows the grade. Services, businesses and Food &
 * Dining have no structured facts beyond their category line, tags and Food block, which the preview shows itself.
 */
function ownerListingFacts(listing: OwnerListingView): [string, string][] {
  if (listing.kind === "property") {
    const rows: [string, string][] = []
    if (listing.listingType) rows.push(["Listing", listing.listingType === "sale" ? "For Sale" : "For Rent"])
    if (listing.propertyTypeLabel) rows.push(["Property type", listing.propertyTypeLabel])
    if (listing.price) rows.push(["Price", listing.price])
    if (listing.bedrooms !== undefined) rows.push(["Bedrooms", String(listing.bedrooms)])
    if (listing.furnished) rows.push(["Furnishing", listing.furnished])
    return rows
  }
  if (listing.kind === "tutor" && listing.grade) return [["Grade / level", listing.grade]]
  return []
}

function OwnerListingFacts({ listing }: { listing: OwnerListingView }) {
  const rows = ownerListingFacts(listing)
  if (rows.length === 0) return null
  return (
    <section aria-label="Listing details">
      <FactList rows={rows} />
    </section>
  )
}

export { OwnerListingFacts }
