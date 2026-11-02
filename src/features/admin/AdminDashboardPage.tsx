import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { ChartPanel } from "@/components/charts/ChartPanel"
import { DonutChart } from "@/components/charts/DonutChart"
import { listingStatusColor } from "@/components/charts/chartColors"
import { AdminStat } from "@/features/admin/AdminStat"
import { ContentStatusBadge } from "@/features/admin/ContentStatusBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useAdminCounts, usePublishedNewsTotal } from "@/hooks/useWorkspaceReads"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes } from "@/config/routes"
import { chartReveal, fadeUp } from "@/lib/motion"
import type { ListingStatus } from "@/types/listing"

const LISTING_STATUSES: { status: ListingStatus; label: string }[] = [
  { status: "pending", label: "Pending listings" },
  { status: "approved", label: "Approved listings" },
  { status: "rejected", label: "Rejected listings" },
  { status: "archived", label: "Archived listings" },
]

/**
 * Admin Dashboard (Master Spec §17; compact status counts in Visual V5). The listing counts are the
 * server's, over the whole moderation queue (`GET /admin/listings`, Phase 12G); the published-news
 * figure is the public news total. A count that could not be loaded shows "—", never zero. Each
 * tile links to where those records are managed. News administration (drafts, publishing) has no
 * API yet, so only the published figure exists.
 */
function AdminDashboardPage() {
  const admin = useRequireAdminAuth()
  const counts = useAdminCounts()
  const published = usePublishedNewsTotal()

  if (!admin) return null

  // Real moderation counts only — the donut never invents values; with none loaded it shows nothing.
  const data = counts.status === "success" ? counts.data : null
  const statusSegments = data
    ? [
        { label: "Pending", value: data.pending, color: listingStatusColor.pending },
        { label: "Approved", value: data.approved, color: listingStatusColor.approved },
        { label: "Rejected / taken down", value: data.rejected, color: listingStatusColor.rejected },
        { label: "Archived", value: data.archived, color: listingStatusColor.archived },
      ]
    : []
  const statusTotal = statusSegments.reduce((sum, s) => sum + s.value, 0)

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={8}>
          <Stack gap={1}>
            <Typography variant="h1">Admin Dashboard</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Signed in as {admin.displayName}.
            </Typography>
          </Stack>

          <WorkspaceSection title="Listings" actionLabel="Open listing review" actionTo={routes.adminModeration}>
            {counts.status === "error" ? (
              <ReadError error={counts.error} onRetry={counts.retry} title="Couldn't load the listing counts" />
            ) : (
              // Varied-span grid (VR2): the KPI block takes 3 of 5 columns and the distribution donut takes 2,
              // so the chart keeps a natural, readable width from desktop up. Below xl both stack full-width,
              // which also gives the donut room at 820 and 375 (resolves the VR1 ~73px squeeze).
              <div className="grid gap-4 xl:grid-cols-5">
                <Grid cols={4} gap={3} className="grid-cols-2 sm:grid-cols-4 xl:col-span-3 xl:grid-cols-2 2xl:grid-cols-4">
                  {LISTING_STATUSES.map(({ status, label }) => (
                    <AdminStat
                      key={status}
                      badge={<ListingStatusBadge status={status} />}
                      linkLabel={label}
                      value={counts.status === "success" ? counts.data[status] : "—"}
                      to={routes.adminModeration}
                    />
                  ))}
                </Grid>
                <motion.div {...chartReveal} className="xl:col-span-2">
                  <ChartPanel
                    title="By status"
                    description="Across the whole moderation queue."
                    action={{ label: "Review queue", to: routes.adminModeration }}
                    isEmpty={statusTotal === 0}
                    emptyMessage="No listings have been submitted yet."
                    legend={statusSegments.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
                  >
                    <DonutChart label="Listings by status" segments={statusSegments} size={180} centerValue={statusTotal} centerLabel="listings" />
                  </ChartPanel>
                </motion.div>
              </div>
            )}
          </WorkspaceSection>

          <WorkspaceSection title="News & Daily Updates" actionLabel="News & updates" actionTo={routes.adminContent}>
            <Grid cols={2} gap={3} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-4">
              <AdminStat
                badge={<ContentStatusBadge status="published" />}
                linkLabel="Published content"
                value={published.status === "success" ? published.data : "—"}
                to={routes.adminContent}
              />
            </Grid>
          </WorkspaceSection>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { AdminDashboardPage }
