/**
 * One browser, one session cookie, several accounts (test helper only; nothing here ships). It models
 * what makes a replay dangerous, as `backend/app/middleware/auth_security.py` does it: the CSRF token
 * is derived from the session, every unsafe request with a session must carry the CURRENT session's
 * token (`403 csrf_failed` otherwise), and whatever passes is carried out as whoever the cookie
 * belongs to NOW. `signInAs` is "another tab logged in as someone else".
 */
import { fail, installFetchMock, meBody, ok, type MockCall, type MockReply } from "@/test/apiMock"

export interface CookieAccount {
  id: string
  name: string
  roles?: string[]
  staffScopes?: string[]
}

export const ALICE: CookieAccount = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Alice Account" }
export const BOB: CookieAccount = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Bob Account" }
export const ADMIN_A: CookieAccount = { ...ALICE, roles: ["admin"] }
export const ADMIN_B: CookieAccount = { ...BOB, roles: ["admin"] }

export interface Performed {
  /** Whose session carried the change out. */
  actor: string
  method: string
  path: string
  body: unknown
}

const PRE_SESSION = new Set(["/auth/register", "/auth/login", "/auth/forgot-password", "/auth/reset-password", "/auth/verify-email"])

export type Answer = (call: MockCall, actor: CookieAccount) => MockReply | "network-error" | Promise<MockReply | "network-error">

export interface ServerOptions {
  /**
   * `true` (default): the current backend, which refuses a read naming another session
   * (`AUTH_RBAC.md` §38) and says so in `/auth/me` (`readBinding`). `false`: an older backend, which
   * ignores the name, so only the app's own confirmation protects a private answer.
   */
  binds?: boolean
}

export function sharedCookieServer(first: CookieAccount | null, answer?: Answer, options: ServerOptions = {}) {
  const binds = options.binds ?? true
  let serial = 0
  const state = {
    account: null as CookieAccount | null,
    csrf: "",
    /** Runs when a request for this `METHOD /path` arrives, before it is answered. */
    before: new Map<string, () => void | Promise<void>>(),
  }

  /** The cookie changes hands (`null`: signed out). Every new session has its own CSRF token. */
  function signInAs(next: CookieAccount | null) {
    state.account = next
    state.csrf = next ? `csrf-${next.name.split(" ")[0].toLowerCase()}-${++serial}` : ""
  }

  /** The same account, a new token (for example the session was rotated in another tab). */
  function rotateToken() {
    signInAs(state.account)
  }

  signInAs(first)

  /** Changes that were actually carried out. A refused request is never here. */
  const performed: Performed[] = []

  const { calls } = installFetchMock(async (call) => {
    const hook = state.before.get(`${call.method} ${call.path}`)
    if (hook) {
      state.before.delete(`${call.method} ${call.path}`)
      await hook()
    }
    const who = state.account
    if (call.path === "/auth/me") {
      return who
        ? ok(
            meBody({
              id: who.id,
              displayName: who.name,
              roles: who.roles ?? [],
              staffScopes: who.staffScopes ?? [],
              csrfToken: state.csrf,
              ...(binds && { readBinding: true }),
            })
          )
        : fail(401, "unauthenticated")
    }
    const unsafe = call.method !== "GET" && !PRE_SESSION.has(call.path)
    if (unsafe) {
      if (!who) return fail(401, "unauthenticated")
      if (call.headers.get("X-CSRF-Token") !== state.csrf) return fail(403, "csrf_failed")
      performed.push({ actor: who.name, method: call.method, path: call.path, body: call.body })
    }
    if (!who) return fail(401, "unauthenticated")
    const named = call.headers.get("X-CSRF-Token")
    if (binds && call.method === "GET" && named !== null && named !== state.csrf) return fail(403, "session_mismatch")
    if (call.path === "/auth/logout" && unsafe) {
      signInAs(null)
      return { status: 204 }
    }
    return answer ? answer(call, who) : ok({ id: "x", userId: "x", scopes: [], availableActions: [] })
  })

  /** Every attempt at a change, carried out or refused. */
  const attempts = () => calls.filter((call) => call.method !== "GET")

  return { state, signInAs, rotateToken, performed, calls, attempts }
}

export type SharedCookieServer = ReturnType<typeof sharedCookieServer>
