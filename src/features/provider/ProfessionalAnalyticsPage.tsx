import type { ReactNode } from "react"
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
import { ReadError } from "@/components/feedback/ReadError"
import { useLeadStatusCounts, useOwnerCounts } from "@/hooks/useWorkspaceReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
import type { ListingStatus } from "@/types/listing"
import type { RequestStatus } from "@/types/resident"

function CountRow({ badge, value }: { badge: ReactNode; value: number | string }) {
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
        <Typography as="h2" variant="h3">
          Analytics is a Premium feature
        </Typography>
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

const LISTING_STATUSES: ListingStatus[] = ["pending", "approved", "rejected", "archived"]
const REQUEST_STATUSES: RequestStatus[] = ["submitted", "accepted", "in-progress", "completed", "cancelled"]

/**
 * Analytics (Phase 9E - the one real gated example proving the capability architecture). The
 * numbers are the SERVER's own counts (Phase 12G): listings per moderation status from
 * `GET /users/me/listings` and leads per status from `GET /users/me/leads` - real breakdowns, no
 * invented revenue / views / conversion metrics. Gated on `analytics.basic` via `RequireCapability`,
 * the single reusable gating mechanism.
 */
function ProfessionalAnalyticsPage() {
  const user = useRequireAuth()
  const listings = useOwnerCounts()
  const leads = useLeadStatusCounts()

  if (!user) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Analytics</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              A breakdown of your own listings and leads — counted by the server, not estimated.
            </Typography>
          </Stack>

          <RequireCapability capability="analytics.basic" fallback={<AnalyticsLocked />}>
            <Stack gap={6}>
              <WorkspaceSection title="Listings by status">
                {listings.status === "error" ? (
                  <ReadError error={listings.error} onRetry={listings.retry} title="Couldn't load your listing counts" />
                ) : (
                  <Grid cols={2} gap={2}>
                    {LISTING_STATUSES.map((status) => (
                      <CountRow
                        key={status}
                        badge={<ListingStatusBadge status={status} />}
                        value={listings.status === "success" ? listings.data[status] : "—"}
                      />
                    ))}
                  </Grid>
                )}
              </WorkspaceSection>

              <WorkspaceSection title="Leads by status">
                {leads.status === "error" ? (
                  <ReadError error={leads.error} onRetry={leads.retry} title="Couldn't load your lead counts" />
                ) : (
                  <Grid cols={2} gap={2}>
                    {REQUEST_STATUSES.map((status) => (
                      <CountRow
                        key={status}
                        badge={<RequestStatusBadge status={status} />}
                        value={leads.status === "success" ? leads.data[status] : "—"}
                      />
                    ))}
                  </Grid>
                )}
              </WorkspaceSection>
            </Stack>
          </RequireCapability>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProfessionalAnalyticsPage }
