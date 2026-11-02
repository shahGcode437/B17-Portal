import { User, MapPin, CalendarClock } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Typography } from "@/components/foundation/Typography"
import { SelectableCard } from "@/components/workspace/SelectableCard"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

interface LeadSummaryCardProps {
  request: ServiceRequestRecord
  onSelect: () => void
}

/**
 * One row in "Leads" (VR4) - the professional-side counterpart of `RequestSummaryCard`. Same request view
 * model, framed for the professional: who requested (by display name only), what, where and when they
 * prefer. Operational hierarchy: service + status at the top, requester name + area + preferred date as
 * compact meta pills. Opening it reveals the full timeline and the lifecycle actions.
 */
function LeadSummaryCard({ request, onSelect }: LeadSummaryCardProps) {
  return (
    <SelectableCard onSelect={onSelect}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <User className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Typography as="span" variant="label" className="break-words font-heading text-base font-semibold capitalize">
            {request.service}
          </Typography>
          <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
            {`From ${request.requestedBy}`}
          </Typography>
        </div>
        <RequestStatusBadge status={request.status} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{request.area}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
          Prefers {dateFormatter.format(new Date(request.preferredDate))}
          {request.preferredTime ? ` · ${request.preferredTime}` : ""}
        </span>
      </div>
    </SelectableCard>
  )
}

export { LeadSummaryCard }
