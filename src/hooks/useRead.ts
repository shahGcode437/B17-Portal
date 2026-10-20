import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"

/**
 * One server read with an honest lifecycle (Phase 12G): `loading` -> `success` | `error`, a retry,
 * and protection against stale answers.
 *
 *  - The request is identified by `key` (a string that captures everything the read depends on).
 *    When the key changes the previous request is ABORTED and its answer can never be applied, so a
 *    slow response to an old query cannot overwrite the state for a newer one. The state a caller
 *    sees is derived from the key it is rendering now: a result produced for another key is treated
 *    as "loading", never shown.
 *  - `enabled: false` keeps the read in `loading` without sending anything (a private page waits
 *    here for the auth bootstrap instead of firing a request that must fail).
 *  - Failures are `ApiError`s from the central client (`status` 0 = the server could not be reached).
 *  - No data is invented on failure: there is no fallback to local demo content.
 */
export type ReadState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError }

export type ReadResult<T> = ReadState<T> & { retry: () => void }

interface Settled<T> {
  key: string
  state: Exclude<ReadState<T>, { status: "loading" }>
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError"
}

function toApiError(cause: unknown): ApiError {
  if (isApiError(cause)) return cause
  return new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "The request could not be completed." })
}

export function useRead<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options: { enabled?: boolean } = {}
): ReadResult<T> {
  const enabled = options.enabled ?? true
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const requestKey = `${key}#${attempt}`

  // The latest loader without making every inline closure a dependency of the effect below.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ key: requestKey, state: { status: "success", data } })
      },
      (cause: unknown) => {
        if (controller.signal.aborted || isAbort(cause)) return
        setSettled({ key: requestKey, state: { status: "error", error: toApiError(cause) } })
      }
    )
    return () => controller.abort()
  }, [requestKey, enabled])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current: ReadState<T> = enabled && settled && settled.key === requestKey ? settled.state : { status: "loading" }
  return { ...current, retry }
}
