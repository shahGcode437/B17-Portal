import type { ReactNode } from "react"
import { Wrench, Building2, KeyRound } from "lucide-react"
import type { PendingListing } from "@/types/listing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { Card } from "@/components/ui/card"
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
  /** Optional action buttons (Edit/Archive/View — Phase 9D) rendered below the summary. Omitted where not needed (e.g. Listing Pending). */
  actions?: ReactNode
}

/**
 * One row in "My Listings" (Onboarding Fix §10) — works for all three listing
 * kinds so the Dashboard doesn't need a second card architecture. Shows
 * image, title, type/category, status, submitted date and rejection reason
 * (when applicable) for a single submitted listing.
 */
function ListingSummaryCard({ listing, actions }: ListingSummaryCardProps) {
  const { label, icon: Icon } = kindMeta[listing.kind]
  const title = listingTitle(listing)

  return (
    <Card variant="workspace" className="sm:flex-row">
      <CardImage src={listing.data.image} icon={Icon} label={title} tone="accent" className="sm:w-32 sm:shrink-0" />
      <Stack gap={2} className="min-w-0 flex-1">
        <Stack direction="row" align="start" justify="between" gap={3}>
          <Stack gap={1} className="min-w-0">
            <Typography variant="label" className="break-words text-base">
              {title}
            </Typography>
            <Typography variant="body-sm" className="break-words text-muted-foreground">
              {label} · {listingSubcategory(listing)}
            </Typography>
          </Stack>
          <ListingStatusBadge status={listing.status} />
        </Stack>
        <Typography variant="caption" className="text-muted-foreground">
          Submitted {dateFormatter.format(new Date(listing.submittedAt))}
        </Typography>
        {listing.status === "rejected" && listing.rejectionReason && (
          <Typography variant="body-sm" className="rounded-lg bg-destructive/5 px-3 py-2 text-destructive">
            <span className="font-medium">Reason:</span> {listing.rejectionReason}
          </Typography>
        )}
        {actions}
      </Stack>
    </Card>
  )
}

export { ListingSummaryCard }
