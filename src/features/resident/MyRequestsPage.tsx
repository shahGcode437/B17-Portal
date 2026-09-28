import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ClipboardList } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { RequestSummaryCard } from "@/features/resident/RequestSummaryCard"
import { RequestDetailDialog } from "@/features/resident/RequestDetailDialog"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { ServiceRequestRecord } from "@/types/resident"

/**
 * Resident's own service-request history (Phase 9C). Requests are recorded
 * once, at submission, by `RequestServiceDialog` — this page only reads and
 * displays them; it never fabricates status transitions.
 */
function MyRequestsPage() {
  const user = useRequireAuth()
  const requests = useResidentStore((state) => state.requests)
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null)

  if (!user) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
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
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={3}>
                {requests.map((request) => (
                  <motion.div key={request.id} variants={staggerItem}>
                    <RequestSummaryCard request={request} onSelect={() => setSelected(request)} />
                  </motion.div>
                ))}
              </Stack>
            </motion.div>
          )}
        </Stack>
      </motion.div>

      <RequestDetailDialog request={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </Container>
  )
}

export { MyRequestsPage }
