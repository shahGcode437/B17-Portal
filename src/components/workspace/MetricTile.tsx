import type { LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface MetricTileProps {
  label: string
  value: number | string
  icon?: LucideIcon
  /** Makes the whole tile a link (stretched-link pattern: one tab stop, native anchor semantics). */
  to?: string
  className?: string
}

/**
 * Compact count tile for workspace/account overviews. Shows a real number the
 * caller derived from existing state — never an estimate. Label comes first
 * in DOM order so it reads "Saved items, 3".
 */
function MetricTile({ label, value, icon: Icon, to, className }: MetricTileProps) {
  const labelClasses = "text-sm text-muted-foreground"
  return (
    <Card
      variant="workspace"
      className={cn(
        "relative gap-1 p-4",
        to && "transition-colors hover:border-primary/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        className
      )}
    >
      <span className="flex items-center gap-2">
        {Icon && <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />}
        {to ? (
          <Link to={to} className={cn(labelClasses, "outline-none after:absolute after:inset-0 after:rounded-xl")}>
            {label}
          </Link>
        ) : (
          <span className={labelClasses}>{label}</span>
        )}
      </span>
      <span className="font-heading text-3xl font-semibold leading-tight tracking-tight">{value}</span>
    </Card>
  )
}

export { MetricTile }
