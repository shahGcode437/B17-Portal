import { Wrench, MapPin, Calendar } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

interface RequestSummaryCardProps {
  request: ServiceRequestRecord
  onSelect: () => void
}

/** One row in "My Requests" — mirrors ListingSummaryCard's layout for a consistent list pattern. */
function RequestSummaryCard({ request, onSelect }: RequestSummaryCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-subtle transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-start"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Wrench className="size-4.5" aria-hidden="true" />
      </span>
      <Stack gap={2} className="flex-1">
        <Stack direction="row" align="start" justify="between" gap={3}>
          <Stack gap={1}>
            <Typography variant="label" className="text-base capitalize">
              {request.service}
            </Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {request.providerName}
            </Typography>
          </Stack>
          <RequestStatusBadge status={request.status} />
        </Stack>
        <Stack direction="row" wrap gap={3} className="text-muted-foreground">
          <Stack direction="row" align="center" gap={1}>
            <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography variant="caption">Submitted {dateFormatter.format(new Date(request.submittedAt))}</Typography>
          </Stack>
          <Stack direction="row" align="center" gap={1}>
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography variant="caption">{request.area}</Typography>
          </Stack>
        </Stack>
      </Stack>
    </button>
  )
}

export { RequestSummaryCard }
