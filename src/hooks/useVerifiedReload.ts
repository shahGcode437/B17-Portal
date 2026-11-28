import { useCallback, useEffect, useRef } from "react"
import { useAuth } from "@/hooks/useAuth"
import { fetchMe } from "@/lib/api/auth"
import { isApiError, type ApiError } from "@/lib/api/errors"
import type { AuthUser, CurrentUser } from "@/types/auth"

/** Coming back to the tab reloads the data again, but not more often than this. */
export const RELOAD_AFTER_MS = 15_000

function authorityOf(user: Pick<CurrentUser, "id" | "roles" | "staffScopes" | "emailVerified">): string {
  return JSON.stringify([user.id, [...user.roles].sort(), [...(user.staffScopes ?? [])].sort(), user.emailVerified])
}

/**
 * Before a staff or administrative screen loads anything again, find out who this browser is NOW
 * signed in as: another tab may have logged out, signed in someone else, or the access may have been
 * removed. If anything about the account differs, the auth layer re-reads it (and the access gate
 * then remounts, redirects or refuses). `false`: don't load with what is on screen (another account,
 * or no access any more). A change that keeps this account's access still loads.
 *
 * It asks `/auth/me` itself first, so that a server that cannot be reached leaves the screen as it
 * is instead of turning the whole app into "can't reach the server".
 */
function useVerifyIdentity(user: CurrentUser, mayAccess: (now: AuthUser) => boolean) {
  const { refreshMe } = useAuth()
  const expected = authorityOf(user)
  const userId = user.id
  const inFlight = useRef<Promise<boolean> | null>(null)
  const mayAccessRef = useRef(mayAccess)
  useEffect(() => {
    mayAccessRef.current = mayAccess
  })

  return useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    const check = (async () => {
      let stillMayLoad = false
      try {
        const now = await fetchMe()
        if (authorityOf(now) === expected) return true
        stillMayLoad = now.id === userId && now.emailVerified && mayAccessRef.current(now)
      } catch (cause) {
        const signedOut = isApiError(cause) && (cause.status === 401 || cause.code === "account_disabled")
        if (!signedOut) return true // could not ask: the data read will report the problem
      }
      await refreshMe({ fresh: true })
      return stillMayLoad
    })().finally(() => {
      inFlight.current = null
    })
    inFlight.current = check
    return check
  }, [expected, userId, refreshMe])
}

/**
 * `reload` for a "Refresh" button, and the same on returning to the tab or coming back online
 * (identity every time; the data at most every `RELOAD_AFTER_MS`). No polling.
 */
export function useVerifiedReload(user: CurrentUser, reload: () => void, mayAccess: (now: AuthUser) => boolean) {
  const verify = useVerifyIdentity(user, mayAccess)
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })
  const lastLoad = useRef(0)
  useEffect(() => {
    lastLoad.current = Date.now()
  }, [])

  const reloadNow = useCallback(async () => {
    if (!(await verify())) return
    lastLoad.current = Date.now()
    reloadRef.current()
  }, [verify])

  useEffect(() => {
    const returned = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return
      void verify().then((same) => {
        if (!same || Date.now() - lastLoad.current < RELOAD_AFTER_MS) return
        lastLoad.current = Date.now()
        reloadRef.current()
      })
    }
    window.addEventListener("focus", returned)
    window.addEventListener("online", returned)
    document.addEventListener("visibilitychange", returned)
    return () => {
      window.removeEventListener("focus", returned)
      window.removeEventListener("online", returned)
      document.removeEventListener("visibilitychange", returned)
    }
  }, [verify])

  return reloadNow
}

/** A read refused for lack of authority: re-read the account, so the access gate takes over. */
export function useReportRefusedRead(error: ApiError | null, lostAccess: (error: ApiError) => boolean) {
  const { refreshMe } = useAuth()
  const reported = useRef<ApiError | null>(null)
  useEffect(() => {
    if (!error || !lostAccess(error) || reported.current === error) return
    reported.current = error
    void refreshMe({ fresh: true })
  }, [error, lostAccess, refreshMe])
}
