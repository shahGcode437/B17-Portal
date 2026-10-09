import { useState } from "react"
import { RefreshCw, WifiOff } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useOnline, useUpdateAvailable } from "@/hooks/usePwa"
import { applyUpdate } from "@/pwa/serviceWorker"

/**
 * App-level PWA status messages (Phase 9G), shown above the mobile tab bar / bottom edge:
 * "update available" (with an explicit Refresh — the app never reloads by itself) and a plain
 * offline notice. The wrapper is a permanently-mounted polite live region so screen readers
 * announce messages as they appear. Nothing here queues or replays user actions: while offline,
 * pages not opened before may not load, and nothing is sent anywhere.
 */
function PwaStatus() {
  const updateAvailable = useUpdateAvailable()
  const online = useOnline()
  const [updateHidden, setUpdateHidden] = useState(false)
  const showUpdate = updateAvailable && !updateHidden

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-dropdown flex flex-col items-center gap-2 px-4 lg:bottom-4"
    >
      {showUpdate && (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
          <RefreshCw className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <Typography as="p" variant="body-sm" className="min-w-0 flex-1">
            A new version of B-17 Portal is available.
          </Typography>
          <Button type="button" size="sm" onClick={() => applyUpdate()}>
            Refresh
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setUpdateHidden(true)}>
            Later
          </Button>
        </div>
      )}
      {!online && (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
          <WifiOff className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Typography as="p" variant="body-sm" className="min-w-0 flex-1">
            You're offline. Pages you haven't opened yet may not load.
          </Typography>
        </div>
      )}
    </div>
  )
}

export { PwaStatus }
