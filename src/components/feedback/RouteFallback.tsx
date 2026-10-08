import { Loader2 } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"

/**
 * Shown while a lazily-loaded route page downloads (Phase 9H). Lives inside the
 * layout shell's <main>, so the header / navigation stay in place and nothing
 * jumps; the reserved height avoids a layout shift when the page replaces it.
 * Text, not a fake progress value: the spinner is decorative and the
 * "Loading page" label is what is announced (global reduced-motion CSS
 * already neutralises the spin).
 */
function RouteFallback() {
  return (
    <div role="status" className="flex min-h-[50svh] flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      <Typography variant="body-sm" className="text-muted-foreground">
        Loading page
      </Typography>
    </div>
  )
}

export { RouteFallback }
