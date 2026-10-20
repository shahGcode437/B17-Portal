import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Inbox } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { LeadSummaryCard } from "@/features/provider/LeadSummaryCard"
import { LeadDetailDialog } from "@/features/provider/LeadDetailDialog"
import { useLeads } from "@/hooks/useResidentReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { ServiceRequestRecord } from "@/types/resident"

function LeadList({ leads, onSelect }: { leads: ServiceRequestRecord[]; onSelect: (request: ServiceRequestRecord) => void }) {
  return (
    <motion.div initial="initial" animate="animate" variants={staggerContainer}>
      <Stack gap={3}>
        {leads.map((request) => (
          <motion.div key={request.id} variants={staggerItem}>
            <LeadSummaryCard request={request} onSelect={() => onSelect(request)} />
          </motion.div>
        ))}
      </Stack>
    </motion.div>
  )
}

/**
 * Leads (Phase 9D) - the professional-side counterpart of My Requests, read from
 * `GET /users/me/leads` (Phase 12G): the requests sent to listings this account OWNS. Ownership is the
 * server's, not a guess made in the browser. Open vs closed is a split on the status of the rows
 * loaded so far (completed / cancelled are the terminal states). Read-only until Phase 12H.
 */
function ProfessionalLeadsPage() {
  const user = useRequireAuth()
  const leads = useLeads()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null)

  if (!user) return null

  const open = leads.items.filter((r) => r.status !== "completed" && r.status !== "cancelled")
  const closed = leads.items.filter((r) => r.status === "completed" || r.status === "cancelled")

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Leads</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Service requests residents have sent to your listings.
            </Typography>
          </Stack>

          {leads.loading ? (
            <div role="status" aria-label="Loading your leads" className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : leads.error ? (
            <ReadError error={leads.error} onRetry={leads.retry} title="Couldn't load your leads" />
          ) : leads.items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No leads yet"
              description="Once a resident requests a service from one of your approved listings, it will show up here."
              actionLabel="Manage Listings"
              onAction={() => navigate(routes.providerListings)}
            />
          ) : (
            <Stack gap={8}>
              {open.length > 0 && (
                <WorkspaceSection title={leads.hasMore ? "Open" : `Open (${open.length})`}>
                  <LeadList leads={open} onSelect={setSelected} />
                </WorkspaceSection>
              )}
              {closed.length > 0 && (
                <WorkspaceSection title={leads.hasMore ? "Completed & cancelled" : `Completed & cancelled (${closed.length})`}>
                  <LeadList leads={closed} onSelect={setSelected} />
                </WorkspaceSection>
              )}
              {leads.hasMore && (
                <Stack align="center" gap={2}>
                  <Button variant="outline" onClick={leads.loadMore} disabled={leads.loadingMore}>
                    {leads.loadingMore ? "Loading…" : "Load More"}
                  </Button>
                  {leads.moreError && (
                    <Typography variant="body-sm" role="alert" className="text-destructive">
                      Couldn't load more. Try again.
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </motion.div>

      <LeadDetailDialog request={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </Container>
  )
}

export { ProfessionalLeadsPage }
