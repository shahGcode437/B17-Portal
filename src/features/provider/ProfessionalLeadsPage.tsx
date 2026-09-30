import { useMemo, useState } from "react"
import { motion } from "motion/react"
import { Inbox } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { EmptyState } from "@/components/feedback/EmptyState"
import { LeadSummaryCard } from "@/features/provider/LeadSummaryCard"
import { LeadDetailDialog } from "@/features/provider/LeadDetailDialog"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { ServiceRequestRecord } from "@/types/resident"

/**
 * Leads (Phase 9D) — the professional-side counterpart of Phase 9C's My
 * Requests. Ownership is real, not fabricated: a request is only shown here
 * if its `providerId` matches a Provider-kind listing this demo professional
 * themselves submitted (`submittedBy === user.name`). Business/Property
 * listings have no request-capture flow today, so they never produce leads —
 * documented in the phase report, not worked around.
 */
function ProfessionalLeadsPage() {
  const user = useRequireAuth()
  const { listings } = useListingsStore()
  const requests = useResidentStore((state) => state.requests)
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null)

  const myLeads = useMemo(() => {
    if (!user) return []
    const myProviderIds = new Set(
      selectListingsBySubmitter(listings, user.name)
        .filter((listing) => listing.kind === "provider")
        .map((listing) => listing.data.id)
    )
    return requests.filter((request) => myProviderIds.has(request.providerId))
  }, [listings, requests, user])

  if (!user) return null

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">Leads</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Service requests residents have sent to your approved provider listings.
            </Typography>
          </Stack>

          {myLeads.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No leads yet"
              description="Once a resident requests a service from one of your approved listings, it will show up here."
            />
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Stack gap={3}>
                {myLeads.map((request) => (
                  <motion.div key={request.id} variants={staggerItem}>
                    <LeadSummaryCard request={request} onSelect={() => setSelected(request)} />
                  </motion.div>
                ))}
              </Stack>
            </motion.div>
          )}
        </Stack>
      </motion.div>

      <LeadDetailDialog request={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </Container>
  )
}

export { ProfessionalLeadsPage }
