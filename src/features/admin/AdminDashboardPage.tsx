import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { Clock, CheckCircle2, XCircle, ClipboardList, Newspaper, FileEdit } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useListingsStore } from "@/state/listingsStore"
import { useNewsStore } from "@/state/newsStore"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

interface KpiCardProps {
  label: string
  count: number
  icon: LucideIcon
  className: string
}

function KpiCard({ label, count, icon: Icon, className }: KpiCardProps) {
  return (
    <Stack gap={3} className="rounded-xl border border-border bg-card p-4 shadow-subtle">
      <span className={`flex size-9 items-center justify-center rounded-lg ${className}`}>
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <Stack gap={0}>
        <Typography as="p" variant="h2" className="text-2xl">
          {count}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground">
          {label}
        </Typography>
      </Stack>
    </Stack>
  )
}

/**
 * Admin Dashboard (Master Spec §17) — live KPIs for both listing moderation
 * and news content, each sourced only from their own store (no invented
 * figures).
 */
function AdminDashboardPage() {
  const admin = useRequireAdminAuth()
  const { listings } = useListingsStore()
  const { items } = useNewsStore()

  if (!admin) return null

  const pending = listings.filter((l) => l.status === "pending").length
  const approved = listings.filter((l) => l.status === "approved").length
  const rejected = listings.filter((l) => l.status === "rejected").length

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

          <Stack gap={3}>
            <Stack direction="row" align="center" justify="between" gap={3} wrap>
              <Typography variant="label">Listings</Typography>
              <Button asChild size="sm">
                <Link to={routes.adminModeration}>
                  <ClipboardList />
                  Review Pending Listings
                </Link>
              </Button>
            </Stack>
            <Grid cols={3} gap={4}>
              <KpiCard
                label="Pending"
                count={pending}
                icon={Clock}
                className="bg-warning/15 text-warning"
              />
              <KpiCard
                label="Approved"
                count={approved}
                icon={CheckCircle2}
                className="bg-success/15 text-success"
              />
              <KpiCard
                label="Rejected"
                count={rejected}
                icon={XCircle}
                className="bg-destructive/10 text-destructive"
              />
            </Grid>
          </Stack>

          <Stack gap={3}>
            <Stack direction="row" align="center" justify="between" gap={3} wrap>
              <Typography variant="label">News & Daily Updates</Typography>
              <Button asChild size="sm">
                <Link to={routes.adminContent}>
                  <Newspaper />
                  Manage News & Updates
                </Link>
              </Button>
            </Stack>
            <Grid cols={2} gap={4}>
              <KpiCard
                label="Published"
                count={published}
                icon={CheckCircle2}
                className="bg-success/15 text-success"
              />
              <KpiCard
                label="Draft"
                count={draft}
                icon={FileEdit}
                className="bg-muted text-muted-foreground"
              />
            </Grid>
          </Stack>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { AdminDashboardPage }
