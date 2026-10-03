import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { CardImage } from "@/components/media/CardImage"

interface AdminRowProps {
  /** Thumbnail or kind icon (see `AdminThumb`). */
  leading: ReactNode
  /** Title and meta lines — the row's identity. */
  children: ReactNode
  /** Status badge. */
  status: ReactNode
  /** Primary action first, secondary after. */
  actions: ReactNode
}

/**
 * Dense Admin list row (moderation queue, content list): identity on the
 * left; status + actions on the right from `sm`, stacked beneath on mobile.
 * Presentation only — it owns no state and no domain knowledge, so it works
 * the same for server-paginated data later. Built on the shared `Card`
 * workspace surface with tighter padding than the Professional workspace.
 */
function AdminRow({ leading, children, status, actions }: AdminRowProps) {
  return (
    <Card variant="workspace" className="gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:shrink-0 sm:justify-end sm:gap-3">
        {status}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </Card>
  )
}

interface AdminThumbProps {
  src?: string
  icon: LucideIcon
  label: string
}

/**
 * A small thumbnail only when the record actually has an image (with the
 * shared `CardImage` fallback if it fails to load); otherwise a compact
 * kind-icon tile — no placeholder media slot is invented for text-only items.
 */
function AdminThumb({ src, icon: Icon, label }: AdminThumbProps) {
  if (src) {
    return <CardImage src={src} icon={Icon} label={label} tone="accent" className="aspect-square size-14 shrink-0" />
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  )
}

export { AdminRow, AdminThumb }
