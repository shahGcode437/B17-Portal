import { User } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Typography } from "@/components/foundation/Typography"
import { SelectableCard } from "@/components/workspace/SelectableCard"
import { RequestMeta } from "@/components/workspace/RequestMeta"
import { RequestProgress } from "@/components/workspace/RequestProgress"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"

interface LeadSummaryCardProps {
  request: ServiceRequestRecord
  onSelect: () => void
}

/**
 * One row in "Leads" - the professional-side counterpart of `RequestSummaryCard`. Same request view
 * model, framed for the professional: who requested (by display name only), not which provider. It is
 * read-only in Phase 12G; accepting, starting, completing and cancelling arrive with Phase 12H.
 */
function LeadSummaryCard({ request, onSelect }: LeadSummaryCardProps) {
  return (
    <SelectableCard onSelect={onSelect}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <User className="size-4.5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Typography as="span" variant="label" className="break-words text-base capitalize">
            {request.service}
          </Typography>
          <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
            From {request.requestedBy}
          </Typography>
        </div>
        <RequestStatusBadge status={request.status} />
      </div>
      <RequestProgress status={request.status} compact />
      <RequestMeta request={request} />
    </SelectableCard>
  )
}

export { LeadSummaryCard }
