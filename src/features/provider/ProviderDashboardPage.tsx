import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle, Store } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ListingSummaryCard } from "@/features/provider/ListingSummaryCard"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"

/** Provider Dashboard (Master Spec Screen 20) — entry point + all of the current user's own listings. */
function ProviderDashboardPage() {
  const user = useRequireAuth()
  const { listings } = useListingsStore()

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
              <Typography variant="h1">Provider Dashboard</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Signed in as {user.name} (demo).
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
            <Stack gap={4}>
              <Typography variant="label">My Listings</Typography>
              <motion.div initial="initial" animate="animate" variants={staggerContainer}>
                <Stack gap={3}>
                  {myListings.map((listing) => (
                    <motion.div key={listing.id} variants={staggerItem}>
                      <ListingSummaryCard listing={listing} />
                    </motion.div>
                  ))}
                </Stack>
              </motion.div>
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProviderDashboardPage }
