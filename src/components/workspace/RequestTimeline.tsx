import { useMemo } from "react"
import { Send, UserCheck, Loader, CheckCircle2, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"
import type { RequestStatus } from "@/types/resident"

/** The lifecycle events this timeline knows how to render — everything else is ignored. */
export interface TimelineEvent {
  toStatus: RequestStatus
  at: string
  actorRole: "requester" | "provider" | "admin" | "system"
}

interface RequestTimelineProps {
  /** The real history as the server returned it — oldest to newest. Empty: nothing renders. */
  history: TimelineEvent[]
  /** Which side is reading this ("by you" vs "by the provider"). */
  viewerRole: "requester" | "provider"
}

const STATUS_META: Record<RequestStatus, { label: string; icon: LucideIcon; tone: "info" | "success" | "warning" | "danger" }> = {
  submitted: { label: "Submitted", icon: Send, tone: "info" },
  accepted: { label: "Accepted", icon: UserCheck, tone: "success" },
  "in-progress": { label: "Marked in progress", icon: Loader, tone: "warning" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "success" },
  cancelled: { label: "Cancelled", icon: XCircle, tone: "danger" },
}

const TONE_CLASS = {
  info: "bg-info/15 text-info-text ring-info/30",
  success: "bg-success/15 text-success-text ring-success/30",
  warning: "bg-warning/15 text-warning-text ring-warning/30",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
} as const

const stampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

/**
 * Visual history of a service request (VR4): one dot per real event the server returned, no inferred
 * events, no fabricated timestamps. The vertical rail connects reached dots in brand green and stops
 * at the last real event — if the lifecycle hasn't moved to "in progress", there is no "in progress"
 * dot. Each event names its actor by role only (never a name or id); "by you" when it matches the
 * current viewer. Falls through to an empty render if the history is empty, so callers can nest it
 * without an existence guard.
 */
function RequestTimeline({ history, viewerRole }: RequestTimelineProps) {
  const events = useMemo(() => history.filter((h) => h.toStatus in STATUS_META), [history])
  if (events.length === 0) return null

  return (
    <ol aria-label="Request timeline" className="relative flex flex-col gap-4 pl-7">
      <span aria-hidden="true" className="absolute left-[14px] top-2 bottom-2 w-px bg-border" />
      {events.map((entry, index) => {
        const meta = STATUS_META[entry.toStatus]
        const Icon = meta.icon
        const mine = entry.actorRole === viewerRole
        const isLast = index === events.length - 1
        return (
          <li
            key={`${entry.toStatus}-${entry.at}-${index}`}
            aria-current={isLast ? "step" : undefined}
            className="relative flex flex-col gap-0.5"
          >
            <span
              className={cn(
                "absolute -left-7 top-0 flex size-7 items-center justify-center rounded-full ring-1",
                TONE_CLASS[meta.tone]
              )}
              aria-hidden="true"
            >
              <Icon className="size-3.5" />
            </span>
            <Typography as="span" variant="body-sm" className="font-semibold">
              {meta.label}
            </Typography>
            <Typography as="span" variant="caption" className="text-muted-foreground">
              {mine ? "by you" : `by the ${entry.actorRole}`} · {stampFormatter.format(new Date(entry.at))}
            </Typography>
          </li>
        )
      })}
    </ol>
  )
}

export { RequestTimeline }
