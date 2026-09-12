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
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useListingsStore } from "@/state/listingsStore"
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
} as const

/** Listing Pending/Status (Master Spec Screen 22) — reads the session's own listing from the store. */
function ListingPendingPage() {
  const user = useRequireAuth()
  const navigate = useNavigate()
  const { listings, mySubmittedListingId } = useListingsStore()
  const myListing = listings.find((listing) => listing.id === mySubmittedListingId)

  if (!user) return null

  if (!myListing) {
    return (
      <Container className="py-16">
        <EmptyState
          title="No listing submitted yet"
          description="You haven't submitted a business or service listing in this session."
          actionLabel="List Your Business / Service"
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

          {myListing.kind === "provider" ? (
            <ProviderCard provider={myListing.data} />
          ) : (
            <BusinessCard business={myListing.data} />
          )}

          <Stack gap={2} className="flex-col-reverse sm:flex-row">
            <Button asChild variant="outline" className="flex-1">
              <Link to={routes.providerDashboard}>Back to Dashboard</Link>
            </Button>
            {myListing.status === "rejected" && (
              <Button asChild className="flex-1">
                <Link to={routes.createListing}>
                  <PlusCircle />
                  Resubmit
                </Link>
              </Button>
            )}
          </Stack>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ListingPendingPage }
