import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ClipboardList } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { EmptyState } from "@/components/feedback/EmptyState"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { RequestSummaryCard } from "@/features/resident/RequestSummaryCard"
import { RequestDetailDialog } from "@/features/resident/RequestDetailDialog"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
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
 * Resident's own service-request history (Phase 9C). Requests are recorded
 * once, at submission, by `RequestServiceDialog` — this page only reads and
 * displays them; it never fabricates status transitions. "Active" vs "Past"
 * is just a split on the existing status (completed/cancelled are the
 * terminal states in `REQUEST_TRANSITIONS`), not new state.
 */
function MyRequestsPage() {
  const user = useRequireAuth()
  const requests = useResidentStore((state) => state.requests)
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null)

  const { active, past } = useMemo(
    () => ({
      active: requests.filter((r) => r.status !== "completed" && r.status !== "cancelled"),
      past: requests.filter((r) => r.status === "completed" || r.status === "cancelled"),
    }),
    [requests]
  )

  if (!user) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1" className="text-2xl sm:text-3xl">
              My Requests
            </Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Service requests you've sent to providers, and where each one stands.
            </Typography>
          </Stack>
          <ResidentNav />

          {requests.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No requests yet"
              description="When you request a service from a provider, it will show up here."
              actionLabel="Browse Services"
              onAction={() => navigate(routes.services)}
            />
          ) : (
            <Stack gap={8}>
              {active.length > 0 && (
                <WorkspaceSection title={`Active (${active.length})`}>
                  <RequestList requests={active} onSelect={setSelected} />
                </WorkspaceSection>
              )}
              {past.length > 0 && (
                <WorkspaceSection title={`Completed & cancelled (${past.length})`}>
                  <RequestList requests={past} onSelect={setSelected} />
                </WorkspaceSection>
              )}
            </Stack>
          )}
        </Stack>
      </motion.div>

      <RequestDetailDialog request={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </Container>
  )
}

export { MyRequestsPage }
