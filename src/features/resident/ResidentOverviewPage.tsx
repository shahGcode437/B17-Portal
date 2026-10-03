import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Heart, ClipboardList, Activity, LogOut, UserRound } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { MetricTile } from "@/components/workspace/MetricTile"
import { SelectableCard } from "@/components/workspace/SelectableCard"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { RequestSummaryCard } from "@/features/resident/RequestSummaryCard"
import { RequestDetailDialog } from "@/features/resident/RequestDetailDialog"
import { SAVED_KIND_META, resolveSavedItem } from "@/features/resident/savedItems"
import { useResidentStore } from "@/state/residentStore"
import { useAuth } from "@/hooks/useAuth"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
import type { ServiceRequestRecord } from "@/types/resident"

const RECENT_LIMIT = 3

/**
 * Resident account overview (Phase 9C; polished in Visual V4). Identity is
 * exactly what demo auth actually provides (a name, nothing else). Every
 * number and row below is derived from `residentStore` — saved references
 * resolved through the public search boundary, and the resident's own
 * requests — so there is nothing here that isn't already real data: no
 * points, streaks, recommendations or wallet.
 */
function ResidentOverviewPage() {
  const user = useRequireAuth()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const savedItems = useResidentStore((state) => state.savedItems)
  const requests = useResidentStore((state) => state.requests)
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null)

  const savedResolved = useMemo(
    () =>
      savedItems
        .slice()
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
        .map(resolveSavedItem)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [savedItems]
  )
  const activeCount = requests.filter((r) => r.status !== "completed" && r.status !== "cancelled").length

  if (!user) return null

  function handleLogout() {
    logout()
    navigate(routes.home)
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack direction="row" align="center" gap={3}>
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={0} className="min-w-0">
              <Typography variant="h1" className="break-words text-2xl sm:text-3xl">
                {user.name}
              </Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Signed in (demo) — no real account has been created.
              </Typography>
            </Stack>
          </Stack>

          <ResidentNav />

          <WorkspaceSection title="Your activity">
            <Grid cols={3} gap={3} className="grid-cols-3 sm:grid-cols-3 lg:grid-cols-3">
              <MetricTile label="Saved" value={savedResolved.length} icon={Heart} to={routes.profileSaved} className="p-3 sm:p-4" />
              <MetricTile label="Active requests" value={activeCount} icon={Activity} to={routes.profileRequests} className="p-3 sm:p-4" />
              <MetricTile label="All requests" value={requests.length} icon={ClipboardList} to={routes.profileRequests} className="p-3 sm:p-4" />
            </Grid>
          </WorkspaceSection>

          <WorkspaceSection title="Recent requests" actionLabel="View all" actionTo={routes.profileRequests}>
            {requests.length === 0 ? (
              <WorkspaceEmpty
                icon={ClipboardList}
                message="You haven't requested a service yet."
                action={{ label: "Browse Services", to: routes.services }}
              />
            ) : (
              <Stack gap={3}>
                {requests.slice(0, RECENT_LIMIT).map((request) => (
                  <RequestSummaryCard key={request.id} request={request} onSelect={() => setSelected(request)} />
                ))}
              </Stack>
            )}
          </WorkspaceSection>

          <WorkspaceSection title="Recently saved" actionLabel="View all" actionTo={routes.profileSaved}>
            {savedResolved.length === 0 ? (
              <WorkspaceEmpty
                icon={Heart}
                message="Nothing saved yet — tap the heart on anything you want to come back to."
                action={{ label: "Explore B-17", to: routes.search }}
              />
            ) : (
              <Stack gap={3}>
                {savedResolved.slice(0, RECENT_LIMIT).map(({ item, title, subtitle, path }) => {
                  const { label, icon: Icon } = SAVED_KIND_META[item.kind]
                  return (
                    <SelectableCard key={`${item.kind}-${item.id}`} to={path}>
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <Icon className="size-4.5" aria-hidden="true" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <Typography as="span" variant="label" className="break-words text-base">
                            {title}
                          </Typography>
                          <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
                            {label} · {subtitle}
                          </Typography>
                        </div>
                      </div>
                    </SelectableCard>
                  )
                })}
              </Stack>
            )}
          </WorkspaceSection>

          <Button variant="outline" className="h-11 w-fit" onClick={handleLogout}>
            <LogOut />
            Log Out
          </Button>
        </Stack>
      </motion.div>

      <RequestDetailDialog request={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </Container>
  )
}

export { ResidentOverviewPage }
