import { CircleCheck, Clock, PauseCircle, RefreshCw, type LucideIcon } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { formatDays, formatHours } from "@/features/grocery/format"
import { availabilityMessage } from "@/features/grocery/availabilityCopy"
import { cn } from "@/lib/utils"
import type { GroceryAvailabilityDto } from "@/lib/api/dto/grocery"

const TONE: Record<"open" | "wait" | "off", { box: string; icon: string; Icon: LucideIcon }> = {
  open: { box: "bg-success/10 ring-success/30", icon: "bg-success/15 text-success-text", Icon: CircleCheck },
  wait: { box: "bg-warning/10 ring-warning/30", icon: "bg-warning/15 text-warning-text", Icon: Clock },
  off: { box: "bg-muted/70 ring-border", icon: "bg-muted text-muted-foreground", Icon: PauseCircle },
}

interface AvailabilityStatusProps {
  availability: GroceryAvailabilityDto
  /** Offer to ask the server again. */
  onRefresh?: () => void
  refreshing?: boolean
  className?: string
}

/**
 * Whether orders are being accepted right now, in words and with an icon (never colour alone). It is
 * the server's answer, and only a hint: sending an order is decided again by the server.
 */
function AvailabilityStatus({ availability, onRefresh, refreshing, className }: AvailabilityStatusProps) {
  const message = availabilityMessage(availability)
  const { box, icon, Icon } = TONE[message.tone]
  return (
    <div className={cn("flex flex-wrap items-start gap-3 rounded-2xl p-4 ring-1", box, className)}>
      <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", icon)}>
        <Icon className="size-5" />
      </span>
      {/* A minimum width, so on a phone the button drops below instead of squeezing the words. */}
      <div role="status" className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
        <Typography as="p" variant="label" className="text-base font-semibold">
          {message.title}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground">
          {message.description}
        </Typography>
        {message.showHours && (
          <Typography variant="body-sm" className="text-muted-foreground">
            Opening hours: {formatDays(availability.schedule.operatingDays)}, {formatHours(availability.schedule)}.
          </Typography>
        )}
      </div>
      {onRefresh && (
        <Button type="button" variant="outline" className="h-11" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && "animate-spin")} />
          {refreshing ? "Checking…" : "Check again"}
        </Button>
      )}
    </div>
  )
}

export { AvailabilityStatus }
