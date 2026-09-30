import { useMemo, useState } from "react"
import { motion } from "motion/react"
import { Wrench, Building2, KeyRound } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { ReviewPanel } from "@/features/admin/ReviewPanel"
import { useListingsStore } from "@/state/listingsStore"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import type { ListingStatus, PendingListing } from "@/types/listing"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"

const statusOrder: Record<ListingStatus, number> = { pending: 0, approved: 1, rejected: 2, archived: 3 }

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const filterOptions: { value: ListingStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
]

const kindLabel: Record<PendingListing["kind"], string> = {
  provider: "Service / Professional",
  business: "Business / Shop",
  property: "Property",
}

const kindIcon: Record<PendingListing["kind"], typeof Wrench> = {
  provider: Wrench,
  business: Building2,
  property: KeyRound,
}

function listingTitle(listing: PendingListing): string {
  return listing.kind === "property" ? listing.data.title : listing.data.name
}

function listingCategory(listing: PendingListing): string {
  if (listing.kind === "provider") return listing.data.categoryLabel
  if (listing.kind === "business") return listing.data.category
  return `${listing.data.propertyType} · ${listing.data.listingType === "sale" ? "For Sale" : "For Rent"}`
}

/** Moderation Queue (Master Spec §17) — pending-first list of submitted listings, with Review action. */
function ModerationQueuePage() {
  const admin = useRequireAdminAuth()
  const { listings } = useListingsStore()
  const [filter, setFilter] = useState<ListingStatus | "all">("all")
  const [reviewing, setReviewing] = useState<PendingListing | null>(null)

  const visible = useMemo(
    () =>
      listings
        .filter((listing) => filter === "all" || listing.status === filter)
        .slice()
        .sort(
          (a, b) =>
            statusOrder[a.status] - statusOrder[b.status] ||
            b.submittedAt.localeCompare(a.submittedAt)
        ),
    [listings, filter]
  )

  if (!admin) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Listing Review</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Pending listings appear first. Approve or reject each submission.
            </Typography>
          </Stack>

          <ToggleGroup
            type="single"
            variant="outline"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as ListingStatus | "all")
            }}
            aria-label="Filter listings by status"
            className="flex-wrap"
          >
            {filterOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {visible.length === 0 ? (
            <EmptyState
              title="No listings here"
              description="There are no listings matching this filter right now."
            />
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={3}>
                {visible.map((listing) => {
                  const Icon = kindIcon[listing.kind]
                  return (
                    <motion.div
                      key={listing.id}
                      variants={staggerItem}
                      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-subtle sm:flex-row sm:items-center sm:justify-between"
                    >
                      <Stack direction="row" align="start" gap={3}>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <Stack gap={1}>
                          <Typography variant="label">{listingTitle(listing)}</Typography>
                          <Typography variant="body-sm" className="text-muted-foreground">
                            {kindLabel[listing.kind]}
                            {" · "}
                            {listingCategory(listing)}
                          </Typography>
                          <Typography variant="caption" className="text-muted-foreground">
                            Submitted by {listing.submittedBy} on{" "}
                            {dateFormatter.format(new Date(listing.submittedAt))}
                          </Typography>
                        </Stack>
                      </Stack>
                      <Stack
                        direction="row"
                        align="center"
                        justify="between"
                        gap={3}
                        className="sm:flex-col sm:items-end sm:justify-normal"
                      >
                        <ListingStatusBadge status={listing.status} />
                        <Button size="sm" onClick={() => setReviewing(listing)}>
                          Review
                        </Button>
                      </Stack>
                    </motion.div>
                  )
                })}
              </Stack>
            </motion.div>
          )}
        </Stack>
      </motion.div>

      <ReviewPanel
        listing={reviewing}
        open={!!reviewing}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setReviewing(null)
        }}
      />
    </Container>
  )
}

export { ModerationQueuePage }
