import { useState } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Store, Eye } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { ListingSummaryCard } from "@/features/provider/ListingSummaryCard"
import { ListingPreviewDialog } from "@/features/provider/ListingPreviewDialog"
import { useOwnerListings } from "@/hooks/useWorkspaceReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { usePlanEntitlements } from "@/hooks/useCapability"
import { routes } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { OwnerListingView } from "@/types/ownerListing"

/**
 * Listings (Phase 9D) - the professional's own listings with their REAL moderation status, read from
 * `GET /users/me/listings` (Phase 12G): status, revision, the admin's rejection reason and the
 * counts all come from the server. Creating, editing and archiving are not available yet (Phase
 * 12H), so each row offers View only and the page says so - nothing here pretends to save.
 */
function ProfessionalListingsPage() {
  const user = useRequireAuth()
  const listings = useOwnerListings()
  const [previewing, setPreviewing] = useState<OwnerListingView | null>(null)
  const { plan, entitlements } = usePlanEntitlements()

  if (!user) return null

  // Only pending and approved listings count toward the plan's active-listing quota; the server's
  // own per-status counts (over ALL of the account's listings) are used, not the rows loaded so far.
  const counts = listings.extra
  const activeListingCount = counts ? counts.pending + counts.approved : 0
  const maxListings = entitlements.maxListings

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack direction="row" align="start" justify="between" gap={3} wrap>
            <Stack gap={1}>
              <Typography variant="h1">Listings</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Everything you've submitted, and its current moderation status. Creating, editing and
                archiving listings is coming soon.
              </Typography>
            </Stack>
          </Stack>

          {maxListings !== null && counts && (
            <Card variant="workspace" className="gap-2">
              <Stack direction="row" align="center" justify="between" gap={3} wrap>
                <Typography variant="label">
                  {activeListingCount} of {maxListings} active listings used
                </Typography>
                <Typography variant="caption" className="capitalize">
                  {plan} plan
                </Typography>
              </Stack>
              <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, (activeListingCount / maxListings) * 100)}%` }}
                />
              </div>
              <Typography variant="caption">Only pending and approved listings count — archived and rejected don't.</Typography>
            </Card>
          )}

          {listings.loading ? (
            <div role="status" aria-label="Loading your listings" className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : listings.error ? (
            <ReadError error={listings.error} onRetry={listings.retry} title="Couldn't load your listings" />
          ) : listings.items.length === 0 ? (
            <Card variant="workspace" className="items-center gap-4 border-dashed bg-muted/30 py-12 text-center shadow-none">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Store className="size-6" aria-hidden="true" />
              </span>
              <Stack gap={1}>
                <Typography as="h2" variant="h3">
                  You haven't listed anything yet
                </Typography>
                <Typography variant="body-sm" className="mx-auto max-w-xs text-muted-foreground">
                  Creating a listing is coming soon. Your service, business or property will appear here with its review status.
                </Typography>
              </Stack>
              <Button asChild size="lg" variant="outline" className="h-11">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  About creating a listing
                </Link>
              </Button>
            </Card>
          ) : (
            <Stack gap={3}>
              <motion.div initial="initial" animate="animate" variants={staggerContainer}>
                <Stack gap={3}>
                  {listings.items.map((listing) => (
                    <motion.div key={listing.id} variants={staggerItem}>
                      <ListingSummaryCard
                        listing={listing}
                        actions={
                          <Stack direction="row" wrap gap={2}>
                            <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={() => setPreviewing(listing)}>
                              <Eye />
                              View
                            </Button>
                          </Stack>
                        }
                      />
                    </motion.div>
                  ))}
                </Stack>
              </motion.div>
              {listings.hasMore && (
                <Stack align="center" gap={2}>
                  <Button variant="outline" onClick={listings.loadMore} disabled={listings.loadingMore}>
                    {listings.loadingMore ? "Loading…" : "Load More"}
                  </Button>
                  {listings.moreError && (
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

      <ListingPreviewDialog listing={previewing} onOpenChange={(open) => !open && setPreviewing(null)} />
    </Container>
  )
}

export { ProfessionalListingsPage }
