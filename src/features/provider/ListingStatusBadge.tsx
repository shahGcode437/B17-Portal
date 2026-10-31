import { Clock, CheckCircle2, XCircle, Archive, ShieldOff } from "lucide-react"
import type { ListingStatus } from "@/types/listing"
import { StatusBadge, type StatusTone } from "@/components/feedback/StatusBadge"
import { listingStatusLabel } from "@/features/provider/listingStatusLabel"

const statusConfig: Record<ListingStatus, { icon: typeof Clock; tone: StatusTone }> = {
  pending: { icon: Clock, tone: "warning" },
  approved: { icon: CheckCircle2, tone: "success" },
  rejected: { icon: XCircle, tone: "danger" },
  archived: { icon: Archive, tone: "neutral" },
}

/**
 * Consistent status indicator for a listing's moderation lifecycle (Master Spec §17). `takenDown` only applies to a
 * `rejected` listing: it separates "Taken down" (a moderator removed a live listing) from "Rejected" (refused before
 * it went live), which share the one status.
 */
function ListingStatusBadge({ status, takenDown = false }: { status: ListingStatus; takenDown?: boolean }) {
  const { icon, tone } = statusConfig[status]
  const isTakedown = status === "rejected" && takenDown
  return <StatusBadge tone={tone} icon={isTakedown ? ShieldOff : icon} label={listingStatusLabel(status, takenDown)} />
}

export { ListingStatusBadge }
