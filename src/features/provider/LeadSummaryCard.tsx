import { User } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Typography } from "@/components/foundation/Typography"
import { SelectableCard } from "@/components/workspace/SelectableCard"
import { RequestMeta } from "@/components/workspace/RequestMeta"
import { RequestProgress } from "@/components/workspace/RequestProgress"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { REQUEST_TRANSITIONS } from "@/features/provider/requestTransitions"

interface LeadSummaryCardProps {
  request: ServiceRequestRecord
  onSelect: () => void
}

/**
 * One row in "Leads" (Phase 9D) — the professional-side counterpart of
 * `RequestSummaryCard`. Same `ServiceRequestRecord`, framed for the
 * professional: who requested, not which provider. The hint line names the
 * next valid action straight from `REQUEST_TRANSITIONS` (the single source of
 * truth for the state machine), so it can never disagree with the dialog.
 */
function LeadSummaryCard({ request, onSelect }: LeadSummaryCardProps) {
  const [nextAction] = REQUEST_TRANSITIONS[request.status]

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
      <Typography as="span" variant="caption" className="font-medium text-foreground">
        {nextAction ? `Next action: ${nextAction.label}` : "No further action needed"}
      </Typography>
    </SelectableCard>
  )
}

export { LeadSummaryCard }
