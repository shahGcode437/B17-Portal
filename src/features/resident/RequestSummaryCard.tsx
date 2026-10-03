import { Wrench } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Typography } from "@/components/foundation/Typography"
import { SelectableCard } from "@/components/workspace/SelectableCard"
import { RequestMeta } from "@/components/workspace/RequestMeta"
import { RequestProgress } from "@/components/workspace/RequestProgress"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { getProviderById } from "@/services/search"

interface RequestSummaryCardProps {
  request: ServiceRequestRecord
  onSelect: () => void
}

/**
 * One row in "My Requests". Identity is the service plus the provider it was
 * sent to (name snapshot from the request, with the provider's live category
 * when it still resolves). The thin bar is a glance at where the request is;
 * the badge says it in words.
 */
function RequestSummaryCard({ request, onSelect }: RequestSummaryCardProps) {
  const categoryLabel = getProviderById(request.providerId)?.categoryLabel

  return (
    <SelectableCard onSelect={onSelect}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Wrench className="size-4.5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Typography as="span" variant="label" className="break-words text-base capitalize">
            {request.service}
          </Typography>
          <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
            To {request.providerName}
            {categoryLabel ? ` · ${categoryLabel}` : ""}
          </Typography>
        </div>
        <RequestStatusBadge status={request.status} />
      </div>
      <RequestProgress status={request.status} compact />
      <RequestMeta request={request} />
    </SelectableCard>
  )
}

export { RequestSummaryCard }
