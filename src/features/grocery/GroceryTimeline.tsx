import { Check } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { STATUS_META, timelineOf, type TimelineStep } from "@/features/grocery/orderStatus"
import { formatStamp } from "@/features/grocery/format"
import { cn } from "@/lib/utils"
import type { GroceryOrderDetailDto } from "@/lib/api/dto/grocery"

const STATE_TEXT: Record<TimelineStep["state"], string> = {
  done: "done",
  current: "current status",
  upcoming: "not reached yet",
}

/**
 * The order's lifecycle as the server recorded it. Reached, current and upcoming steps differ in
 * shape and words as well as colour. A time is shown only for a step the order has reached.
 */
function GroceryTimeline({ order }: { order: GroceryOrderDetailDto }) {
  const steps = timelineOf(order)
  return (
    <ol aria-label="Order progress" className="flex flex-col">
      {steps.map((step, index) => {
        const { label, icon: Icon } = STATUS_META[step.status]
        const last = index === steps.length - 1
        const cancelled = step.status === "cancelled"
        return (
          <li key={step.status} aria-current={step.state === "current" ? "step" : undefined} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={cn("absolute left-[15px] top-8 bottom-0 w-0.5", step.state === "done" ? "bg-primary" : "bg-border")}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-full ring-1",
                step.state === "done" && "bg-primary text-primary-foreground ring-primary",
                step.state === "current" && !cancelled && "bg-primary/15 text-primary ring-2 ring-primary",
                step.state === "current" && cancelled && "bg-destructive/10 text-destructive ring-destructive/40",
                step.state === "upcoming" && "bg-card text-muted-foreground ring-border"
              )}
            >
              {step.state === "done" ? <Check className="size-4" /> : <Icon className="size-4" />}
            </span>
            <div className="flex min-w-0 flex-col pt-1">
              <Typography
                as="span"
                variant="body-sm"
                className={cn(step.state === "current" ? "font-semibold" : step.state === "upcoming" ? "text-muted-foreground" : "font-medium")}
              >
                {label}
                <span className="sr-only"> ({STATE_TEXT[step.state]})</span>
              </Typography>
              {step.at && (
                <Typography as="span" variant="caption" className="text-muted-foreground">
                  {formatStamp(step.at)}
                </Typography>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export { GroceryTimeline }
