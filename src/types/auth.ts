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

/**
 * Explicit grants only. A Resident has none; Professional is a capability, not a role. `admin` is the
 * stored value of the SUPER ADMIN role (not renamed); `moderator` is scoped staff (RBAC-A: the backend
 * can report it, but no screen or route is Moderator-accessible yet). UX hint only — the API decides.
 */
export type AuthRole = "admin" | "moderator"

/**
 * The canonical staff scopes (mirrors the backend's `StaffScope`; docs/backend/AUTH_RBAC.md §32). This is
 * staff PERMISSION, not the listing taxonomy: `grocery` is a staff scope only — never a category, listing
 * kind or module — and it confers no listing authority. `news` is reserved and confers nothing.
 * Only a Moderator has any; a Super Admin's authority is the `admin` role itself, never "all scopes".
 */
export type StaffScope = "services" | "directory" | "food" | "education" | "property" | "news" | "grocery"

/**
 * How the server handles e-mail: a real provider, printed in the developer's API terminal, or nothing at all.
 * Configuration only - it never says that a message was delivered.
 */
export type EmailDelivery = "email" | "console" | "off"

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
  /** A Moderator's effective scopes; `[]` for everyone else. A UX hint only — never an authority. */
  staffScopes: StaffScope[]
  /** Present iff the account has a professional profile (the capability). */
  professional?: ProfessionalSummary
  authMethods: AuthMethods
  session: SessionSummary
  /** In-memory CSRF token. The auth layer moves it out of the user object and never stores it. */
  csrfToken: string
  /**
   * The server binds private reads to the named session (`AUTH_RBAC.md` §38) and `/auth/me` is no
   * use of a staff session (§38.4). Absent from an older server. It never relaxes the app's own
   * confirmation of private answers; it only lets staff tabs ask who is signed in more freely.
   */
  readBinding?: boolean
  /** Absent from an older backend; screens then keep their cautious wording. */
  emailDelivery?: EmailDelivery
}

/** The user as the UI sees it: everything except the CSRF token. */
export type CurrentUser = Omit<AuthUser, "csrfToken">

/** Why the user was signed out without asking to be (shown once on the login screen). */
export type AuthNotice = "expired" | "disabled"
