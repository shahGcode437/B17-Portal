import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Archive, PlusCircle, Store, Eye, PenLine, ClipboardList } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { PageHeader } from "@/components/workspace/PageHeader"
import { QuotaMeter } from "@/components/workspace/QuotaMeter"
import { ListingSummaryCard } from "@/features/provider/ListingSummaryCard"
import { ListingPreviewDialog } from "@/features/provider/ListingPreviewDialog"
import { ListingLimitNotice } from "@/features/provider/ListingLimitNotice"
import { listingQuota } from "@/features/provider/listingQuota"
import { useOwnerListings } from "@/hooks/useWorkspaceReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useMutation } from "@/hooks/useMutation"
import { useToast } from "@/hooks/useToast"
import { usePlanEntitlements } from "@/hooks/useCapability"
import { archiveListing } from "@/lib/api/writes/listings"
import { copyAsSentence, userMessageFor, isConflict } from "@/lib/api/writeErrors"
import { editListingPath, routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { OwnerListingView } from "@/types/ownerListing"

const LIMIT_NOTICE_ID = "listing-limit-notice"

/**
 * Listings — the professional's own listings with their REAL moderation status (Phase 12G reads,
 * Phase 12H writes). Each active row offers View, Edit and Archive; the actions call
 * `PATCH /listings/{id}` (through the Edit page) and `POST /listings/{id}/archive`. The server is
 * the source of truth: a successful archive refreshes the list; a `409 listing_conflict` means
 * someone else changed the listing — the list refreshes and the owner retries. Archived rows show
 * no further actions. The "+" opens the create flow.
 *
 * VR4: PageHeader + QuotaMeter + operational row grammar. No semantic changes.
 */
function ProfessionalListingsPage() {
  const user = useRequireAuth()
  const listings = useOwnerListings()
  const navigate = useNavigate()
  const { show } = useToast()
  const [previewing, setPreviewing] = useState<OwnerListingView | null>(null)
  const archive = useMutation(({ id, revision }: { id: string; revision: number }) => archiveListing(id, revision))

  const handleArchive = async (listing: OwnerListingView) => {
    if (!window.confirm(`Archive "${listing.title}"? It will no longer be public and no longer counts toward your plan limit. This cannot be undone.`)) return
    try {
      await archive.mutate({ id: listing.id, revision: listing.revision })
      show("Listing archived")
      listings.retry()
    } catch (error) {
      show(copyAsSentence(userMessageFor(error, "archive-listing")), { tone: "error" })
      if (isConflict(error)) listings.retry()
    }
  }
  const { plan, entitlements } = usePlanEntitlements()

  if (!user) return null

  // Only pending and approved listings count toward the plan's active-listing quota; the server's
  // own per-status counts (over ALL of the account's listings) are used, not the rows loaded so far.
  const counts = listings.extra
  const activeListingCount = counts ? counts.pending + counts.approved : 0
  const maxListings = entitlements.maxListings
  // At the limit the primary action is toned down and explained, never disabled: the count can be stale
  // and the server owns the limit (it still answers `plan_limit_reached`).
  const quota = listingQuota(maxListings, counts)
  const atLimit = quota.state === "full"

  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Stack gap={6}>
          <PageHeader
            icon={ClipboardList}
            eyebrow="Professional"
            title="Listings"
            description="Everything you've submitted, with its current moderation status. Material edits return the listing to Pending Review; a privacy-only narrowing keeps the current status."
            actions={
              <Button asChild size="lg" variant={atLimit ? "outline" : "default"} className="h-11">
                <Link to={routes.createListing} aria-describedby={atLimit ? LIMIT_NOTICE_ID : undefined}>
                  <PlusCircle />
                  New listing
                </Link>
              </Button>
            }
          />

          {quota.state === "full" && <ListingLimitNotice id={LIMIT_NOTICE_ID} where="listings" used={quota.used} max={quota.max} />}

          {maxListings !== null && counts && (
            <QuotaMeter
              used={activeListingCount}
              max={maxListings}
              unit="active listings"
              planName={plan}
              caption="Only pending and approved listings count — archived and rejected don't."
            />
          )}

          {listings.loading ? (
            <div role="status" aria-label="Loading your listings" className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-32 rounded-2xl" />
              ))}
            </div>
          ) : listings.error ? (
            <ReadError error={listings.error} onRetry={listings.retry} title="Couldn't load your listings" />
          ) : listings.items.length === 0 ? (
            <Card variant="workspace" className="items-center gap-4 rounded-2xl border-dashed bg-muted/30 py-14 text-center shadow-none">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <Store className="size-7" aria-hidden="true" />
              </span>
              <Stack gap={1}>
                <Typography as="h2" variant="h3">
                  You haven't listed anything yet
                </Typography>
                <Typography variant="body-sm" className="mx-auto max-w-xs text-muted-foreground">
                  Your service, business, tutor or property will appear here with its review status once you submit it.
                </Typography>
              </Stack>
              <Button asChild size="lg" className="h-11">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  Create your first listing
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
                            <Button size="sm" variant="outline" className="h-9" onClick={() => setPreviewing(listing)}>
                              <Eye />
                              View
                            </Button>
                            {listing.status !== "archived" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-9"
                                  onClick={() => navigate(editListingPath(listing.id))}
                                >
                                  <PenLine />
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-9"
                                  onClick={() => void handleArchive(listing)}
                                  disabled={archive.pending}
                                >
                                  <Archive />
                                  Archive
                                </Button>
                              </>
                            )}
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
      </div>

      <ListingPreviewDialog listing={previewing} onOpenChange={(open) => !open && setPreviewing(null)} />
    </Container>
  )
}

export { ProfessionalListingsPage }
