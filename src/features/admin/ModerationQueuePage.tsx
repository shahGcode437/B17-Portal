import { useState } from "react"
import { motion } from "motion/react"
import { Wrench, Building2, KeyRound, ClipboardCheck, GraduationCap, Utensils } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { ReviewPanel } from "@/features/admin/ReviewPanel"
import { AdminRow, AdminThumb } from "@/features/admin/AdminRow"
import { segmentItemClass, rowActionClass } from "@/features/admin/adminStyles"
import { useAdminCounts, useAdminQueue } from "@/hooks/useWorkspaceReads"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import type { ListingStatus } from "@/types/listing"
import type { AdminQueueRow } from "@/types/ownerListing"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"

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

function rowIcon(row: AdminQueueRow): typeof Wrench {
  if (row.vertical === "food") return Utensils
  return { provider: Wrench, business: Building2, tutor: GraduationCap, property: KeyRound }[row.kind]
}

function emptyMessage(filter: ListingStatus | "all"): string {
  if (filter === "all") return "No listings have been submitted yet."
  if (filter === "pending") return "No pending reviews — the queue is clear."
  return `No ${filter} listings.`
}

/**
 * Moderation Queue (Master Spec §17), read from `GET /admin/listings` (Phase 12G). The status
 * filter is the server's, the counts on the filter buttons are the server's counts over the WHOLE
 * queue (they do not change when you filter), and the order is the server's - the pending ones the
 * longest-waiting first. Reviewing opens the read-only review dialog; approving and rejecting are
 * connected in Phase 12H.
 */
function ModerationQueuePage() {
  const admin = useRequireAdminAuth()
  const [filter, setFilter] = useState<ListingStatus | "all">("all")
  const queue = useAdminQueue(filter === "all" ? undefined : filter)
  // The whole-queue counts have their own small request, so the numbers on the filter buttons do not
  // blink out while another filter loads.
  const wholeQueue = useAdminCounts()
  // `reviewing` is kept after close (only `reviewOpen` flips) so the dialog stays mounted through its
  // close animation and Radix can return focus to the Review button that opened it.
  const [reviewing, setReviewing] = useState<AdminQueueRow | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)

  if (!admin) return null

  const counts = wholeQueue.status === "success" ? wholeQueue.data : undefined
  const countOf = (value: ListingStatus | "all"): string => {
    if (!counts) return "…"
    return String(value === "all" ? counts.pending + counts.approved + counts.rejected + counts.archived : counts[value])
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Listing Review</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Pending listings are listed longest-waiting first. Approving and rejecting from here is coming soon.
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
                {option.label} ({countOf(option.value)})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {queue.loading ? (
            <div role="status" aria-label="Loading the review queue" className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : queue.error ? (
            <ReadError error={queue.error} onRetry={queue.retry} title="Couldn't load the review queue" />
          ) : queue.items.length === 0 ? (
            <WorkspaceEmpty
              icon={ClipboardCheck}
              message={emptyMessage(filter)}
              action={filter === "all" ? undefined : { label: "Show all listings", onClick: () => setFilter("all") }}
            />
          ) : (
            <Stack gap={3}>
              <motion.div initial="initial" animate="animate" variants={staggerContainer}>
                <Stack gap={2}>
                  {queue.items.map((row) => (
                    <motion.div key={row.id} variants={staggerItem}>
                      <AdminRow
                        leading={<AdminThumb icon={rowIcon(row)} label={row.title} />}
                        status={<ListingStatusBadge status={row.status} />}
                        actions={
                          <Button
                            variant={row.status === "pending" ? "default" : "outline"}
                            className={rowActionClass}
                            aria-label={`Review ${row.title}`}
                            onClick={() => {
                              setReviewing(row)
                              setReviewOpen(true)
                            }}
                          >
                            Review
                          </Button>
                        }
                      >
                        <Typography as="span" variant="label" className="break-words">
                          {row.title}
                        </Typography>
                        <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
                          {row.typeLabel}
                          {" · "}
                          {row.categoryLabel}
                        </Typography>
                        <Typography as="span" variant="caption" className="break-words">
                          Submitted by {row.submitterName ?? "an unknown user"} on {dateFormatter.format(new Date(row.submittedAt))}
                        </Typography>
                      </AdminRow>
                    </motion.div>
                  ))}
                </Stack>
              </motion.div>
              {queue.hasMore && (
                <Stack align="center" gap={2}>
                  <Button variant="outline" onClick={queue.loadMore} disabled={queue.loadingMore}>
                    {queue.loadingMore ? "Loading…" : "Load More"}
                  </Button>
                  {queue.moreError && (
                    <Typography variant="body-sm" role="alert" className="text-destructive">
                      Couldn't load more. Try again.
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </motion.div>

      <ReviewPanel
        row={reviewing}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onChanged={() => {
          queue.retry()
          wholeQueue.retry()
        }}
      />
    </Container>
  )
}

export { ModerationQueuePage }
