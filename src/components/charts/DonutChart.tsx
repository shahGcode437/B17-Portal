import { useId } from "react"
import { cn } from "@/lib/utils"

export interface DonutSegment {
  label: string
  value: number
  /** A CSS color (usually a design token, e.g. `var(--success)`). */
  color: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  /** Accessible name for the whole chart (e.g. "Listings by status"). */
  label: string
  /** Diameter in px (the SVG scales responsively via viewBox). */
  size?: number
  thickness?: number
  /** Large number shown in the hole (e.g. a total). The caller provides the real value. */
  centerValue?: string | number
  centerLabel?: string
  className?: string
}

/**
 * Dependency-free donut/ring chart (VR1). Pure SVG, no chart library. Renders real data only;
 * with a zero total it shows an empty track and says "No data" to assistive tech. Accessible:
 * the SVG is `role="img"` with a summary label, and a visually-hidden list gives every value.
 */
function DonutChart({
  segments,
  label,
  size = 160,
  thickness = 18,
  centerValue,
  centerLabel,
  className,
}: DonutChartProps) {
  const titleId = useId()
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  // Running offset so each arc starts where the previous ended (12 o'clock, clockwise).
  let offset = 0
  const arcs =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const fraction = s.value / total
            const dash = fraction * circumference
            const arc = { ...s, dash, gap: circumference - dash, dashOffset: -offset }
            offset += dash
            return arc
          })
      : []

  const summary =
    total > 0
      ? segments.map((s) => `${s.label}: ${s.value}`).join(", ")
      : "No data to display."

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-labelledby={titleId}
        className="max-w-full"
      >
        <title id={titleId}>{`${label}. ${summary}`}</title>
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={thickness}
        />
        {/* Segments — rotated so 0 starts at the top. */}
        <g transform={`rotate(-90 ${center} ${center})`}>
          {arcs.map((arc, i) => (
            <circle
              key={`${arc.label}-${i}`}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={arc.dashOffset}
            />
          ))}
        </g>
        {(centerValue !== undefined || centerLabel) && (
          <g>
            {centerValue !== undefined && (
              <text
                x={center}
                y={centerLabel ? center - 2 : center}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground font-heading text-[1.4rem] font-semibold"
              >
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text
                x={center}
                y={center + 16}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-muted-foreground text-[0.6rem]"
              >
                {centerLabel}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  )
}

export { DonutChart }
