import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/** Shared semantic tones — Resident requests, Professional leads and listing moderation all speak this one language. */
export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral"

/**
 * Text colors are the dedicated `-text` status tokens (index.css), which keep
 * ≥4.5:1 on their own tint; the plain `success`/`warning`/`info` tokens do not.
 */
const toneClasses: Record<StatusTone, string> = {
  success: "bg-success/15 text-success-text",
  warning: "bg-warning/15 text-warning-text",
  info: "bg-info/15 text-info-text",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
}

interface StatusBadgeProps {
  tone: StatusTone
  icon: LucideIcon
  label: string
  className?: string
}

/**
 * Status pill (DESIGN_SYSTEM.md §16): always an icon AND a text label, so
 * status is never conveyed by color alone. Domain wrappers
 * (`ListingStatusBadge`, `RequestStatusBadge`) only map their status → tone/icon/label.
 */
function StatusBadge({ tone, icon: Icon, label, className }: StatusBadgeProps) {
  return (
    <Badge className={cn("gap-1 font-normal", toneClasses[tone], className)}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}

export { StatusBadge }
