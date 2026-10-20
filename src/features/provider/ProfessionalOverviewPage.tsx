import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { Store, Inbox, Layers, Clock, CheckCircle2, XCircle, Archive, MessageSquareText } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Card } from "@/components/ui/card"
import { ReadError } from "@/components/feedback/ReadError"
import { MetricTile } from "@/components/workspace/MetricTile"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { PlanBadge } from "@/features/provider/PlanBadge"
import { useLeads } from "@/hooks/useResidentReads"
import { useLeadStatusCounts, useOwnerListings } from "@/hooks/useWorkspaceReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { usePlanEntitlements } from "@/hooks/useCapability"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

/** A compact, non-interactive recent-activity row: identity on the left, status + date wrapping beneath it on narrow screens. */
function RecentRow({ title, badge, date, capitalize }: { title: string; badge: React.ReactNode; date: string; capitalize?: boolean }) {
  return (
    <Card variant="workspace" className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3">
      <Typography as="span" variant="body-sm" className={`min-w-0 flex-1 basis-40 break-words font-medium ${capitalize ? "capitalize" : ""}`}>
        {title}
      </Typography>
      <span className="flex items-center gap-2">
        {badge}
        <Typography as="span" variant="caption">
          {date}
        </Typography>
      </span>
    </Card>
  )
}

/**
 * Professional Overview (Phase 9D) - the account's own numbers, read from the API (Phase 12G):
 * the per-status listing counts (`GET /users/me/listings`), the lead counts per status
 * (`GET /users/me/leads`), and the latest rows of each. Every figure is the server's count; a figure
 * that could not be loaded shows "—", never zero. No invented analytics: no views, revenue, ratings
 * or conversion rates.
 */
function ProfessionalOverviewPage() {
  const user = useRequireAuth()
  const listings = useOwnerListings()
  const leads = useLeads()
  const leadCounts = useLeadStatusCounts()
  const { plan } = usePlanEntitlements()

  if (!user) return null

  const n = (value: number | undefined): number | string => (value === undefined ? "—" : value)
  // The listing counts arrive with the first page of the list itself (the server counts ALL statuses).
  const c = listings.extra
  const activeLeads =
    leadCounts.status === "success"
      ? leadCounts.data.submitted + leadCounts.data.accepted + leadCounts.data["in-progress"]
      : undefined

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack direction="row" align="start" justify="between" gap={3} wrap>
            <Stack gap={1}>
              <Typography variant="h1">Overview</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Signed in as {user.displayName}.
              </Typography>
            </Stack>
            <PlanBadge />
          </Stack>

          {plan === "free" && (
            <Card
              variant="workspace"
              className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 border-dashed bg-muted/30 py-2 shadow-none"
            >
              <Typography variant="body-sm" className="text-muted-foreground">
                You're on the Free plan — Premium adds Analytics and a higher listing limit.
              </Typography>
              <Link
                to={routes.providerUpgrade}
                className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See Premium
              </Link>
            </Card>
          )}

          <WorkspaceSection title="At a glance">
            <Grid cols={3} gap={3} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-3">
              <MetricTile label="Active leads" value={n(activeLeads)} icon={MessageSquareText} to={routes.providerLeads} />
              <MetricTile
                label="Total listings"
                value={c ? c.pending + c.approved + c.rejected + c.archived : "—"}
                icon={Layers}
                to={routes.providerListings}
              />
              <MetricTile label="Pending review" value={n(c?.pending)} icon={Clock} to={routes.providerListings} />
              <MetricTile label="Approved" value={n(c?.approved)} icon={CheckCircle2} to={routes.providerListings} />
              <MetricTile label="Rejected" value={n(c?.rejected)} icon={XCircle} to={routes.providerListings} />
              <MetricTile label="Archived" value={n(c?.archived)} icon={Archive} to={routes.providerListings} />
            </Grid>
          </WorkspaceSection>

          <WorkspaceSection title="Recent listings" actionLabel="View all" actionTo={routes.providerListings}>
            {listings.loading ? (
              <Typography variant="body-sm" role="status" className="text-muted-foreground">
                Loading your listings…
              </Typography>
            ) : listings.error ? (
              <ReadError error={listings.error} onRetry={listings.retry} title="Couldn't load your listings" />
            ) : listings.items.length === 0 ? (
              <WorkspaceEmpty icon={Store} message="No listings submitted yet. Creating listings is coming soon." />
            ) : (
              <Stack gap={2}>
                {listings.items.slice(0, 3).map((listing) => (
                  <RecentRow
                    key={listing.id}
                    title={listing.title}
                    badge={<ListingStatusBadge status={listing.status} />}
                    date={dateFormatter.format(new Date(listing.submittedAt))}
                  />
                ))}
              </Stack>
            )}
          </WorkspaceSection>

          <WorkspaceSection title="Recent leads" actionLabel="View all" actionTo={routes.providerLeads}>
            {leads.loading ? (
              <Typography variant="body-sm" role="status" className="text-muted-foreground">
                Loading your leads…
              </Typography>
            ) : leads.error ? (
              <ReadError error={leads.error} onRetry={leads.retry} title="Couldn't load your leads" />
            ) : leads.items.length === 0 ? (
              <WorkspaceEmpty icon={Inbox} message="No leads yet — they appear here once a resident requests one of your approved services." />
            ) : (
              <Stack gap={2}>
                {leads.items.slice(0, 3).map((request) => (
                  <RecentRow
                    key={request.id}
                    capitalize
                    title={`${request.service} — ${request.requestedBy}`}
                    badge={<RequestStatusBadge status={request.status} />}
                    date={dateFormatter.format(new Date(request.submittedAt))}
                  />
                ))}
              </Stack>
            )}
          </WorkspaceSection>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProfessionalOverviewPage }
