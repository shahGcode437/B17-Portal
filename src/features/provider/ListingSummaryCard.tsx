import type { ReactNode } from "react"
import { Wrench, Building2, KeyRound, GraduationCap, Utensils } from "lucide-react"
import type { OwnerListingKind, OwnerListingView } from "@/types/ownerListing"
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

const kindIcon: Record<OwnerListingKind, typeof Wrench> = {
  provider: Wrench,
  business: Building2,
  tutor: GraduationCap,
  property: KeyRound,
}

interface ListingSummaryCardProps {
  listing: OwnerListingView
  /** Optional action buttons (View...) rendered below the summary. */
  actions?: ReactNode
}

/**
 * One row in "My Listings" for every listing kind, built from the owner's own view of the listing
 * (Phase 12G): image, title, type / category, the REAL moderation status, the submitted date and -
 * for a rejected listing - the reason the admin gave.
 */
function ListingSummaryCard({ listing, actions }: ListingSummaryCardProps) {
  const Icon = listing.vertical === "food" ? Utensils : kindIcon[listing.kind]

  return (
    <Card variant="workspace" className="sm:flex-row">
      <CardImage src={listing.image} icon={Icon} label={listing.title} tone="accent" className="sm:w-32 sm:shrink-0" decorative />
      <Stack gap={2} className="min-w-0 flex-1">
        <Stack direction="row" align="start" justify="between" gap={3}>
          <Stack gap={1} className="min-w-0">
            <Typography variant="label" className="break-words text-base">
              {listing.title}
            </Typography>
            <Typography variant="body-sm" className="break-words text-muted-foreground">
              {listing.typeLabel} · {listing.categoryLabel}
            </Typography>
          </Stack>
          <ListingStatusBadge status={listing.status} />
        </Stack>
        <Typography variant="caption" className="text-muted-foreground">
          Submitted {dateFormatter.format(new Date(listing.submittedAt))} · revision {listing.revision}
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
