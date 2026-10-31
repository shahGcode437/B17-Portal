import { Badge } from "@/components/ui/badge"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { FactList } from "@/features/provider/FactList"
import type { OwnerListingView } from "@/types/ownerListing"

/**
 * The kind-specific facts of one of the owner's own listings, from the fields the owner API already returns (nothing
 * is invented, and nothing private: the location has its own block). A Property shows what the public page will
 * show - sale or rent, type, price, bedrooms, furnishing; a Tutor shows the subject and the grade. Services,
 * businesses and Food & Dining have no structured facts beyond their category line, tags and Food block, which
 * `OwnerTagList` and `FoodListingSummary` show.
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
  if (listing.kind === "tutor") {
    const rows: [string, string][] = []
    if (listing.subjectLabel) rows.push(["Subject", listing.subjectLabel])
    if (listing.grade) rows.push(["Grade / level", listing.grade])
    return rows
  }
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

/** What a listing's tags ARE depends on its kind (the same wording the listing form uses for them). */
function tagsHeading(listing: OwnerListingView): string {
  if (listing.kind === "tutor") return "Topics taught"
  if (listing.kind === "provider") return "Services offered"
  if (listing.kind === "business" && listing.vertical === "food") return "Dishes and search tags"
  return "Tags"
}

/** The listing's tags under a heading that says what they are for its kind; nothing when it has none. */
function OwnerTagList({ listing }: { listing: OwnerListingView }) {
  if (listing.tags.length === 0) return null
  const heading = tagsHeading(listing)
  return (
    <section aria-label={heading} className="flex flex-col gap-2">
      <Typography as="h3" variant="label" className="text-xs">
        {heading}
      </Typography>
      <Stack direction="row" wrap gap={2}>
        {listing.tags.map((tag) => (
          <Badge key={tag} variant="outline" className="font-normal">
            {tag}
          </Badge>
        ))}
      </Stack>
    </section>
  )
}

export { OwnerListingFacts, OwnerTagList }
