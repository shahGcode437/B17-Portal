import { useMemo } from "react"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { Store, Inbox } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

function listingTitle(listing: { kind: string; data: { title?: string; name?: string } }): string {
  return listing.kind === "property" ? (listing.data.title ?? "") : (listing.data.name ?? "")
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Stack gap={1} className="rounded-xl border border-border bg-card p-4 shadow-subtle">
      <Typography variant="h2" className="text-3xl">
        {value}
      </Typography>
      <Typography variant="body-sm" className="text-muted-foreground">
        {label}
      </Typography>
    </Stack>
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
          <Stack gap={1}>
            <Typography variant="h1">Overview</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Signed in as {user.name} (demo).
            </Typography>
          </Stack>

          <Grid cols={3} gap={3}>
            <StatCard label="Total Listings" value={counts.total} />
            <StatCard label="Pending Review" value={counts.pending} />
            <StatCard label="Approved" value={counts.approved} />
            <StatCard label="Rejected" value={counts.rejected} />
            <StatCard label="Active Leads" value={counts.activeLeads} />
          </Grid>

          <Stack gap={3}>
            <Stack direction="row" align="center" justify="between">
              <Typography variant="label">Recent Listings</Typography>
              <Link to={routes.providerListings} className="text-sm text-primary hover:underline">
                View all
              </Link>
            </Stack>
            {recentListings.length === 0 ? (
              <Stack align="center" gap={2} className="rounded-lg border border-dashed border-border py-8 text-center">
                <Store className="size-5 text-muted-foreground" aria-hidden="true" />
                <Typography variant="body-sm" className="text-muted-foreground">
                  No listings submitted yet.
                </Typography>
              </Stack>
            ) : (
              <Stack gap={2}>
                {recentListings.map((listing) => (
                  <Stack
                    key={listing.id}
                    direction="row"
                    align="center"
                    justify="between"
                    gap={2}
                    className="rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <Typography variant="body-sm" className="truncate">
                      {listingTitle(listing)}
                    </Typography>
                    <Stack direction="row" align="center" gap={2}>
                      <ListingStatusBadge status={listing.status} />
                      <Typography variant="caption" className="text-muted-foreground">
                        {dateFormatter.format(new Date(listing.submittedAt))}
                      </Typography>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>

          <Stack gap={3}>
            <Stack direction="row" align="center" justify="between">
              <Typography variant="label">Recent Leads</Typography>
              <Link to={routes.providerLeads} className="text-sm text-primary hover:underline">
                View all
              </Link>
            </Stack>
            {recentLeads.length === 0 ? (
              <Stack align="center" gap={2} className="rounded-lg border border-dashed border-border py-8 text-center">
                <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
                <Typography variant="body-sm" className="text-muted-foreground">
                  No leads yet.
                </Typography>
              </Stack>
            ) : (
              <Stack gap={2}>
                {recentLeads.map((request) => (
                  <Stack
                    key={request.id}
                    direction="row"
                    align="center"
                    justify="between"
                    gap={2}
                    className="rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <Typography variant="body-sm" className="truncate capitalize">
                      {request.service} — {request.requestedBy}
                    </Typography>
                    <Stack direction="row" align="center" gap={2}>
                      <RequestStatusBadge status={request.status} />
                      <Typography variant="caption" className="text-muted-foreground">
                        {dateFormatter.format(new Date(request.submittedAt))}
                      </Typography>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProfessionalOverviewPage }
