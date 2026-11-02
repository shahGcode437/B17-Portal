import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ClipboardList } from "lucide-react"
import { PageHeader } from "@/components/workspace/PageHeader"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { RequestSummaryCard } from "@/features/resident/RequestSummaryCard"
import { RequestDetailDialog } from "@/features/resident/RequestDetailDialog"
import { useMyRequests } from "@/hooks/useResidentReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { ServiceRequestRecord } from "@/types/resident"

function RequestList({ requests, onSelect }: { requests: ServiceRequestRecord[]; onSelect: (request: ServiceRequestRecord) => void }) {
  return (
    <motion.div initial="initial" animate="animate" variants={staggerContainer}>
      <Stack gap={3}>
        {requests.map((request) => (
          <motion.div key={request.id} variants={staggerItem}>
            <RequestSummaryCard request={request} onSelect={() => onSelect(request)} />
          </motion.div>
        ))}
      </Stack>
    </motion.div>
  )
}

/**
 * The resident's own service-request history, read from `GET /requests` (Phase 12G). Requests are
 * created and moved along on the server; this page only reads and shows them, so it never invents a
 * status. "Active" vs "Completed & cancelled" is just a split on the status of the rows loaded so far
 * (completed / cancelled are the terminal states). Sending a request and cancelling one arrive with
 * Phase 12H.
 */
function MyRequestsPage() {
  const user = useRequireAuth()
  const requests = useMyRequests()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null)

  if (!user) return null

  const active = requests.items.filter((r) => r.status !== "completed" && r.status !== "cancelled")
  const past = requests.items.filter((r) => r.status === "completed" || r.status === "cancelled")

  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Stack gap={6}>
          <PageHeader
            icon={ClipboardList}
            eyebrow="Account"
            title="My Requests"
            description="Service requests you've sent to providers, and where each one stands."
            meta={<ResidentNav />}
          />

          {requests.loading ? (
            <div role="status" aria-label="Loading your requests" className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : requests.error ? (
            <ReadError error={requests.error} onRetry={requests.retry} title="Couldn't load your requests" />
          ) : requests.items.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No requests yet"
              description="Requests you send to providers will show up here, with their progress."
              actionLabel="Browse Services"
              onAction={() => navigate(routes.services)}
            />
          ) : (
            <Stack gap={8}>
              {active.length > 0 && (
                <WorkspaceSection title="Active" count={requests.hasMore ? undefined : active.length}>
                  <RequestList requests={active} onSelect={setSelected} />
                </WorkspaceSection>
              )}
              {past.length > 0 && (
                <WorkspaceSection title="Completed & cancelled" count={requests.hasMore ? undefined : past.length}>
                  <RequestList requests={past} onSelect={setSelected} />
                </WorkspaceSection>
              )}
              {requests.hasMore && (
                <Stack align="center" gap={2}>
                  <Button variant="outline" onClick={requests.loadMore} disabled={requests.loadingMore}>
                    {requests.loadingMore ? "Loading…" : "Load More"}
                  </Button>
                  {requests.moreError && (
                    <Typography variant="body-sm" role="alert" className="text-destructive">
                      Couldn't load more. Try again.
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </div>

      <RequestDetailDialog
        request={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onChanged={() => {
          requests.retry()
          setSelected(null)
        }}
      />
    </Container>
  )
}

export { MyRequestsPage }
