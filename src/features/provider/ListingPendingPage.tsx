import { Link, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { PlusCircle } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const statusCopy = {
  pending: {
    title: "Your listing is pending review",
    description: "An admin will review your listing for this demo. This step is simulated — no real moderation team is involved.",
  },
  approved: {
    title: "Your listing has been approved",
    description: "This demo listing has been approved and would now be visible to residents.",
  },
  rejected: {
    title: "Your listing needs changes",
    description: "This demo listing wasn't approved. Review the reason below and resubmit.",
  },
  archived: {
    title: "Your listing is archived",
    description: "You archived this listing — it's no longer visible to residents.",
  },
} as const

/**
 * Listing Pending/Status (Master Spec Screen 22) — shows the current user's
 * most recently submitted listing. A user can have several listings now
 * (Onboarding Fix §9), so this page also links to the full "My Listings"
 * view on the Dashboard rather than assuming there is only one.
 */
function ListingPendingPage() {
  const user = useRequireAuth()
  const navigate = useNavigate()
  const { listings } = useListingsStore()

  if (!user) return null

  const myListings = selectListingsBySubmitter(listings, user.name)
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  const myListing = myListings[0]

  if (!myListing) {
    return (
      <Container className="py-16">
        <EmptyState
          title="No listing submitted yet"
          description="You haven't submitted a listing in this session."
          actionLabel="List Your Business / Service / Property"
          onAction={() => navigate(routes.createListing)}
        />
      </Container>
    )
  }

  const copy = statusCopy[myListing.status]

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-xl">
        <Stack gap={6}>
          <Stack gap={2}>
            <ListingStatusBadge status={myListing.status} />
            <Typography variant="h1">{copy.title}</Typography>
            <Typography variant="body" className="text-muted-foreground">
              {copy.description}
            </Typography>
          </Stack>

          {myListing.status === "rejected" && myListing.rejectionReason && (
            <Stack gap={1} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <Typography variant="label" className="text-destructive">
                Reason
              </Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                {myListing.rejectionReason}
              </Typography>
            </Stack>
          )}

          {myListing.kind === "provider" && <ProviderCard provider={myListing.data} />}
          {myListing.kind === "business" && <BusinessCard business={myListing.data} />}
          {myListing.kind === "property" && <PropertyCard property={myListing.data} />}

          {myListings.length > 1 && (
            <Typography variant="caption" className="text-muted-foreground">
              You have {myListings.length} listings submitted in this session.
            </Typography>
          )}

          <Stack gap={2} className="flex-col-reverse sm:flex-row">
            <Button asChild variant="outline" className="flex-1">
              <Link to={routes.providerListings}>View My Listings</Link>
            </Button>
            <Button asChild className="flex-1">
              <Link to={routes.createListing}>
                <PlusCircle />
                {myListing.status === "rejected" ? "Resubmit" : "List Another"}
              </Link>
            </Button>
          </Stack>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ListingPendingPage }
