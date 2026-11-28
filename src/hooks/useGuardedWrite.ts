import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { acquireWrite, releaseWrite, useWriteInFlight } from "@/hooks/useWriteLock"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"
import { isUnknownOutcome } from "@/lib/api/writeErrors"
import { getIdentityStamp } from "@/lib/api/session"

export const ADMIN_WRITE_TIMEOUT_MS = 30_000

export interface WriteNotice {
  title: string
  description: string
}

/** A check made BEFORE sending failed: nothing was sent, whatever the reason. */
export class NotSent extends Error {
  readonly error: ApiError

  constructor(error: ApiError) {
    super("not sent")
    this.error = error
  }
}

/** `kept`: the refusal belongs to the form, which stays open. `closed`: the page now explains. */
export type GuardedResult = { kept: ApiError } | { closed: true }

interface Options<S> {
  /** One change at a time for this key, for the whole tab. */
  lockKey: string
  /** The server's data as shown now. A new object means a newer copy has arrived. */
  snapshot: S | undefined
  reload: () => void
  closeDialog: () => void
  /** The shown data is behind the server (or what was acted on is gone): close, reload, explain. */
  isBehind: (error: ApiError) => boolean
  explain: (error: ApiError) => WriteNotice
}

function lostAuthority(error: ApiError): boolean {
  if (error.status !== 403) return false
  if (error.code === "email_not_verified") return true
  // A stale sign-in is not lost authority: the person signs in again.
  return error.code === "forbidden" && error.details.every((detail) => detail.code === undefined || detail.code === "forbidden")
}

/**
 * How an administrative change is made (the rules of the grocery staff changes, for any record):
 *  - one at a time per key, sent exactly once, with a time limit;
 *  - nothing on screen changes until the server has answered;
 *  - after a success, or when the screen turns out to be behind, the data is loaded again;
 *  - when the outcome is UNKNOWN nothing is retried, and no change is offered until a newer copy of
 *    the data has arrived;
 *  - a success that arrives after the signed-in account changed does nothing here.
 */
export function useGuardedWrite<S>({ lockKey, snapshot, reload, closeDialog, isBehind, explain }: Options<S>) {
  const { refreshMe } = useAuth()
  const requireOnline = useRequireOnline()
  const pending = useWriteInFlight(lockKey)
  const [notice, setNotice] = useState<WriteNotice | null>(null)
  const [unknown, setUnknown] = useState<{ what: string; before: S | undefined } | null>(null)
  const startedHere = useRef(false)
  // Set before a dialog closes, so it knows whether focus goes to the page's explanation instead.
  const explaining = useRef(false)

  // A change that finished after this screen was left and reopened: load what it did.
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending) {
      if (startedHere.current) startedHere.current = false
      else reload()
    }
    wasPending.current = pending
  }, [pending, reload])

  const run = useCallback(
    async <R,>(
      /** What is being changed, for the message when its outcome is unknown ("the settings"). */
      what: string,
      send: (signal: AbortSignal) => Promise<R>,
      onSaved: (result: R) => void
    ): Promise<GuardedResult | null> => {
      if (snapshot === undefined || !requireOnline() || !acquireWrite(lockKey)) return null
      startedHere.current = true
      explaining.current = false
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ADMIN_WRITE_TIMEOUT_MS)
      const askedAs = getIdentityStamp()
      try {
        const result = await send(controller.signal)
        if (getIdentityStamp() !== askedAs) return { closed: true }
        setNotice(null)
        setUnknown(null)
        closeDialog()
        onSaved(result)
        reload()
        return { closed: true }
      } catch (cause) {
        const notSent = cause instanceof NotSent
        const thrown = notSent ? cause.error : cause
        const error = isApiError(thrown)
          ? thrown
          : new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "No answer." })
        // The auth layer ends the session and the access gate takes the screen away.
        if (error.status === 401 || error.code === "account_disabled") return { closed: true }
        if (!notSent && isUnknownOutcome(error)) {
          explaining.current = true
          setNotice(null)
          setUnknown({ what, before: snapshot })
          closeDialog()
          reload()
          return { closed: true }
        }
        if (isBehind(error) || lostAuthority(error)) {
          explaining.current = true
          setUnknown(null)
          setNotice(explain(error))
          closeDialog()
          if (lostAuthority(error)) void refreshMe({ fresh: true })
          reload()
          return { closed: true }
        }
        return { kept: error }
      } finally {
        clearTimeout(timer)
        releaseWrite(lockKey)
      }
    },
    [snapshot, requireOnline, lockKey, closeDialog, reload, isBehind, explain, refreshMe]
  )

  const locked = unknown !== null && snapshot === unknown.before
  const unknownNotice: WriteNotice | null =
    unknown === null
      ? null
      : locked
        ? {
            title: `We don't know whether ${unknown.what} was saved`,
            description: "Nothing was sent again. Changes are paused until the latest records have been loaded.",
          }
        : {
            title: `Check whether ${unknown.what} was saved`,
            description:
              "We got no clear answer, and nothing was sent again. The records have been reloaded: check them before you do this again. A request that was slow could still arrive.",
          }

  const pageExplains = useCallback(() => explaining.current, [])
  const clearNotice = useCallback(() => {
    setNotice(null)
    setUnknown(null)
  }, [])

  return { run, pending, locked, notice: unknownNotice ?? notice, pageExplains, clearNotice }
}
