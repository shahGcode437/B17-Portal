import { useEffect, useRef } from "react"
import { useAuth } from "@/hooks/useAuth"
import { syncDraftWithAuth, useGroceryDraft } from "@/features/grocery/groceryDraftStore"

/**
 * Mounted once, beside the router: keeps the in-memory grocery draft in step with who is signed in
 * (so signing out from ANY page clears it), and asks before a reload or tab close while an order is
 * being sent or its outcome is unknown — leaving then would lose the one safe way to retry it.
 */
function GroceryDraftSession() {
  const { status, user, notice } = useAuth()
  const decided = useRef<"authenticated" | "anonymous" | null>(null)
  const userId = user?.id ?? null
  const unresolved = useGroceryDraft((draft) => draft.phase !== "idle")

  useEffect(() => {
    syncDraftWithAuth(decided.current, status, userId, notice)
    if (status === "authenticated" || status === "anonymous") decided.current = status
    if (status === "authenticated" && userId) useGroceryDraft.getState().loadRecovery(userId)
  }, [status, userId, notice])

  useEffect(() => {
    if (!unresolved) return
    const ask = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", ask)
    return () => window.removeEventListener("beforeunload", ask)
  }, [unresolved])

  return null
}

export { GroceryDraftSession }
