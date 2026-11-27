import { useCallback, useState } from "react"
import { useRead } from "@/hooks/useRead"
import type { ApiError } from "@/lib/api/errors"

interface Kept<T> {
  key: string
  /** The read answer this came from, so a later answer replaces it (and a manual `replace` stays). */
  source: unknown
  value: T
  at: number
}

/**
 * A read that can be checked again without blanking the screen: while a refresh is on its way (or
 * after it fails) the last answer for the SAME key stays visible, and `at` says when it was received.
 * A different key (another order, another account) never shows the previous one's data. `forgetOn`
 * names the failures after which the old answer must go (access was lost). Nothing is cached beyond
 * this component, and nothing is polled.
 */
export function useRefreshableRead<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options: { enabled?: boolean; forgetOn?: (error: ApiError) => boolean } = {}
) {
  const read = useRead(key, async (signal) => ({ value: await load(signal), at: Date.now() }), options)
  const [kept, setKept] = useState<Kept<T> | null>(null)

  if (read.status === "success" && (!kept || kept.key !== key || kept.source !== read.data)) {
    setKept({ key, source: read.data, value: read.data.value, at: read.data.at })
  }
  // Some failures mean the person may no longer see what is on screen: the kept answer is dropped.
  const forget = read.status === "error" && Boolean(options.forgetOn?.(read.error))
  if (forget && kept) setKept(null)
  const current = !forget && kept && kept.key === key ? kept : null

  /** Show an answer that arrived another way (the response of a write). */
  const replace = useCallback(
    (value: T) => setKept((previous) => (previous ? { ...previous, value, at: Date.now() } : previous)),
    []
  )

  return {
    data: current?.value,
    /** When the shown data was received (ms). */
    receivedAt: current?.at,
    loading: read.status === "loading" && !current,
    refreshing: read.status === "loading" && Boolean(current),
    error: read.status === "error" ? read.error : null,
    refresh: read.retry,
    replace,
  }
}
