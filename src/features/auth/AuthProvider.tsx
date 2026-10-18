import * as React from "react"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import * as authApi from "@/lib/api/auth"
import { ApiError, isApiError } from "@/lib/api/errors"
import { clearCsrfToken, setCsrfToken, setSessionHandlers } from "@/lib/api/session"
import { useResidentStore } from "@/state/residentStore"
import { usePlanStore } from "@/state/planStore"
import type { AuthNotice, AuthStatus, AuthUser, CurrentUser } from "@/types/auth"

interface AuthState {
  status: AuthStatus
  user: CurrentUser | null
  notice: AuthNotice | null
  bootstrapError: ApiError | null
}

type AuthAction =
  | { type: "authenticated"; user: CurrentUser }
  | { type: "anonymous"; notice: AuthNotice | null }
  | { type: "unavailable"; error: ApiError }
  | { type: "loading" }
  | { type: "dismissNotice" }

const initialState: AuthState = { status: "loading", user: null, notice: null, bootstrapError: null }

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "authenticated":
      return { status: "authenticated", user: action.user, notice: null, bootstrapError: null }
    case "anonymous":
      return { status: "anonymous", user: null, notice: action.notice, bootstrapError: null }
    case "unavailable":
      return { status: "unavailable", user: null, notice: null, bootstrapError: action.error }
    case "loading":
      return { ...state, status: "loading", bootstrapError: null }
    case "dismissNotice":
      return { ...state, notice: null }
  }
}

/** Splits the CSRF token (kept in memory, outside React state) from the user the UI renders. */
function adopt(payload: AuthUser): CurrentUser {
  const { csrfToken, ...user } = payload
  setCsrfToken(csrfToken)
  return user
}

/**
 * The real authentication state machine (Phase 12C; replaces the demo name-only auth).
 *
 *  - Bootstrap: `loading` → `GET /auth/me` → `authenticated` (200) | `anonymous` (401) |
 *    `unavailable` (network / server failure — recoverable, never mistaken for "logged out").
 *  - The session is an HttpOnly cookie JavaScript cannot read; the CSRF token lives only in
 *    `lib/api/session` memory. Nothing auth-related touches localStorage / sessionStorage.
 *  - Races: an `epoch` counter is bumped by every auth-changing event (login, register, logout,
 *    session loss); a `/auth/me` answer that was requested in an older epoch is ignored. Concurrent
 *    `refreshMe()` calls share one in-flight request. There is no polling.
 *  - Per-user demo client state (`residentStore`, `planStore`, until their Phase 12 slices) is
 *    cleared on every CONFIRMED transition to anonymous (logout, 401, `account_disabled`, including
 *    a 401 on the bootstrap read) and kept across an authenticated reload; `unavailable` never clears it.
 */
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState)
  const epoch = React.useRef(0)
  const inflight = React.useRef<{ epoch: number; promise: Promise<boolean> } | null>(null)
  const latestRequest = React.useRef(0)

  const endSession = React.useCallback((notice: AuthNotice | null) => {
    epoch.current += 1
    clearCsrfToken()
    // Per-user demo state (Saved, requests, plan) may survive an AUTHENTICATED reload but must never
    // survive a CONFIRMED anonymous: this runs for logout, a definitive 401 (also on the bootstrap
    // read, e.g. the cookie expired while the browser was closed) and `account_disabled`. It is never
    // reached for network / 5xx failures — those are `unavailable`, which proves nothing about the session.
    useResidentStore.getState().clearResidentData()
    usePlanStore.getState().resetPlan()
    dispatch({ type: "anonymous", notice })
  }, [])

  const refreshMe = React.useCallback((options?: { fresh?: boolean }): Promise<boolean> => {
    const requestedAt = epoch.current
    // Share one request among concurrent callers — but never one that was started before a
    // login / logout (its answer is stale), and never when the caller needs a post-action read.
    if (!options?.fresh && inflight.current && inflight.current.epoch === requestedAt) {
      return inflight.current.promise
    }
    const sequence = ++latestRequest.current
    // An answer is applied only if no newer read was started meanwhile (older ones are ignored).
    const superseded = () => requestedAt !== epoch.current || sequence !== latestRequest.current
    const entry: { epoch: number; promise: Promise<boolean> } = {
      epoch: requestedAt,
      promise: Promise.resolve(false),
    }
    entry.promise = (async (): Promise<boolean> => {
      try {
        const payload = await authApi.fetchMe()
        if (superseded()) return false // overtaken by login / logout / a newer read
        dispatch({ type: "authenticated", user: adopt(payload) })
        return true
      } catch (cause) {
        if (superseded()) return false
        if (isApiError(cause) && cause.status === 401) {
          endSession(cause.code === "session_expired" ? "expired" : null)
          return false
        }
        if (isApiError(cause) && cause.code === "account_disabled") {
          endSession("disabled")
          return false
        }
        dispatch({
          type: "unavailable",
          error: isApiError(cause) ? cause : new ApiError({ status: 0, code: "network_error", message: "Unavailable" }),
        })
        return false
      } finally {
        if (inflight.current === entry) inflight.current = null
      }
    })()
    inflight.current = entry
    return entry.promise
  }, [endSession])

  // Bootstrap once, and let the API client call back into the auth layer.
  React.useEffect(() => {
    setSessionHandlers({
      refreshSession: () => refreshMe({ fresh: true }),
      onSessionLost: (code) => endSession(code === "account_disabled" ? "disabled" : "expired"),
    })
    void refreshMe()
    return () => setSessionHandlers(null)
  }, [refreshMe, endSession])

  const login = React.useCallback(async (email: string, password: string) => {
    const payload = await authApi.login(email, password)
    epoch.current += 1
    const user = adopt(payload)
    dispatch({ type: "authenticated", user })
    return user
  }, [])

  const register = React.useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      const payload = await authApi.register(input)
      epoch.current += 1
      const user = adopt(payload)
      dispatch({ type: "authenticated", user })
      return user
    },
    []
  )

  const logout = React.useCallback(async () => {
    try {
      await authApi.logout()
    } catch (cause) {
      // Already signed out on the server (expired / revoked): that is the same end state.
      if (!(isApiError(cause) && cause.status === 401)) throw cause
    }
    endSession(null)
  }, [endSession])

  const retryBootstrap = React.useCallback(() => {
    dispatch({ type: "loading" })
    void refreshMe()
  }, [refreshMe])

  const dismissNotice = React.useCallback(() => dispatch({ type: "dismissNotice" }), [])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      isAuthenticated: state.status === "authenticated",
      notice: state.notice,
      bootstrapError: state.bootstrapError,
      login,
      register,
      logout,
      refreshMe,
      retryBootstrap,
      dismissNotice,
    }),
    [state, login, register, logout, refreshMe, retryBootstrap, dismissNotice]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthProvider }
