import { Wrench, Building2, KeyRound } from "lucide-react"
import type { PendingListing } from "@/types/listing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const kindMeta: Record<PendingListing["kind"], { label: string; icon: typeof Wrench }> = {
  provider: { label: "Service / Professional", icon: Wrench },
  business: { label: "Business / Shop", icon: Building2 },
  property: { label: "Property", icon: KeyRound },
}

function listingTitle(listing: PendingListing): string {
  return listing.kind === "property" ? listing.data.title : listing.data.name
}

function listingSubcategory(listing: PendingListing): string {
  if (listing.kind === "provider") return listing.data.categoryLabel
  if (listing.kind === "business") return listing.data.category
  return `${listing.data.propertyType} · ${listing.data.listingType === "sale" ? "For Sale" : "For Rent"}`
}

interface ListingSummaryCardProps {
  listing: PendingListing
}

/**
 * One row in "My Listings" (Onboarding Fix §10) — works for all three listing
 * kinds so the Dashboard doesn't need a second card architecture. Shows
 * image, title, type/category, status, submitted date and rejection reason
 * (when applicable) for a single submitted listing.
 */
function ListingSummaryCard({ listing }: ListingSummaryCardProps) {
  const { label, icon: Icon } = kindMeta[listing.kind]
  const title = listingTitle(listing)

  return (
    <Stack gap={3} className="rounded-xl border border-border bg-card p-4 shadow-subtle sm:flex-row">
      <CardImage src={listing.data.image} icon={Icon} label={title} tone="accent" className="sm:w-32 sm:shrink-0" />
      <Stack gap={2} className="flex-1">
        <Stack direction="row" align="start" justify="between" gap={3}>
          <Stack gap={1}>
            <Typography variant="label" className="text-base">
              {title}
            </Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {label} · {listingSubcategory(listing)}
            </Typography>
          </Stack>
          <ListingStatusBadge status={listing.status} />
        </Stack>
        <Typography variant="caption" className="text-muted-foreground">
          Submitted {dateFormatter.format(new Date(listing.submittedAt))}
        </Typography>
        {listing.status === "rejected" && listing.rejectionReason && (
          <Typography variant="body-sm" className="text-destructive">
            Reason: {listing.rejectionReason}
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}

export { ListingSummaryCard }
