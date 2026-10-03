import { useMemo } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { Store, Inbox, Layers, Clock, CheckCircle2, XCircle, Archive, MessageSquareText } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Card } from "@/components/ui/card"
import { MetricTile } from "@/components/workspace/MetricTile"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { PlanBadge } from "@/features/provider/PlanBadge"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { usePlanEntitlements } from "@/hooks/useCapability"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

function listingTitle(listing: { kind: string; data: { title?: string; name?: string } }): string {
  return listing.kind === "property" ? (listing.data.title ?? "") : (listing.data.name ?? "")
}

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
 * Professional Overview (Phase 9D) — frontend-derived counts only, from the
 * same `listingsStore`/`residentStore` every other workspace page reads.
 * No invented analytics: no views, revenue, ratings, or conversion rates.
 */
function ProfessionalOverviewPage() {
  const user = useRequireAuth()
  const { listings } = useListingsStore()
  const requests = useResidentStore((state) => state.requests)
  const { plan } = usePlanEntitlements()

  const { myListings, myLeads, counts } = useMemo(() => {
    if (!user) return { myListings: [], myLeads: [], counts: null }
    const mine = selectListingsBySubmitter(listings, user.name)
    const myProviderIds = new Set(mine.filter((l) => l.kind === "provider").map((l) => l.data.id))
    const leads = requests.filter((r) => myProviderIds.has(r.providerId))
    return {
      myListings: mine,
      myLeads: leads,
      counts: {
        total: mine.length,
        pending: mine.filter((l) => l.status === "pending").length,
        approved: mine.filter((l) => l.status === "approved").length,
        rejected: mine.filter((l) => l.status === "rejected").length,
        archived: mine.filter((l) => l.status === "archived").length,
        activeLeads: leads.filter((r) => r.status !== "completed" && r.status !== "cancelled").length,
      },
    }
  }, [listings, requests, user])

  if (!user || !counts) return null

  const recentListings = myListings
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 3)
  const recentLeads = myLeads
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 3)

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack direction="row" align="start" justify="between" gap={3} wrap>
            <Stack gap={1}>
              <Typography variant="h1">Overview</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Signed in as {user.name} (demo).
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
              <MetricTile label="Active leads" value={counts.activeLeads} icon={MessageSquareText} to={routes.providerLeads} />
              <MetricTile label="Total listings" value={counts.total} icon={Layers} to={routes.providerListings} />
              <MetricTile label="Pending review" value={counts.pending} icon={Clock} to={routes.providerListings} />
              <MetricTile label="Approved" value={counts.approved} icon={CheckCircle2} to={routes.providerListings} />
              <MetricTile label="Rejected" value={counts.rejected} icon={XCircle} to={routes.providerListings} />
              <MetricTile label="Archived" value={counts.archived} icon={Archive} to={routes.providerListings} />
            </Grid>
          </WorkspaceSection>

          <WorkspaceSection title="Recent listings" actionLabel="View all" actionTo={routes.providerListings}>
            {recentListings.length === 0 ? (
              <WorkspaceEmpty
                icon={Store}
                message="No listings submitted yet."
                action={{ label: "Create a Listing", to: routes.createListing }}
              />
            ) : (
              <Stack gap={2}>
                {recentListings.map((listing) => (
                  <RecentRow
                    key={listing.id}
                    title={listingTitle(listing)}
                    badge={<ListingStatusBadge status={listing.status} />}
                    date={dateFormatter.format(new Date(listing.submittedAt))}
                  />
                ))}
              </Stack>
            )}
          </WorkspaceSection>

          <WorkspaceSection title="Recent leads" actionLabel="View all" actionTo={routes.providerLeads}>
            {recentLeads.length === 0 ? (
              <WorkspaceEmpty icon={Inbox} message="No leads yet — they appear here once a resident requests one of your approved services." />
            ) : (
              <Stack gap={2}>
                {recentLeads.map((request) => (
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
