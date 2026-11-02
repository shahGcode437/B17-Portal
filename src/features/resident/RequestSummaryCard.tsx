import { Wrench, MapPin, CalendarClock } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Typography } from "@/components/foundation/Typography"
import { SelectableCard } from "@/components/workspace/SelectableCard"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

interface RequestSummaryCardProps {
  request: ServiceRequestRecord
  onSelect: () => void
}

/**
 * One row in "My Requests" (VR4). Identity is the service plus the provider it was sent to — the name is
 * the SNAPSHOT taken when the request was made, so the row reads the same whatever later happens to the
 * listing. Area and preferred date are compact meta pills; opening the row reveals the full timeline and
 * cancel action if the lifecycle allows it.
 */
function RequestSummaryCard({ request, onSelect }: RequestSummaryCardProps) {
  return (
    <SelectableCard onSelect={onSelect}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Wrench className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Typography as="span" variant="label" className="break-words font-heading text-base font-semibold capitalize">
            {request.service}
          </Typography>
          <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
            {`To ${request.providerName}`}
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

export { RequestSummaryCard }
