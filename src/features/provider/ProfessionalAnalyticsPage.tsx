import { useMemo, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { Lock } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { RequireCapability } from "@/components/access/RequireCapability"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
import type { ListingStatus } from "@/types/listing"
import type { RequestStatus } from "@/types/resident"

function CountRow({ badge, value }: { badge: ReactNode; value: number }) {
  return (
    <Card variant="workspace" className="flex-row items-center justify-between gap-3 p-3">
      {badge}
      <span className="font-heading text-xl font-semibold leading-none">{value}</span>
    </Card>
  )
}

/** Locked preview shown to Free professionals — explains what's unavailable, not just a grayed-out block. */
function AnalyticsLocked() {
  return (
    <Card variant="workspace" className="items-center gap-4 border-dashed bg-muted/30 py-12 text-center shadow-none">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Lock className="size-6" aria-hidden="true" />
      </span>
      <Stack gap={1}>
        <Typography variant="h3">Analytics is a Premium feature</Typography>
        <Typography variant="body-sm" className="mx-auto max-w-sm text-muted-foreground">
          Upgrade to Premium to see a breakdown of your listings by moderation status and your
          leads by status.
        </Typography>
      </Stack>
      <Button asChild className="h-11">
        <Link to={routes.providerUpgrade}>See Premium</Link>
      </Button>
    </Card>
  )
}

/**
 * Analytics (Phase 9E — the one real gated example proving the capability
 * architecture). Content is entirely derived from the same `listingsStore`/
 * `residentStore` every other workspace page reads — real status breakdowns,
 * no invented revenue/views/conversion metrics. Gated on `analytics.basic`
 * via `RequireCapability`, the single reusable gating mechanism.
 */
function ProfessionalAnalyticsPage() {
  const user = useRequireAuth()
  const { listings } = useListingsStore()
  const requests = useResidentStore((state) => state.requests)

  const breakdown = useMemo(() => {
    if (!user) return null
    const mine = selectListingsBySubmitter(listings, user.name)
    const myProviderIds = new Set(mine.filter((l) => l.kind === "provider").map((l) => l.data.id))
    const myLeads = requests.filter((r) => myProviderIds.has(r.providerId))

    const listingStatuses: ListingStatus[] = ["pending", "approved", "rejected", "archived"]
    const requestStatuses: RequestStatus[] = ["submitted", "accepted", "in-progress", "completed", "cancelled"]

    return {
      listingsByStatus: listingStatuses.map((status) => ({
        status,
        count: mine.filter((l) => l.status === status).length,
      })),
      leadsByStatus: requestStatuses.map((status) => ({
        status,
        count: myLeads.filter((r) => r.status === status).length,
      })),
    }
  }, [listings, requests, user])

  if (!user || !breakdown) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Analytics</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              A breakdown of your own listings and leads — derived from your real data, not
              estimated.
            </Typography>
          </Stack>

          <RequireCapability capability="analytics.basic" fallback={<AnalyticsLocked />}>
            <Stack gap={6}>
              <WorkspaceSection title="Listings by status">
                <Grid cols={2} gap={2}>
                  {breakdown.listingsByStatus.map(({ status, count }) => (
                    <CountRow key={status} badge={<ListingStatusBadge status={status} />} value={count} />
                  ))}
                </Grid>
              </WorkspaceSection>

              <WorkspaceSection title="Leads by status">
                <Grid cols={2} gap={2}>
                  {breakdown.leadsByStatus.map(({ status, count }) => (
                    <CountRow key={status} badge={<RequestStatusBadge status={status} />} value={count} />
                  ))}
                </Grid>
              </WorkspaceSection>
            </Stack>
          </RequireCapability>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProfessionalAnalyticsPage }
