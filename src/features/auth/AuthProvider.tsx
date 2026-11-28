import * as React from "react"
import { flushSync } from "react-dom"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import { createAuthChannel, type AuthChannel } from "@/features/auth/authChannel"
import { IdentityCheckCover, type IdentityCheck } from "@/features/auth/IdentityCheckCover"
import * as authApi from "@/lib/api/auth"
import { ApiError, isApiError } from "@/lib/api/errors"
import { clearCsrfToken, noteIdentity, setCsrfToken, setSessionHandlers, type SessionObservation } from "@/lib/api/session"
import type { AuthNotice, AuthStatus, AuthUser, CurrentUser } from "@/types/auth"

/** Coming back to a tab asks again who is signed in, if it last asked longer ago than this. */
const RETURN_CHECK_AFTER_MS = 10_000
/** An `/auth/me` asked only to confirm something gives up after this. */
const CONFIRM_TIMEOUT_MS = 15_000

/**
 * A staff account on a server where asking `/auth/me` still counts as staff activity (one that
 * doesn't announce `readBinding`, `AUTH_RBAC.md` §38.4): asking by ourselves would keep an idle
 * staff session alive.
 */
const askingKeepsStaffFresh = (user: CurrentUser) =>
  !user.readBinding && (user.roles.includes("admin") || user.roles.includes("moderator"))

/** Everything a screen shows about the account. The session's expiry slides and is not part of it. */
const accountFacts = (user: CurrentUser) => JSON.stringify({ ...user, session: undefined })

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
      // Asking again often says nothing new; keeping the same object keeps screens from reloading.
      if (state.status === "authenticated" && state.user && accountFacts(state.user) === accountFacts(action.user)) {
        return state
      }
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
  noteIdentity(user.id)
  return user
}

