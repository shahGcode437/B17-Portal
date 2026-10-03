import { useMemo, useRef, useState } from "react"
import { motion } from "motion/react"
import { Wrench, Building2, KeyRound, ClipboardCheck } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { ReviewPanel } from "@/features/admin/ReviewPanel"
import { AdminRow, AdminThumb } from "@/features/admin/AdminRow"
import { segmentItemClass, rowActionClass } from "@/features/admin/adminStyles"
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

function emptyMessage(filter: ListingStatus | "all"): string {
  if (filter === "all") return "No listings have been submitted yet."
  if (filter === "pending") return "No pending reviews — the queue is clear."
  return `No ${filter} listings.`
}

/** Moderation Queue (Master Spec §17) — pending-first list of submitted listings, with Review action. */
function ModerationQueuePage() {
  const admin = useRequireAdminAuth()
  const { listings } = useListingsStore()
  const [filter, setFilter] = useState<ListingStatus | "all">("all")
  // `reviewing` is kept after close (only `reviewOpen` flips) so the dialog stays mounted through its
  // close animation and Radix can return focus to the Review button that opened it.
  const [reviewing, setReviewing] = useState<PendingListing | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)

  const counts = useMemo(() => {
    const byStatus: Record<ListingStatus | "all", number> = { all: listings.length, pending: 0, approved: 0, rejected: 0, archived: 0 }
    for (const listing of listings) byStatus[listing.status] += 1
    return byStatus
  }, [listings])

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
              <ToggleGroupItem key={option.value} value={option.value} className={segmentItemClass}>
                {option.label} ({counts[option.value]})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {visible.length === 0 ? (
            <WorkspaceEmpty
              icon={ClipboardCheck}
              message={emptyMessage(filter)}
              action={filter === "all" ? undefined : { label: "Show all listings", onClick: () => setFilter("all") }}
            />
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={2}>
                {visible.map((listing) => {
                  const title = listingTitle(listing)
                  return (
                    <motion.div key={listing.id} variants={staggerItem}>
                      <AdminRow
                        leading={<AdminThumb src={listing.data.image} icon={kindIcon[listing.kind]} label={title} />}
                        status={<ListingStatusBadge status={listing.status} />}
                        actions={
                          <Button
                            variant={listing.status === "pending" ? "default" : "outline"}
                            className={rowActionClass}
                            aria-label={`Review ${title}`}
                            onClick={(event) => {
                              openerRef.current = event.currentTarget
                              setReviewing(listing)
                              setReviewOpen(true)
                            }}
                          >
                            Review
                          </Button>
                        }
                      >
                        <Typography as="span" variant="label" className="break-words">
                          {title}
                        </Typography>
                        <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
                          {kindLabel[listing.kind]}
                          {" · "}
                          {listingCategory(listing)}
                        </Typography>
                        <Typography as="span" variant="caption" className="break-words">
                          Submitted by {listing.submittedBy} on {dateFormatter.format(new Date(listing.submittedAt))}
                        </Typography>
                      </AdminRow>
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
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        returnFocusRef={openerRef}
      />
    </Container>
  )
}

export { ModerationQueuePage }
