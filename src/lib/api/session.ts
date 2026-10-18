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
