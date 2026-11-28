import { useCallback, useEffect, useRef, useState } from "react"
import { OperationAbandoned } from "@/lib/api/abandoned"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"
import { getIdentityStamp } from "@/lib/api/session"

/**
 * `useMutation` — a tiny counterpart to `useRead` for WRITES (Phase 12H).
 *
 *  - `idle | submitting | success | error`.
 *  - Duplicate-click protection: while a mutation is still in flight, a second call shares the
 *    first in-flight promise (same resolution, same thrown error) and no second request is sent.
 *    Pages should still disable the submit button on `pending`; this is defence.
 *  - A late answer from an unmounted hook is dropped.
 *  - If the signed-in account changed while it was under way, whatever the outcome, `mutate` rejects
 *    with `OperationAbandoned` and the state returns to `idle`: the caller's success path never runs,
 *    nothing stays held, and no outcome is claimed (the request may well have been carried out). The
 *    caller needs no special case: its screen has been replaced and can no longer show a message.
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
    const askedAs = getIdentityStamp()
    const abandoned = () => {
      if (getIdentityStamp() === askedAs) return false
      if (mountedRef.current) setState({ status: "idle" })
      return true
    }
    const promise = (async () => {
      try {
        let data: T
        try {
          data = await runRef.current(args)
        } catch (cause) {
          if (abandoned()) throw new OperationAbandoned()
          const error = toApiError(cause)
          if (mountedRef.current) setState({ status: "error", error })
          throw error
        }
        if (abandoned()) throw new OperationAbandoned()
        if (mountedRef.current) setState({ status: "success", data })
        return data
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
