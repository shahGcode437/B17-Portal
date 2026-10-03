import { FileEdit, CheckCircle2 } from "lucide-react"
import type { NewsStatus } from "@/types/news"
import { StatusBadge, type StatusTone } from "@/components/feedback/StatusBadge"

/**
 * Content's own simple lifecycle indicator — deliberately separate from
 * ListingStatusBadge (Pending/Approved/Rejected is a moderation concept;
 * Draft/Published is a direct-authoring concept, see Phase 5B audit §5).
 * Both render through the shared `StatusBadge`, so contrast and the
 * icon + label rule come from one place.
 */
const statusConfig: Record<NewsStatus, { label: string; icon: typeof FileEdit; tone: StatusTone }> = {
  draft: { label: "Draft", icon: FileEdit, tone: "neutral" },
  published: { label: "Published", icon: CheckCircle2, tone: "success" },
}

function ContentStatusBadge({ status }: { status: NewsStatus }) {
  const { label, icon, tone } = statusConfig[status]
  return <StatusBadge tone={tone} icon={icon} label={label} />
}

export { ContentStatusBadge }
