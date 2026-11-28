import { RefreshCw, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Typography } from "@/components/foundation/Typography"
import { FormAlert } from "@/components/forms/FormAlert"
import { useOnline } from "@/hooks/usePwa"
import { cn } from "@/lib/utils"

const CHECKED = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit", hour12: true })

interface RefreshBarProps {
  receivedAt: number | undefined
  refreshing: boolean
  /** The last reload failed and an older answer is on screen. */
  failed: boolean
  onRefresh: () => void
}

/** Manual refresh, when the data arrived, and honest offline / failed-refresh states. Nothing polls. */
function RefreshBar({ receivedAt, refreshing, failed, onRefresh }: RefreshBarProps) {
  const online = useOnline()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="h-11" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden="true" />
          {refreshing ? "Checking…" : "Refresh"}
        </Button>
        <Typography variant="body-sm" role="status" className="text-muted-foreground">
          {receivedAt ? `Last loaded ${CHECKED.format(new Date(receivedAt))} (Pakistan time).` : ""}
        </Typography>
      </div>
      {!online && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-warning/10 p-3 ring-1 ring-warning/35">
          <WifiOff className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
          <Typography variant="body-sm">
            You're offline. What's shown may be out of date, and no change can be made until you reconnect.
          </Typography>
        </div>
      )}
      {failed && (
        <FormAlert tone="warning" title="Couldn't refresh" description="You're seeing the last version we received." />
      )}
    </div>
  )
}

export { RefreshBar }
