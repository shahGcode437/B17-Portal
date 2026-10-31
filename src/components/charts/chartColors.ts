/**
 * VR1 chart color language (DESIGN_SYSTEM.md). Charts reference design tokens directly
 * (CSS `var(...)`) so light and dark both work and the palette stays in one place.
 *
 * - `categoricalSeries` — generic multi-series palette (listing types, etc.).
 * - `statusColor` — the SAME semantic colors the status badges use, so a status chart
 *   (listing moderation, request lifecycle) reads consistently with the pills (§18).
 *
 * Never invent data to fill a chart; these only describe how real data is colored.
 */
export const categoricalSeries = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const

export type StatusColorKey = "success" | "warning" | "danger" | "info" | "neutral" | "primary" | "accent"

export const statusColor: Record<StatusColorKey, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
  info: "var(--info)",
  neutral: "var(--muted-foreground)",
  primary: "var(--primary)",
  accent: "var(--brand-accent)",
}

/** The listing-moderation status → chart color map (matches `ListingStatusBadge` tones). */
export const listingStatusColor = {
  pending: statusColor.warning,
  approved: statusColor.success,
  rejected: statusColor.danger,
  archived: statusColor.neutral,
} as const
