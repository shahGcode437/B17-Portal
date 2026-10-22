import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"

/**
 * `useMutation` — a tiny counterpart to `useRead` for WRITES (Phase 12H).
 *
 *  - `idle | submitting | success | error`.
 *  - Duplicate-click protection: while a mutation is still in flight, a second call shares the
 *    first in-flight promise (same resolution, same thrown error) and no second request is sent.
 *    Pages should still disable the submit button on `pending`; this is defence.
 *  - A late answer from an unmounted hook is dropped.
 *  - A thrown non-`ApiError` becomes a network error, so pages never see a raw `TypeError`.
 *  - `mutate` returns the result on success and rethrows the typed error on failure.
 *  - `reset()` clears the state so the control is usable again after a dialog is dismissed.
 */
export type MutationState<T> =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError }

export type MutationHandle<Args, T> = MutationState<T> & {
  mutate: (args: Args) => Promise<T>
  reset: () => void
  /** `true` while a request is in flight; use this to disable the submit button. */
  pending: boolean
}

function toApiError(cause: unknown): ApiError {
  if (isApiError(cause)) return cause
  return new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "The request could not be completed." })
}

export function useMutation<Args, T>(run: (args: Args) => Promise<T>): MutationHandle<Args, T> {
  const [state, setState] = useState<MutationState<T>>({ status: "idle" })
  const mountedRef = useRef(true)
  const inFlightRef = useRef<Promise<T> | null>(null)
  const runRef = useRef(run)
  // Keep the latest `run` for the async body (updated on every render) and track mount/unmount so
  // a late answer from an unmounted hook is dropped (updated ONCE — not on every render, or a
  // cleanup running between the state-update microtask and the next effect would set
  // `mountedRef.current = false` while the hook is in fact still mounted).
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const mutate = useCallback((args: Args): Promise<T> => {
    if (inFlightRef.current) return inFlightRef.current
    setState({ status: "submitting" })
    const promise = (async () => {
      try {
        const data = await runRef.current(args)
        if (mountedRef.current) setState({ status: "success", data })
        return data
      } catch (cause) {
        const error = toApiError(cause)
        if (mountedRef.current) setState({ status: "error", error })
        throw error
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = promise
    return promise
  }, [])

  const reset = useCallback(() => setState({ status: "idle" }), [])

  return { ...state, mutate, reset, pending: state.status === "submitting" }
}
