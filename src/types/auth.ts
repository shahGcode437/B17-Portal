/**
 * Frontend view of the backend authentication contract (docs/backend/AUTH_RBAC.md §12). These are
 * the ONLY auth types: aligned with the `/auth/me` JSON (camelCase), never duplicated per page.
 * Nothing secret lives here — no session token (it is an HttpOnly cookie JavaScript cannot read),
 * no password, no one-time token, no provider subject.
 */

/** The frontend auth state machine: it never guesses before `/auth/me` has answered. */
export type AuthStatus =
  /** Bootstrapping: `/auth/me` has not answered yet. Guards render a skeleton and never redirect. */
  | "loading"
  | "anonymous"
  | "authenticated"
  /** Bootstrapping failed for a network / server reason: neither signed in nor out; retry is offered. */
  | "unavailable"

/** Explicit grants only. A Resident has none; Professional is a capability, not a role. */
export type AuthRole = "admin"

export interface ProfessionalSummary {
  planCode: "free" | "premium"
}

export interface AuthMethods {
  password: boolean
  /** Linked social providers, e.g. `["google"]`. */
  providers: string[]
}

export interface SessionSummary {
  /** Informational only — the server is authoritative about expiry. */
  expiresAt: string
}

/** The `/auth/me` body, also returned by register / login / change-password. */
export interface AuthUser {
  id: string
  displayName: string
  email: string
  emailVerified: boolean
  roles: AuthRole[]
  /** Present iff the account has a professional profile (the capability). */
  professional?: ProfessionalSummary
  authMethods: AuthMethods
  session: SessionSummary
  /** In-memory CSRF token. The auth layer moves it out of the user object and never stores it. */
  csrfToken: string
}

/** The user as the UI sees it: everything except the CSRF token. */
export type CurrentUser = Omit<AuthUser, "csrfToken">

/** Why the user was signed out without asking to be (shown once on the login screen). */
export type AuthNotice = "expired" | "disabled"
