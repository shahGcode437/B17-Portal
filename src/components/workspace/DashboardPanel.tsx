import { type ReactNode, useId } from "react"
import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

interface DashboardPanelProps {
  title: string
  description?: string
  /** Optional right-aligned link in the header (e.g. "Open listing review"). */
  action?: { label: string; to: string }
  children: ReactNode
  /** Grid-span / sizing utilities so dashboards can vary emphasis (Controlled Maximalism). */
  className?: string
  /** Heading level to fit the page outline (2 inside a page with one h1; default 2). */
  headingLevel?: 2 | 3
}

/**
 * VR1 dashboard panel — a titled glass region (Level 2 / content-heavy `glass-panel`) that is the
 * building block of the dashboard visual system. It is a real labelled landmark (`<section>` +
 * `aria-labelledby`), not a bare card, and it reuses the shared `glass-panel` surface utility
 * rather than hand-rolling glass CSS. Varied `className` spans let dashboards avoid a wall of
 * identical rectangles.
 */
function DashboardPanel({ title, description, action, children, className, headingLevel = 2 }: DashboardPanelProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn("glass-panel flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Typography as={`h${headingLevel}`} variant="label" id={headingId} className="font-heading text-base font-semibold">
            {title}
          </Typography>
          {description && (
            <Typography variant="caption" className="text-muted-foreground">
              {description}
            </Typography>
          )}
        </div>
        {action && (
          <Link
            to={action.to}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            {action.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

export { DashboardPanel }
