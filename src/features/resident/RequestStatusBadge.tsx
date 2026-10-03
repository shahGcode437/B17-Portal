import { Send, UserCheck, Loader, CheckCircle2, XCircle } from "lucide-react"
import type { RequestStatus } from "@/types/resident"
import { StatusBadge, type StatusTone } from "@/components/feedback/StatusBadge"

/**
 * Shared by the Resident's My Requests and the Professional's Leads, so both
 * sides see the same icon/label/tone for a request. Accepted and Completed
 * share a tone but not an icon, so they stay distinguishable without color.
 */
const statusConfig: Record<RequestStatus, { label: string; icon: typeof Send; tone: StatusTone }> = {
  submitted: { label: "Submitted", icon: Send, tone: "info" },
  accepted: { label: "Accepted", icon: UserCheck, tone: "success" },
  "in-progress": { label: "In Progress", icon: Loader, tone: "warning" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "success" },
  cancelled: { label: "Cancelled", icon: XCircle, tone: "danger" },
}

/** Consistent status indicator for a service request (mirrors ListingStatusBadge). */
function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { label, icon, tone } = statusConfig[status]
  return <StatusBadge tone={tone} icon={icon} label={label} />
}

export { RequestStatusBadge }
