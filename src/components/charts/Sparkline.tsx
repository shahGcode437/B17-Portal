import { useId } from "react"
import { cn } from "@/lib/utils"

interface SparklineProps {
  data: number[]
  /** Accessible name (e.g. "Requests over the last 8 weeks"). */
  label: string
  stroke?: string
  /** Fill the area under the line with a faint wash of `stroke`. */
  area?: boolean
  className?: string
}

const VW = 100
const VH = 32

/**
 * Dependency-free sparkline (VR1): a compact trend line in pure SVG, no chart library.
 * Responsive via viewBox (`w-full` by default). Renders only the real numbers passed in;
 * fewer than two points shows nothing but the accessible label. `role="img"` + title.
 */
function Sparkline({ data, label, stroke = "var(--primary)", area = false, className }: SparklineProps) {
  const titleId = useId()
  const clipId = useId()
  const points = data.filter((n) => Number.isFinite(n))

  if (points.length < 2) {
    return (
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-labelledby={titleId} className={cn("h-8 w-full", className)} preserveAspectRatio="none">
        <title id={titleId}>{`${label}. Not enough data to plot.`}</title>
      </svg>
    )
  }

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = VW / (points.length - 1)
  const coords = points.map((n, i) => {
    const x = i * step
    // 2px top/bottom padding so the stroke is never clipped.
    const y = VH - 2 - ((n - min) / span) * (VH - 4)
    return [x, y] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ")
  const areaPath = `${line} L${VW} ${VH} L0 ${VH} Z`

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      role="img"
      aria-labelledby={titleId}
      className={cn("h-8 w-full overflow-visible", className)}
      preserveAspectRatio="none"
    >
      <title id={titleId}>{`${label}. ${points.length} points from ${min} to ${max}.`}</title>
      {area && (
        <>
          <defs>
            <linearGradient id={clipId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${clipId})`} stroke="none" />
        </>
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export { Sparkline }
