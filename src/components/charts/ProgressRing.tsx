import { useId } from "react"
import { cn } from "@/lib/utils"

interface ProgressRingProps {
  /** Progress as a fraction 0–1 (values outside are clamped). */
  value: number
  /** Accessible name (e.g. "3 of 3 active listings used"). */
  label: string
  size?: number
  thickness?: number
  color?: string
  /** Text shown in the middle (e.g. "3/3" or "75%"). The caller supplies the real value. */
  centerText?: string
  className?: string
}

/**
 * Dependency-free progress ring (VR1): a single-value ring in pure SVG, no library.
 * Exposes `role="img"` plus progressbar semantics (`aria-valuenow`) so it is announced correctly.
 */
function ProgressRing({
  value,
  label,
  size = 72,
  thickness = 8,
  color = "var(--primary)",
  centerText,
  className,
}: ProgressRingProps) {
  const titleId = useId()
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("max-w-full", className)}
    >
      <title id={titleId}>{`${label}. ${Math.round(pct * 100)}%.`}</title>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--muted)" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${center} ${center})`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${pct * circumference} ${circumference}`}
        />
      </g>
      {centerText && (
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-heading text-[0.9rem] font-semibold"
        >
          {centerText}
        </text>
      )}
    </svg>
  )
}

export { ProgressRing }
