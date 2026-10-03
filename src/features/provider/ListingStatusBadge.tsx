import { Clock, CheckCircle2, XCircle, Archive } from "lucide-react"
import type { ListingStatus } from "@/types/listing"
import { StatusBadge, type StatusTone } from "@/components/feedback/StatusBadge"

const statusConfig: Record<ListingStatus, { label: string; icon: typeof Clock; tone: StatusTone }> = {
  pending: { label: "Pending Review", icon: Clock, tone: "warning" },
  approved: { label: "Approved", icon: CheckCircle2, tone: "success" },
  rejected: { label: "Rejected", icon: XCircle, tone: "danger" },
  archived: { label: "Archived", icon: Archive, tone: "neutral" },
}

/** Consistent status indicator for a listing's moderation lifecycle (Master Spec §17). */
function ListingStatusBadge({ status }: { status: ListingStatus }) {
  const { label, icon, tone } = statusConfig[status]
  return <StatusBadge tone={tone} icon={icon} label={label} />
}

export { ListingStatusBadge }
