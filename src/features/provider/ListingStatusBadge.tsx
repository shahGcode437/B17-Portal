import { Clock, CheckCircle2, XCircle, Archive } from "lucide-react"
import type { ListingStatus } from "@/types/listing"
import { Badge } from "@/components/ui/badge"

const statusConfig: Record<ListingStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "Pending Review", icon: Clock, className: "bg-warning/15 text-warning" },
  approved: { label: "Approved", icon: CheckCircle2, className: "bg-success/15 text-success" },
  rejected: { label: "Rejected", icon: XCircle, className: "bg-destructive/10 text-destructive" },
  archived: { label: "Archived", icon: Archive, className: "bg-muted text-muted-foreground" },
}

/** Consistent status indicator for a listing's moderation lifecycle (Master Spec §17). */
function ListingStatusBadge({ status }: { status: ListingStatus }) {
  const { label, icon: Icon, className } = statusConfig[status]
  return (
    <Badge className={`gap-1 font-normal ${className}`}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}

export { ListingStatusBadge }
