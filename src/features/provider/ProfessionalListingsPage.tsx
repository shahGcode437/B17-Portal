import { useState } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Store, Pencil, Archive, Eye } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ListingSummaryCard } from "@/features/provider/ListingSummaryCard"
import { ListingPreviewDialog } from "@/features/provider/ListingPreviewDialog"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useToast } from "@/hooks/useToast"
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
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
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
      <Button size="sm" variant="outline" onClick={onPreview}>
        <Eye />
        View
      </Button>
      {listing.status !== "archived" && (
        <>
          <Button asChild size="sm" variant="outline">
            <Link to={editListingPath(listing.id)}>
              <Pencil />
              Edit
            </Link>
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirming(true)}>
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

  if (!user) return null

  const myListings = selectListingsBySubmitter(listings, user.name)
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-xl">
        <Stack gap={6}>
          <Stack direction="row" align="start" justify="between" gap={3} wrap>
            <Stack gap={1}>
              <Typography variant="h1">Listings</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Everything you've submitted, and its current moderation status.
              </Typography>
            </Stack>
            {myListings.length > 0 && (
              <Button asChild size="sm">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  List Another
                </Link>
              </Button>
            )}
          </Stack>

          {myListings.length === 0 ? (
            <Stack align="center" gap={4} className="rounded-xl border border-dashed border-border bg-muted/30 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Store className="size-6" aria-hidden="true" />
              </span>
              <Stack gap={1}>
                <Typography variant="h3">You haven't listed anything yet</Typography>
                <Typography variant="body-sm" className="mx-auto max-w-xs text-muted-foreground">
                  Share your service, business or property with B-17 residents in a few quick steps.
                </Typography>
              </Stack>
              <Button asChild size="lg">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  Create a Listing
                </Link>
              </Button>
            </Stack>
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
