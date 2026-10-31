import { useId } from "react"
import { cn } from "@/lib/utils"

export interface MiniBar {
  label: string
  value: number
  /** CSS color token; defaults to the primary brand color. */
  color?: string
}

interface MiniBarChartProps {
  data: MiniBar[]
  /** Accessible name (e.g. "Listings by type"). */
  label: string
  className?: string
}

const VH = 48
const GAP = 6

/**
 * Dependency-free mini bar chart (VR1): proportional vertical bars in pure SVG, no library.
 * Responsive via viewBox. Renders only the real values passed in; an empty set (or all zero)
 * shows the accessible "No data" label. `role="img"` + a per-bar textual summary in the title.
 */
function MiniBarChart({ data, label, className }: MiniBarChartProps) {
  const titleId = useId()
  const bars = data.filter((b) => Number.isFinite(b.value))
  const max = Math.max(1, ...bars.map((b) => Math.max(0, b.value)))
  const count = Math.max(1, bars.length)
  const vw = count * 24
  const barWidth = (vw - GAP * (count - 1)) / count

  const summary = bars.length ? bars.map((b) => `${b.label}: ${b.value}`).join(", ") : "No data to display."

  return (
    <svg
      viewBox={`0 0 ${vw} ${VH}`}
      role="img"
      aria-labelledby={titleId}
      className={cn("h-12 w-full", className)}
      preserveAspectRatio="none"
    >
      <title id={titleId}>{`${label}. ${summary}`}</title>
      {bars.map((b, i) => {
        const h = Math.max(0, b.value) === 0 ? 1 : ((Math.max(0, b.value) / max) * (VH - 2))
        const x = i * (barWidth + GAP)
        return (
          <rect
            key={`${b.label}-${i}`}
            x={x}
            y={VH - h}
            width={barWidth}
            height={h}
            rx="2"
            fill={b.color ?? "var(--primary)"}
          />
        )
      })}
    </svg>
  )
}

export { MiniBarChart }
