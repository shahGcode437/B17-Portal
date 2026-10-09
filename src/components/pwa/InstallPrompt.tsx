import { Download, Share, X } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useInstallMode } from "@/hooks/usePwa"
import { dismissInstall, promptInstall } from "@/pwa/install"
import { site } from "@/data/site"

/**
 * A quiet, dismissible "install the app" strip (Phase 9G), rendered in-flow just above the footer —
 * never a modal, never overlaying content, and never required: the website works fully without it.
 * Native browsers get a real Install button; iOS gets the manual Share -> Add to Home Screen steps
 * (there is no install API there). Nothing renders when the app is installed/standalone, was
 * dismissed within the last 30 days, or the browser has no install path.
 */
function InstallPrompt() {
  const mode = useInstallMode()
  if (mode === "none") return null

  return (
    <section aria-label={`Install ${site.name}`} className="pb-6 pt-2">
      <Container>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-subtle">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Download className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <Typography as="p" variant="label">
              Install {site.name}
            </Typography>
            {mode === "native" ? (
              <Typography as="p" variant="body-sm" className="text-muted-foreground">
                Add it to your device for quick, app-like access.
              </Typography>
            ) : (
              <Typography as="p" variant="body-sm" className="text-muted-foreground">
                Tap <Share className="mx-0.5 inline size-3.5 align-text-bottom" aria-hidden="true" />
                <span className="font-medium text-foreground">Share</span>, then{" "}
                <span className="font-medium text-foreground">Add to Home Screen</span>.
              </Typography>
            )}
          </div>
          {mode === "native" && (
            <Button type="button" className="shrink-0" onClick={() => void promptInstall()}>
              Install
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Dismiss install suggestion"
            onClick={dismissInstall}
          >
            <X />
          </Button>
        </div>
      </Container>
    </section>
  )
}

export { InstallPrompt }
