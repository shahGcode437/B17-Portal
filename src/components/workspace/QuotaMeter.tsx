import { AlertCircle, CheckCircle2, Package } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

type QuotaState = "empty" | "ok" | "warning" | "full"

interface QuotaMeterProps {
  used: number
  max: number
  /** The capability's label — e.g. "active listings". */
  unit: string
  /** The current plan name (shown as a chip on the right). */
  planName: string
  /** The short, honest line beneath the meter — e.g. "Only pending and approved listings count ...". */
  caption?: string
  /** When at the limit, the extra context under the caption (never a fake Upgrade link — nothing is written here that isn't true today). */
  limitCaption?: string
  className?: string
}

function stateOf(used: number, max: number): QuotaState {
  if (used <= 0) return "empty"
  if (used >= max) return "full"
  if (max - used <= 1) return "warning"
  return "ok"
}

/**
 * Operational usage meter (VR4). Honest about the plan's active-listing quota: a labelled progress
 * fill, a count of the form `N of M`, the plan name, a short caption of what counts, and (at the
 * limit) a warning line. Nothing here is clickable: the server owns the limit, so the only truthful
 * next step is to archive, which is one tap away in the listings table beside this meter.
 */
function QuotaMeter({ used, max, unit, planName, caption, limitCaption, className }: QuotaMeterProps) {
  const state = stateOf(used, max)
  const fill = Math.max(0, Math.min(100, (used / max) * 100))
  const toneClass = state === "full" ? "bg-destructive" : state === "warning" ? "bg-warning" : "bg-primary"
  const Icon = state === "full" ? AlertCircle : state === "warning" ? Package : CheckCircle2
  const iconTone = state === "full" ? "text-destructive" : state === "warning" ? "text-warning-text" : "text-primary"

  return (
    <section
      aria-label={`${unit} usage`}
      className={cn("glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:p-5", className)}
    >
      <Stack direction="row" align="start" justify="between" gap={3} wrap>
        <Stack direction="row" align="center" gap={3}>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted", iconTone)}>
            <Icon className="size-4.5" aria-hidden="true" />
          </span>
          <Stack gap={1}>
            <Typography as="p" variant="body-sm" className="font-heading text-base font-semibold tabular-nums">
              {`${used} of ${max} ${unit} used`}
            </Typography>
            {caption && (
              <Typography as="p" variant="caption" className="text-muted-foreground">
                {caption}
              </Typography>
            )}
          </Stack>
        </Stack>
        <span className="inline-flex shrink-0 items-center rounded-full bg-secondary/70 px-3 py-1 text-xs font-medium capitalize text-secondary-foreground">
          {planName} plan
        </span>
      </Stack>
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${used} of ${max} ${unit}`}
        className="relative h-2 overflow-hidden rounded-full bg-border/80"
      >
        <div
          aria-hidden="true"
          className={cn("h-full rounded-full transition-[width] duration-500", toneClass)}
          style={{ width: `${fill}%` }}
        />
      </div>
      {state === "full" && limitCaption && (
        <Typography variant="body-sm" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{limitCaption}</span>
        </Typography>
      )}
    </section>
  )
}

export { QuotaMeter }
