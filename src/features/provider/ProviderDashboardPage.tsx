import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Store } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useListingsStore } from "@/state/listingsStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/** Provider Dashboard (Master Spec Screen 20) — entry point + own-listing status. */
function ProviderDashboardPage() {
  const user = useRequireAuth()
  const { listings, mySubmittedListingId } = useListingsStore()
  const myListing = listings.find((listing) => listing.id === mySubmittedListingId)

  if (!user) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Provider Dashboard</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Signed in as {user.name} (demo).
            </Typography>
          </Stack>

          {myListing ? (
            <Stack gap={4} className="rounded-xl border border-border bg-card p-5 shadow-subtle">
              <Stack direction="row" align="start" justify="between" gap={3}>
                <Stack gap={1}>
                  <Typography variant="label" className="text-base">
                    {myListing.data.name}
                  </Typography>
                  <Typography variant="body-sm" className="text-primary">
                    {myListing.kind === "provider" ? myListing.data.categoryLabel : myListing.data.category}
                  </Typography>
                </Stack>
                <DemoBadge />
              </Stack>

              <Typography variant="body-sm" className="text-muted-foreground line-clamp-2">
                {myListing.data.description}
              </Typography>

              <Stack direction="row" align="center" justify="between" gap={3}>
                <ListingStatusBadge status={myListing.status} />
                <Button asChild variant="outline" size="sm">
                  <Link to={routes.listingPending}>View Status</Link>
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack align="center" gap={4} className="rounded-xl border border-dashed border-border bg-muted/30 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Store className="size-6" aria-hidden="true" />
              </span>
              <Stack gap={1}>
                <Typography variant="h3">You haven't listed anything yet</Typography>
                <Typography variant="body-sm" className="mx-auto max-w-xs text-muted-foreground">
                  Share your service or business with B-17 residents in a few quick steps.
                </Typography>
              </Stack>
              <Button asChild size="lg">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  List Your Business / Service
                </Link>
              </Button>
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProviderDashboardPage }
