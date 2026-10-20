import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { AdminStat } from "@/features/admin/AdminStat"
import { ContentStatusBadge } from "@/features/admin/ContentStatusBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useAdminCounts, usePublishedNewsTotal } from "@/hooks/useWorkspaceReads"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
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
              <Grid cols={4} gap={3} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-4">
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
