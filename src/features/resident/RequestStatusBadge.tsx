import { Clock, CheckCircle2, Loader, XCircle, Send } from "lucide-react"
import type { RequestStatus } from "@/types/resident"
import { Badge } from "@/components/ui/badge"

/**
 * All five statuses are styled so the UI is ready for provider-side
 * transitions (Phase 9D) — but Phase 9C only ever produces "submitted".
 */
const statusConfig: Record<RequestStatus, { label: string; icon: typeof Clock; className: string }> = {
  submitted: { label: "Submitted", icon: Send, className: "bg-info/15 text-info" },
  accepted: { label: "Accepted", icon: CheckCircle2, className: "bg-success/15 text-success" },
  "in-progress": { label: "In Progress", icon: Loader, className: "bg-warning/15 text-warning" },
  completed: { label: "Completed", icon: CheckCircle2, className: "bg-success/15 text-success" },
  cancelled: { label: "Cancelled", icon: XCircle, className: "bg-destructive/10 text-destructive" },
}

/** Consistent status indicator for a resident's own request history (mirrors ListingStatusBadge). */
function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { label, icon: Icon, className } = statusConfig[status]
  return (
    <Badge className={`gap-1 font-normal ${className}`}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}

export { RequestStatusBadge }
