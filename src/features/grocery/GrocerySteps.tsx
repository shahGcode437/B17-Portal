import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const STEPS = ["List", "Delivery", "Review"] as const

/** Where the customer is in writing an order. A progress marker, not a navigation. */
function GrocerySteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Order steps" className="grid grid-cols-3 gap-2">
      {STEPS.map((label, index) => {
        const step = index + 1
        const done = step < current
        const active = step === current
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
            <span aria-hidden="true" className={cn("h-1.5 rounded-full", done || active ? "bg-primary" : "bg-border")} />
            <span
              className={cn(
                "flex items-center gap-1 text-xs sm:text-sm",
                active ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {done && <Check className="size-3.5 text-primary" aria-hidden="true" />}
              {step}. {label}
              <span className="sr-only">{done ? " (done)" : active ? " (current step)" : " (not reached yet)"}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { GrocerySteps }
