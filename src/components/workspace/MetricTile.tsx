import type { LucideIcon } from "lucide-react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { Link } from "react-router-dom"
import { Card } from "@/components/ui/card"
import { Sparkline } from "@/components/charts/Sparkline"
import { cn } from "@/lib/utils"

type TrendTone = "success" | "danger" | "neutral"

interface MetricTileProps {
  label: string
  value: number | string
  icon?: LucideIcon
  /** Makes the whole tile a link (stretched-link pattern: one tab stop, native anchor semantics). */
  to?: string
  className?: string
  /** Secondary context under the value (real information only, e.g. "2 of 3 active"). */
  context?: string
  /** A genuine trend cue. The caller supplies the direction and text from REAL data — never fabricated. */
  trend?: { direction: "up" | "down" | "flat"; label: string; tone?: TrendTone }
  /** A sparkline of REAL values (e.g. recent counts). Omitted when there is no real series. */
  sparkline?: number[]
}

const trendIcon = { up: TrendingUp, down: TrendingDown, flat: Minus } as const
const trendToneClass: Record<TrendTone, string> = {
  success: "text-success-text",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
}

/**
 * KPI tile for workspace/account overviews (VR1 — the richer KPI foundation). Shows a real number
 * the caller derived from existing state — never an estimate or fabricated growth figure. Beyond the
 * number it can show an icon, a secondary context line, a genuine trend cue and a mini sparkline of
 * real values; all extras are optional so existing call sites keep working. Label comes first in DOM
 * order so it reads "Saved items, 3". Sits on the shared glass surface (Card `workspace`).
 */
function MetricTile({ label, value, icon: Icon, to, className, context, trend, sparkline }: MetricTileProps) {
  const labelClasses = "text-sm text-muted-foreground"
  const TrendIcon = trend ? trendIcon[trend.direction] : null
  return (
    <Card
      variant="workspace"
      className={cn(
        "relative gap-1 overflow-hidden p-4",
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
      <span className="font-heading text-3xl font-semibold leading-tight tracking-tight tabular-nums">{value}</span>
      {context && <span className="text-xs text-muted-foreground">{context}</span>}
      {trend && TrendIcon && (
        <span className={cn("mt-0.5 inline-flex items-center gap-1 text-xs font-medium", trendToneClass[trend.tone ?? "neutral"])}>
          <TrendIcon className="size-3.5" aria-hidden="true" />
          {trend.label}
        </span>
      )}
      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} label={`${label} trend`} area className="mt-2 h-8" />
      )}
    </Card>
  )
}

export { MetricTile }
