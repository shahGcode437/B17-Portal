import { TriangleAlert, WifiOff } from "lucide-react"
import { EmptyState } from "@/components/feedback/EmptyState"
import { applyUpdate } from "@/pwa/serviceWorker"

/** A lazy page's JavaScript failed to download (offline, flaky network, or a chunk replaced by a newer deploy). */
function isLoadFailure(error: unknown): boolean {
  return error instanceof Error && (error.name === "ChunkLoadError" || /dynamically imported module|importing a module script|failed to fetch/i.test(error.message))
}

/**
 * What a route shows when it cannot render (Phase 9G). The common real case is a lazy page
 * that cannot be downloaded while offline, so that gets a clear "You're offline" state; anything
 * else gets a neutral "Something went wrong". "Try again" applies a waiting app update if there is
 * one (it can also be the cause of a missing chunk), otherwise reloads the page.
 */
function RouteError({ error }: { error: unknown }) {
  const offline = !navigator.onLine
  const loadFailure = isLoadFailure(error)

  return (
    <EmptyState
      headingLevel={1}
      icon={offline || loadFailure ? WifiOff : TriangleAlert}
      title={offline ? "You're offline" : loadFailure ? "This page couldn't load" : "Something went wrong"}
      description={offline || loadFailure ? "Check your connection and try again." : "Please try again."}
      actionLabel="Try again"
      onAction={() => {
        if (!applyUpdate()) window.location.reload()
      }}
    />
  )
}

export { RouteError }
