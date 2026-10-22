import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { fetchSaved } from "@/lib/api/reads/saved"
import { saveListing, unsaveListing } from "@/lib/api/writes/saved"
import { ApiError, isApiError } from "@/lib/api/errors"

/**
 * One shared source of truth for "is listing X saved?" (Phase 12H).
 *
 * The Saved API returns full public cards, so for N cards on screen we would do N `GET /saved?…`
 * calls to answer the heart buttons. Instead this hook hydrates ONE paginated sweep of `/saved` on
 * first use (per signed-in session), keeps the set of saved listing ids in memory, and the write
 * hooks update it with the authoritative server status.
 *
 * The set is in-memory only — never `localStorage` — so the server stays the source of truth. A
 * failed hydrate leaves the set empty rather than caching a wrong answer: SaveButton treats "not in
 * set" as "not saved" and the mutation reconciles when the user acts. Anonymous callers get a
 * disabled set (the SaveButton redirects them to Log In instead).
 */
const PAGE = 50

type Hydration =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "failed"; error: ApiError }

interface SavedSet {
  isSaved: (id: string) => boolean
  save: (id: string) => Promise<void>
  unsave: (id: string) => Promise<void>
  /** Signed-in and the Saved set has been loaded at least once. */
  ready: boolean
  hydration: Hydration
}

// A module-level set that lives for the page session (one in-memory copy per tab, shared across
// every mounted `SaveButton`). Cleared when the user signs out.
const ids = new Set<string>()
const listeners = new Set<() => void>()
let hydrated = false
let hydrating: Promise<void> | null = null
let lastHydrationError: ApiError | null = null
let lastKnownUserId: string | null = null
/** Bumped every time the saved set changes; `useSaved` includes this in its read key so the list refreshes. */
let version = 0

export function savedSetVersion(): number {
  return version
}

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

function clearSet(): void {
  ids.clear()
  hydrated = false
  hydrating = null
  lastHydrationError = null
  emit()
}

async function hydrateOnce(): Promise<void> {
  if (hydrated || hydrating) return hydrating ?? Promise.resolve()
  hydrating = (async () => {
    try {
      let offset = 0
      // Walk the whole saved list once. For hundreds of items this is fine; above that we'll move
      // to on-demand per-id lookups (a backend endpoint for that is future work).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await fetchSaved({ limit: PAGE, offset })
        for (const row of page.items) ids.add(row.item.id)
        if (page.items.length < PAGE || offset + page.items.length >= page.meta.total) break
        offset += page.items.length
      }
      hydrated = true
      lastHydrationError = null
    } catch (cause) {
      lastHydrationError = isApiError(cause) ? cause : new ApiError({ status: 0, code: "network_error", message: "x" })
      hydrated = false
    } finally {
      hydrating = null
      emit()
    }
  })()
  return hydrating
}

export function useSavedSet(): SavedSet {
  const { user, status } = useAuth()
  const userId = user?.id ?? null
  const [, setTick] = useState(0)
  const subRef = useRef(() => setTick((n) => n + 1))

  // Wipe the shared set on a confirmed sign-out or user switch (the ids belonged to the previous
  // session). Done in an effect so the write happens outside render; the only module-level writer.
  useEffect(() => {
    if (status === "loading" || status === "unavailable") return
    if (lastKnownUserId !== userId) {
      lastKnownUserId = userId
      clearSet()
    }
  }, [status, userId])

  useEffect(() => {
    const listener = subRef.current
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])

  useEffect(() => {
    if (status === "authenticated") void hydrateOnce()
  }, [status, userId])

  const save = useCallback(async (id: string) => {
    await saveListing(id)
    ids.add(id)
    emit()
  }, [])

  const unsave = useCallback(async (id: string) => {
    await unsaveListing(id)
    ids.delete(id)
    emit()
  }, [])

  const hydration: Hydration = hydrating
    ? { status: "loading" }
    : hydrated
      ? { status: "ready" }
      : lastHydrationError
        ? { status: "failed", error: lastHydrationError }
        : { status: "idle" }

  return {
    isSaved: (id) => ids.has(id),
    save,
    unsave,
    ready: status === "authenticated" && hydrated,
    hydration,
  }
}

/** For tests: forget the shared set between runs. */
export function _resetSavedSetForTests(): void {
  clearSet()
  lastKnownUserId = null
}
