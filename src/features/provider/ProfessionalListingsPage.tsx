import { useState } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Store, Pencil, Archive, Eye } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ListingSummaryCard } from "@/features/provider/ListingSummaryCard"
import { ListingPreviewDialog } from "@/features/provider/ListingPreviewDialog"
import { useListingsStore, selectListingsBySubmitter, selectActiveListingsBySubmitter } from "@/state/listingsStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useToast } from "@/hooks/useToast"
import { usePlanEntitlements } from "@/hooks/useCapability"
import { routes, editListingPath } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { PendingListing } from "@/types/listing"

/** One listing's action row: View always; Edit/Archive unless already archived; a lightweight inline confirm for Archive (no new dependency). */
function ListingActions({ listing, onPreview }: { listing: PendingListing; onPreview: () => void }) {
  const { archiveListing } = useListingsStore()
  const { show } = useToast()
  const [confirming, setConfirming] = useState(false)

  const title = listing.kind === "property" ? listing.data.title : listing.data.name

  if (confirming) {
    return (
      <Stack direction="row" align="center" wrap gap={2} className="rounded-lg bg-muted p-2">
        <Typography variant="body-sm" className="flex-1">
          Archive this listing? It will no longer be visible to residents.
        </Typography>
        <Stack direction="row" gap={2}>
          <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-11 sm:h-7"
            onClick={() => {
              archiveListing(listing.id)
              show(`${title} archived (demo)`)
              setConfirming(false)
            }}
          >
            Confirm Archive
          </Button>
        </Stack>
      </Stack>
    )
  }

  return (
    <Stack direction="row" wrap gap={2}>
      <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={onPreview}>
        <Eye />
        View
      </Button>
      {listing.status !== "archived" && (
        <>
          <Button asChild size="sm" variant="outline" className="h-11 sm:h-7">
            <Link to={editListingPath(listing.id)}>
              <Pencil />
              Edit
            </Link>
          </Button>
          <Button size="sm" variant="ghost" className="h-11 text-muted-foreground sm:h-7" onClick={() => setConfirming(true)}>
            <Archive />
            Archive
          </Button>
        </>
      )}
    </Stack>
  )
}

/**
 * Listings (Phase 9D) — full listing-management view for the current demo
 * professional, replacing the old ProviderDashboardPage's "My Listings"
 * list. Same `selectListingsBySubmitter` derivation as before; adds
 * View/Edit/Archive per listing.
 */
function ProfessionalListingsPage() {
  const user = useRequireAuth()
  const { listings } = useListingsStore()
  const [previewing, setPreviewing] = useState<PendingListing | null>(null)
  const { plan, entitlements } = usePlanEntitlements()

  if (!user) return null

  const myListings = selectListingsBySubmitter(listings, user.name)
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  // Archived/rejected listings stay visible above, but don't consume the
  // active-listing quota — only pending/approved do (Phase 9E fix).
  const activeListingCount = selectActiveListingsBySubmitter(listings, user.name).length
  const maxListings = entitlements.maxListings
  const atLimit = maxListings !== null && activeListingCount >= maxListings

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack direction="row" align="start" justify="between" gap={3} wrap>
            <Stack gap={1}>
              <Typography variant="h1">Listings</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Everything you've submitted, and its current moderation status.
              </Typography>
            </Stack>
            {myListings.length > 0 && !atLimit && (
              <Button asChild size="sm" className="h-11 sm:h-7">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  List Another
                </Link>
              </Button>
            )}
          </Stack>

          {maxListings !== null && (
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
              {atLimit && (
                <Stack direction="row" align="center" justify="between" gap={3} wrap className="border-t border-border pt-2">
                  <Typography variant="body-sm" className="text-muted-foreground">
                    You've reached the Free plan's limit of {maxListings} active listings. Archive one to
                    free a slot, or upgrade for a higher limit.
                  </Typography>
                  <Link
                    to={routes.providerUpgrade}
                    className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    See Premium
                  </Link>
                </Stack>
              )}
            </Card>
          )}

          {myListings.length === 0 ? (
            <Card variant="workspace" className="items-center gap-4 border-dashed bg-muted/30 py-12 text-center shadow-none">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Store className="size-6" aria-hidden="true" />
              </span>
              <Stack gap={1}>
                <Typography as="h2" variant="h3">
                  You haven't listed anything yet
                </Typography>
                <Typography variant="body-sm" className="mx-auto max-w-xs text-muted-foreground">
                  Share your service, business or property with B-17 residents in a few quick steps.
                </Typography>
              </Stack>
              <Button asChild size="lg" className="h-11">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  Create a Listing
                </Link>
              </Button>
            </Card>
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={3}>
                {myListings.map((listing) => (
                  <motion.div key={listing.id} variants={staggerItem}>
                    <ListingSummaryCard
                      listing={listing}
                      actions={<ListingActions listing={listing} onPreview={() => setPreviewing(listing)} />}
                    />
                  </motion.div>
                ))}
              </Stack>
            </motion.div>
          )}
        </Stack>
      </motion.div>

      <ListingPreviewDialog listing={previewing} onOpenChange={(open) => !open && setPreviewing(null)} />
    </Container>
  )
}

export { ProfessionalListingsPage }
