import { useCallback } from "react"
import { useToast } from "@/hooks/useToast"

export const OFFLINE_MUTATION_MESSAGE = "You're offline. Reconnect to make changes."

/**
 * Offline guard for state-changing actions (Phase 9G safety fix). Call the returned function first
 * in any handler that creates / edits / resubmits / archives / moderates / publishes product data:
 * online it returns true and nothing else happens; offline it shows an error toast and returns false
 * so the handler must stop BEFORE touching any store or showing a success message. The prototype's
 * stores live in memory (no network), so without this such actions would appear to "succeed" offline.
 * Nothing is queued or retried — the user simply repeats the action once reconnected.
 * Device-local preferences (e.g. Saved items, which persist on the device) deliberately do not use it.
 */
export function useRequireOnline() {
  const { show } = useToast()
  return useCallback(() => {
    if (navigator.onLine) return true
    show(OFFLINE_MUTATION_MESSAGE, { tone: "error" })
    return false
  }, [show])
}
