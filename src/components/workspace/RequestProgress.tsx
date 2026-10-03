import { Check, Circle, CircleDot, XCircle } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"
import type { RequestStatus } from "@/types/resident"

/** The forward path a request can take — mirrors `REQUEST_TRANSITIONS` (cancellation is a branch off it, not a step). */
const STEPS: { status: Exclude<RequestStatus, "cancelled">; label: string }[] = [
  { status: "submitted", label: "Submitted" },
  { status: "accepted", label: "Accepted" },
  { status: "in-progress", label: "In progress" },
  { status: "completed", label: "Completed" },
]

/**
 * Read-only progression for a request, derived purely from its current
 * `status` — it shows where the request is, not when it got there (no
 * per-step history is stored, so no timestamps or ETAs are shown). Reached,
 * current and upcoming steps differ by icon and text weight as well as
 * color, and each carries a screen-reader state word. `compact` is a
 * decorative bar-only variant for list rows.
 */
function RequestProgress({ status, compact = false }: { status: RequestStatus; compact?: boolean }) {
  if (compact) {
    // Glance-only bar for list rows: hidden from assistive tech because the
    // row's status badge already states the same information in text.
    if (status === "cancelled") return null
    const reachedCount = STEPS.findIndex((step) => step.status === status) + 1
    return (
      <div aria-hidden="true" className="grid grid-cols-4 gap-1">
        {STEPS.map((step, index) => (
          <span key={step.status} className={cn("h-1 rounded-full", index < reachedCount ? "bg-primary" : "bg-border")} />
        ))}
      </div>
    )
  }

  if (status === "cancelled") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <XCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        This request was cancelled.
      </p>
    )
  }

  const currentIndex = STEPS.findIndex((step) => step.status === status)

  return (
    <ol aria-label="Request progress" className="grid grid-cols-4 gap-1.5">
      {STEPS.map((step, index) => {
        const done = index < currentIndex || status === "completed"
        const current = index === currentIndex && status !== "completed"
        const Icon = done ? Check : current ? CircleDot : Circle
        const reached = done || current
        return (
          <li key={step.status} aria-current={current ? "step" : undefined} className="flex flex-col gap-1.5">
            <span className={cn("h-1.5 rounded-full", reached ? "bg-primary" : "bg-border")} aria-hidden="true" />
            <span className="flex flex-col items-start gap-0.5">
              <Icon className={cn("size-3.5 shrink-0", reached ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              <Typography as="span" variant="caption" className={cn("leading-tight", reached && "font-medium text-foreground")}>
                {step.label}
                <span className="sr-only">{done ? " (done)" : current ? " (current step)" : " (not reached yet)"}</span>
              </Typography>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { RequestProgress }
