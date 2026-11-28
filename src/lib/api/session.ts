/**
 * In-memory API session state (Phase 12C). The CSRF token lives here and ONLY here: a module
 * variable, written by the AuthProvider, read by the API client. It is never put in
 * localStorage, sessionStorage, IndexedDB, a cookie or a URL, and the HttpOnly session cookie is
 * never read by JavaScript at all (the browser attaches it because requests use
 * `credentials: "include"`).
 */

let csrfToken: string | null = null

export function getCsrfToken(): string | null {
  return csrfToken
}

export function setCsrfToken(token: string): void {
  csrfToken = token
}

export function clearCsrfToken(): void {
  csrfToken = null
}

let identity: string | null = null
let identityStamp = 0

/** The auth layer says who the session belongs to now (`null`: nobody). Not called while unknown. */
export function noteIdentity(userId: string | null): void {
  if (userId === identity) return
  identity = userId
  identityStamp += 1
}

/**
 * Moves whenever this tab learns that somebody else (or nobody) holds the session. Anything that
 * waits for an answer BEFORE it sends a change reads this first and must not send if it has moved:
 * by then the CSRF token in memory is the other account's. (A change sent straight from a click
 * needs none of this.)
 */
export function getIdentityStamp(): number {
  return identityStamp
}

/** What the API client calls back into the auth layer for (set by the AuthProvider). */
export interface SessionHandlers {
  /** Re-reads `/auth/me` (coalesced). Resolves true iff the user is still authenticated afterwards. */
  refreshSession: () => Promise<boolean>
  /** The server rejected the session on an authenticated request: end it locally. */
  onSessionLost: (code: string) => void
}

let handlers: SessionHandlers | null = null

export function setSessionHandlers(next: SessionHandlers | null): void {
  handlers = next
}

export function getSessionHandlers(): SessionHandlers | null {
  return handlers
}
