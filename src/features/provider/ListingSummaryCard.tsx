import type { ReactNode } from "react"
import type { OwnerListingView } from "@/types/ownerListing"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { Card } from "@/components/ui/card"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { ownerListingIcon } from "@/features/provider/ownerListingIcon"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

interface ListingSummaryCardProps {
  listing: OwnerListingView
  /** Optional action buttons (View, Edit, Archive) rendered below the summary. */
  actions?: ReactNode
}

/**
 * One row in "My Listings" for every listing kind (VR4): operational layout with a strong title, a
 * clear kind·category line, the real moderation status, submitted date + revision, and — for a rejected
 * listing — the admin's reason in a dedicated callout that distinguishes Rejected (before approval)
 * from Taken down (after approval). All data real, nothing invented.
 */
function ListingSummaryCard({ listing, actions }: ListingSummaryCardProps) {
  const Icon = ownerListingIcon(listing)

  return (
    <Card variant="workspace" className="gap-4 rounded-2xl p-4 transition-colors hover:border-primary/30 sm:flex-row">
      <CardImage
        src={listing.image}
        icon={Icon}
        label={listing.title}
        tone="accent"
        className="aspect-video rounded-xl sm:w-40 sm:shrink-0"
        decorative
      />
      <Stack gap={3} className="min-w-0 flex-1">
        <Stack direction="row" align="start" justify="between" gap={3} wrap>
          <Stack gap={1} className="min-w-0 flex-1">
            <Typography variant="label" className="break-words font-heading text-base font-semibold leading-snug sm:text-lg">
              {listing.title}
            </Typography>
            <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
              {`${listing.typeLabel} · ${listing.categoryLabel}`}
            </Typography>
          </Stack>
          <ListingStatusBadge status={listing.status} takenDown={listing.takenDown} />
        </Stack>
        <Typography as="span" variant="caption" className="text-muted-foreground">
          {`Submitted ${dateFormatter.format(new Date(listing.submittedAt))} · revision ${listing.revision}`}
        </Typography>
        {listing.status === "rejected" && listing.rejectionReason && (
          <Typography
            variant="body-sm"
            className="rounded-xl bg-destructive/10 px-3 py-2 text-destructive ring-1 ring-destructive/20"
          >
            <span className="font-semibold">{listing.takenDown ? "Taken down:" : "Reason:"}</span>{" "}
            {listing.rejectionReason}
          </Typography>
        )}
        {actions}
      </Stack>
    </Card>
  )
}

export { ListingSummaryCard }