/**
 * The real authentication state machine (Phase 12C; replaces the demo name-only auth).
 *
 *  - Bootstrap: `loading` → `GET /auth/me` → `authenticated` (200) | `anonymous` (401) |
 *    `unavailable` (network / server failure — recoverable, never mistaken for "logged out").
 *  - The session is an HttpOnly cookie JavaScript cannot read; the CSRF token lives only in
 *    `lib/api/session` memory. Nothing auth-related touches localStorage / sessionStorage.
 *  - `unavailable` is re-checked silently on `online` / `focus` / tab-visible (no polling), so a session that was
 *    only unreachable for a while stops looking logged out without a reload.
 *  - Races: an `epoch` counter is bumped by every auth-changing event (login, register, logout,
 *    session loss); a `/auth/me` answer that was requested in an older epoch is ignored. Concurrent
 *    `refreshMe()` calls share one in-flight request. There is no polling.
 *  - The cookie is shared by every tab, so any `/auth/me` answer may name another account. The
 *    screens are then rebuilt (`app/AccountBoundary`), and the API client never re-sends a change.
 *  - Tabs tell each other that something changed (`authChannel`, a signal with nothing in it). A
 *    tab that hears it covers its screen (`IdentityCheckCover`) until `/auth/me` has said who it is.
 *    Returning to a tab asks again too, staff tabs included: the current server doesn't count
 *    `/auth/me` as staff activity. With an OLDER server (no `readBinding`) a staff tab leaves it
 *    to the signal, because there asking would keep an idle staff session alive.
 *  - The API client asks here to confirm every private answer (`observeSession`).
 *  - Since Phase 12H, there is NO per-user state in client stores — Saved, requests, listings and
 *    the plan all live on the backend and are refetched on sign-in. `useSavedSet` clears its
 *    in-memory id set whenever the account changes, so a shared browser cannot leak the previous
 *    user's set to the next one.
 */
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState)
  const epoch = React.useRef(0)
  const inflight = React.useRef<{ epoch: number; promise: Promise<boolean> } | null>(null)
  const latestRequest = React.useRef(0)
  /** The newest `/auth/me` whose answer has been applied: an older one is never applied after it. */
  const lastApplied = React.useRef(0)
  const lastAsked = React.useRef(0)
  const shown = React.useRef(state)
  React.useLayoutEffect(() => {
    shown.current = state
  })

  const channel = React.useRef<AuthChannel | null>(null)
  const announce = React.useCallback(() => channel.current?.announce(), [])

  const [check, setCheck] = React.useState<IdentityCheck | null>(null)
  const covered = React.useRef(false)
  const uncover = React.useCallback(() => {
    covered.current = false
    setCheck(null)
  }, [])

  const endSession = React.useCallback(
    (notice: AuthNotice | null) => {
      epoch.current += 1
      clearCsrfToken()
      noteIdentity(null)
      uncover()
      dispatch({ type: "anonymous", notice })
    },
    [uncover]
  )

  /**
   * One `/auth/me`: applies what it says, unless something newer already has, and reports it.
   * `quiet`: it is only asked to confirm something, so no answer changes nothing (it never turns
   * the app into "can't reach the server"). `overtaken`: somebody signed in or out meanwhile.
   */
  const readSession = React.useCallback(
    async (quiet: boolean): Promise<{ seen: SessionObservation; overtaken: boolean }> => {
      const requestedAt = epoch.current
      const sequence = ++latestRequest.current
      lastAsked.current = Date.now()
      const overtaken = () => requestedAt !== epoch.current
      const outdated = () => overtaken() || sequence < lastApplied.current
      // Not `AbortSignal.timeout`: Safari only has it from version 16.
      const deadline = quiet ? new AbortController() : null
      const timer = deadline ? setTimeout(() => deadline.abort(), CONFIRM_TIMEOUT_MS) : undefined
      try {
        const payload = await authApi.fetchMe(deadline?.signal)
        const result = { seen: { kind: "session", token: payload.csrfToken } as const, overtaken: overtaken() }
        if (!outdated()) {
          lastApplied.current = sequence
          // The token in memory and the screen it belongs to change together. If this answer is for
          // another account, that account's token must never be reachable from the previous one's
          // screen, not even for the moment before React would redraw it on its own.
          flushSync(() => dispatch({ type: "authenticated", user: adopt(payload) }))
        }
        return result
      } catch (cause) {
        const signedOut = isApiError(cause) && (cause.status === 401 || cause.code === "account_disabled")
        const result = { seen: { kind: signedOut ? "none" : "unknown" } as const, overtaken: overtaken() }
        if (outdated() || (!signedOut && quiet)) return result
        lastApplied.current = sequence
        if (signedOut) {
          const code = (cause as ApiError).code
          flushSync(() => endSession(code === "session_expired" ? "expired" : code === "account_disabled" ? "disabled" : null))
        } else {
          dispatch({
            type: "unavailable",
            error: isApiError(cause) ? cause : new ApiError({ status: 0, code: "network_error", message: "Unavailable" }),
          })
        }
        return result
      } finally {
        clearTimeout(timer)
      }
    },
    [endSession]
  )

  const refreshMe = React.useCallback(
    (options?: { fresh?: boolean }): Promise<boolean> => {
      const requestedAt = epoch.current
      // Share one request among concurrent callers — but never one that was started before a
      // login / logout (its answer is stale), and never when the caller needs a post-action read.
      if (!options?.fresh && inflight.current && inflight.current.epoch === requestedAt) {
        return inflight.current.promise
      }
      const entry: { epoch: number; promise: Promise<boolean> } = { epoch: requestedAt, promise: Promise.resolve(false) }
      entry.promise = readSession(false).then(({ seen, overtaken }) => {
        if (inflight.current === entry) inflight.current = null
        return seen.kind === "session" && !overtaken
      })
      inflight.current = entry
      return entry.promise
    },
    [readSession]
  )

  // Asking again because the sign-in may have changed. One request at a time; an announcement that
  // arrives while one is on its way asks for exactly one more, however many arrive.
  const checking = React.useRef(false)
  const askAgain = React.useRef(false)
  const recheck = React.useCallback(
    async (why: "announced" | "returned" | "retry") => {
      // Cover the screen when there is reason to think it may be somebody else's, and there is
      // something private on it. A plain return to the tab is no such reason.
      if ((why === "announced" && shown.current.status === "authenticated") || (why === "retry" && covered.current)) {
        covered.current = true
        setCheck("checking")
      }
      if (checking.current) {
        if (why !== "returned") askAgain.current = true // the one on its way may predate the change
        return
      }
      checking.current = true
      let seen: SessionObservation
      do {
        askAgain.current = false
        seen = (await readSession(true)).seen
      } while (askAgain.current)
      checking.current = false
      if (!covered.current) return
      if (seen.kind === "unknown") setCheck("unconfirmed")
      else uncover()
    },
    [readSession, uncover]
  )

  React.useEffect(() => {
    const opened = createAuthChannel(() => void recheck("announced"))
    channel.current = opened
    return () => {
      opened.close()
      channel.current = null
    }
  }, [recheck])

  React.useEffect(() => {
    const returned = () => {
      if (document.visibilityState !== "visible") return
      if (covered.current) return void recheck("retry")
      const { status, user } = shown.current
      if (status !== "authenticated" && status !== "anonymous") return
      if (channel.current?.supported && user && askingKeepsStaffFresh(user)) return
      if (Date.now() - lastAsked.current < RETURN_CHECK_AFTER_MS) return
      void recheck("returned")
    }
    const online = () => {
      if (covered.current) void recheck("retry")
    }
    // A page brought back from the back-forward cache heard nothing while it was away.
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void recheck("announced")
    }
    window.addEventListener("focus", returned)
    window.addEventListener("online", online)
    window.addEventListener("pageshow", restored)
    document.addEventListener("visibilitychange", returned)
    return () => {
      window.removeEventListener("focus", returned)
      window.removeEventListener("online", online)
      window.removeEventListener("pageshow", restored)
      document.removeEventListener("visibilitychange", returned)
    }
  }, [recheck])

  // Bootstrap once, and let the API client call back into the auth layer.
  React.useEffect(() => {
    setSessionHandlers({
      refreshSession: () => refreshMe({ fresh: true }),
      observeSession: () => readSession(true).then(({ seen }) => seen),
      onSessionLost: (code) => {
        const lost = shown.current.user
        endSession(code === "account_disabled" ? "disabled" : "expired")
        // On an older server a staff session refused for age is still alive, and another tab asking
        // `/auth/me` because of this would make it fresh again.
        if (lost && (code === "account_disabled" || !askingKeepsStaffFresh(lost))) announce()
      },
      onSessionMismatch: () => recheck("announced"),
    })
    // A page that loads signed in may be the return from Google sign-in, which changed the cookie
    // for every tab.
    void refreshMe().then((signedIn) => {
      if (signedIn) announce()
    })
    return () => setSessionHandlers(null)
  }, [refreshMe, readSession, endSession, announce, recheck])

  // `unavailable` is recoverable (the API restarted, the network dropped): re-check quietly when the network comes
  // back or the person returns to the tab, so a valid session is not left looking logged out. Event-driven, no
  // polling; a failed re-check simply leaves the state as it was.
  React.useEffect(() => {
    if (state.status !== "unavailable") return
    const again = () => void refreshMe()
    const onVisible = () => {
      if (document.visibilityState === "visible") again()
    }
    window.addEventListener("online", again)
    window.addEventListener("focus", again)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("online", again)
      window.removeEventListener("focus", again)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [state.status, refreshMe])

  const login = React.useCallback(
    async (email: string, password: string) => {
      const payload = await authApi.login(email, password)
      epoch.current += 1
      const user = adopt(payload)
      uncover()
      dispatch({ type: "authenticated", user })
      announce()
      return user
    },
    [announce, uncover]
  )

  const register = React.useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      const payload = await authApi.register(input)
      epoch.current += 1
      const user = adopt(payload)
      uncover()
      dispatch({ type: "authenticated", user })
      announce()
      return user
    },
    [announce, uncover]
  )

  const logout = React.useCallback(async () => {
    try {
      await authApi.logout()
    } catch (cause) {
      // Already signed out on the server (expired / revoked): that is the same end state.
      if (!(isApiError(cause) && cause.status === 401)) throw cause
    }
    endSession(null)
    announce()
  }, [endSession, announce])

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

  const retryCheck = React.useCallback(() => void recheck("retry"), [recheck])

  return (
    <AuthContext.Provider value={value}>
      {children}
      <IdentityCheckCover state={check} onRetry={retryCheck} />
    </AuthContext.Provider>
  )
}

export { AuthProvider }
