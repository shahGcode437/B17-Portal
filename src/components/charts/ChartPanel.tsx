import type { ReactNode } from "react"
import { BarChart3 } from "lucide-react"
import { DashboardPanel } from "@/components/workspace/DashboardPanel"
import { Typography } from "@/components/foundation/Typography"

export interface ChartLegendItem {
  label: string
  value?: number | string
  /** CSS color (design token) for the swatch. */
  color: string
}

interface ChartPanelProps {
  title: string
  description?: string
  action?: { label: string; to: string }
  /** The chart (one of the SVG primitives). Not rendered when `isEmpty`. */
  children: ReactNode
  legend?: ChartLegendItem[]
  /** True when there is no real data — shows the empty message instead of a fabricated chart. */
  isEmpty?: boolean
  emptyMessage?: string
  className?: string
}

/**
 * VR1 chart container — a `DashboardPanel` wrapping one dependency-free SVG chart plus an optional
 * legend. When `isEmpty`, it shows an honest empty state instead of a chart (charts never invent
 * values). The legend doubles as the accessible value breakdown next to the chart's own aria label.
 */
function ChartPanel({ title, description, action, children, legend, isEmpty, emptyMessage, className }: ChartPanelProps) {
  return (
    <DashboardPanel title={title} description={description} action={action} className={className}>
      {isEmpty ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <BarChart3 className="size-5" aria-hidden="true" />
          </span>
          <Typography variant="body-sm" className="text-muted-foreground">
            {emptyMessage ?? "No data to show yet."}
          </Typography>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
          {legend && legend.length > 0 && (
            <ul className="flex flex-col gap-1.5 sm:min-w-36">
              {legend.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.label}</span>
                  {item.value !== undefined && <span className="font-heading font-semibold tabular-nums">{item.value}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </DashboardPanel>
  )
}

export { ChartPanel }
