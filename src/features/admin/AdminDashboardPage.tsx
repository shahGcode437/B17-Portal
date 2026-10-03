import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { AdminStat } from "@/features/admin/AdminStat"
import { ContentStatusBadge } from "@/features/admin/ContentStatusBadge"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { useListingsStore } from "@/state/listingsStore"
import { useNewsStore } from "@/state/newsStore"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Admin Dashboard (Master Spec §17; compact status counts in Visual V5) —
 * live counts for both listing moderation and news content, each sourced
 * only from their own store (no invented figures). Each count is the shared
 * status badge plus the number, linking to where those records are managed.
 */
function AdminDashboardPage() {
  const admin = useRequireAdminAuth()
  const { listings } = useListingsStore()
  const { items } = useNewsStore()

  if (!admin) return null

  const pending = listings.filter((l) => l.status === "pending").length
  const approved = listings.filter((l) => l.status === "approved").length
  const rejected = listings.filter((l) => l.status === "rejected").length
  const archived = listings.filter((l) => l.status === "archived").length

  const published = items.filter((i) => i.status === "published").length
  const draft = items.filter((i) => i.status === "draft").length

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={8}>
          <Stack gap={1}>
            <Typography variant="h1">Admin Dashboard</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Signed in as {admin.name}.
            </Typography>
          </Stack>

          <WorkspaceSection title="Listings" actionLabel="Open listing review" actionTo={routes.adminModeration}>
            <Grid cols={4} gap={3} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-4">
              <AdminStat
                badge={<ListingStatusBadge status="pending" />}
                linkLabel="Pending listings"
                value={pending}
                to={routes.adminModeration}
              />
              <AdminStat
                badge={<ListingStatusBadge status="approved" />}
                linkLabel="Approved listings"
                value={approved}
                to={routes.adminModeration}
              />
              <AdminStat
                badge={<ListingStatusBadge status="rejected" />}
                linkLabel="Rejected listings"
                value={rejected}
                to={routes.adminModeration}
              />
              <AdminStat
                badge={<ListingStatusBadge status="archived" />}
                linkLabel="Archived listings"
                value={archived}
                to={routes.adminModeration}
              />
            </Grid>
          </WorkspaceSection>

          <WorkspaceSection title="News & Daily Updates" actionLabel="Manage news & updates" actionTo={routes.adminContent}>
            <Grid cols={2} gap={3} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-4">
              <AdminStat
                badge={<ContentStatusBadge status="published" />}
                linkLabel="Published content"
                value={published}
                to={routes.adminContent}
              />
              <AdminStat
                badge={<ContentStatusBadge status="draft" />}
                linkLabel="Draft content"
                value={draft}
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
