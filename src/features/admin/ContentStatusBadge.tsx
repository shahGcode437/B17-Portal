import { FileEdit, CheckCircle2 } from "lucide-react"
import type { NewsStatus } from "@/types/news"
import { Badge } from "@/components/ui/badge"

/**
 * Content's own simple lifecycle indicator — deliberately separate from
 * ListingStatusBadge (Pending/Approved/Rejected is a moderation concept;
 * Draft/Published is a direct-authoring concept, see Phase 5B audit §5).
 */
const statusConfig: Record<NewsStatus, { label: string; icon: typeof FileEdit; className: string }> = {
  draft: { label: "Draft", icon: FileEdit, className: "bg-muted text-muted-foreground" },
  published: { label: "Published", icon: CheckCircle2, className: "bg-success/15 text-success" },
}

function ContentStatusBadge({ status }: { status: NewsStatus }) {
  const { label, icon: Icon, className } = statusConfig[status]
  return (
    <Badge className={`gap-1 font-normal ${className}`}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}

export { ContentStatusBadge }
