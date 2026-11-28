import { rememberEmailDelivery } from "@/config/devMail"
import { apiRequest } from "@/lib/api/client"
import type { AuthUser, EmailDelivery, StaffScope } from "@/types/auth"

/**
 * Typed wrappers for the backend auth endpoints (docs/backend/AUTH_RBAC.md §12). Request fields are
 * the backend's exact camelCase names. Nothing here stores anything; the AuthProvider owns state.
 */

const STAFF_SCOPES = ["services", "directory", "food", "education", "property", "news", "grocery"] as const

// A compile-time tripwire: the list above must contain every `StaffScope`.
type MissingScope = Exclude<StaffScope, (typeof STAFF_SCOPES)[number]>
const scopesAreComplete: [MissingScope] extends [never] ? true : never = true
void scopesAreComplete

/**
 * The staff scopes the UI may rely on: only canonical values, de-duplicated, in canonical order. A
 * missing field (an older backend, a mock), a non-array or an unknown / forged value (including a role
 * name) is dropped, so a malformed `/auth/me` can never put a surprise value in front of the UI. This
 * is a UX hint — the API re-checks authority on every request.
 */
export function normalizeStaffScopes(value: unknown): StaffScope[] {
  if (!Array.isArray(value)) return []
  return STAFF_SCOPES.filter((scope) => value.includes(scope))
}

const EMAIL_DELIVERY: readonly EmailDelivery[] = ["email", "console", "off"]

/** Only a documented value; anything else (or nothing) is "unknown", which keeps the cautious wording. */
export function normalizeEmailDelivery(value: unknown): EmailDelivery | undefined {
  return EMAIL_DELIVERY.find((mode) => mode === value)
}

function normalizeAuthUser(user: AuthUser): AuthUser {
  const emailDelivery = normalizeEmailDelivery(user.emailDelivery)
  rememberEmailDelivery(emailDelivery)
  // Only a server that says so plainly: anything else is treated as the older, cautious one.
  const readBinding = user.readBinding === true ? true : undefined
  return { ...user, staffScopes: normalizeStaffScopes(user.staffScopes), emailDelivery, readBinding }
}

/** `GET /auth/me` — 200 = signed in, 401 = anonymous. Pre-session by nature (it is how we find out). */
export async function fetchMe(signal?: AbortSignal): Promise<AuthUser> {
  return normalizeAuthUser(await apiRequest<AuthUser>("GET", "/auth/me", { signal }))
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return normalizeAuthUser(await apiRequest<AuthUser>("POST", "/auth/login", { body: { email, password } }))
}

export async function register(input: { email: string; password: string; displayName: string }): Promise<AuthUser> {
  // Only these three fields: never a role, admin, professional, emailVerified or staff-scope flag.
  return normalizeAuthUser(
    await apiRequest<AuthUser>("POST", "/auth/register", {
      body: { email: input.email, password: input.password, displayName: input.displayName },
    })
  )
}

/** `POST /auth/logout` — revokes the server session. Needs the session and the CSRF token. */
export function logout(): Promise<void> {
  return apiRequest<void>("POST", "/auth/logout", { session: true })
}

/** `POST /auth/verify-email` — the one-time token comes from the link's URL fragment. */
export function verifyEmail(token: string): Promise<void> {
  return apiRequest<void>("POST", "/auth/verify-email", { body: { token } })
}

/** `POST /auth/resend-verification` — authenticated + CSRF; takes no body (the session says who). */
export function resendVerification(): Promise<void> {
  return apiRequest<void>("POST", "/auth/resend-verification", { session: true })
}

/**
 * `POST /auth/forgot-password` — always `202 accepted`, whether or not the account exists. The reply also says how
 * the server handles mail, which is the same for every address; nothing else in it is read.
 */
export async function forgotPassword(email: string): Promise<EmailDelivery | undefined> {
  const reply = await apiRequest<{ emailDelivery?: unknown } | undefined>("POST", "/auth/forgot-password", { body: { email } })
  const delivery = normalizeEmailDelivery(reply?.emailDelivery)
  rememberEmailDelivery(delivery)
  return delivery
}

/** `POST /auth/reset-password` — does NOT sign the user in. */
export function resetPassword(token: string, newPassword: string): Promise<void> {
  return apiRequest<void>("POST", "/auth/reset-password", { body: { token, newPassword } })
}

/**
 * `POST /auth/oauth/google/start` (purpose `login`). Returns the provider URL the browser must be
 * sent to; the callback is handled entirely by the backend, which ends by redirecting back here.
 * `returnTo` is a safe path (no query string) or omitted.
 */
export async function startGoogleSignIn(returnTo?: string): Promise<string> {
  const started = await apiRequest<{ authorizationUrl: string }>("POST", "/auth/oauth/google/start", {
    body: returnTo ? { purpose: "login", returnTo } : { purpose: "login" },
  })
  return started.authorizationUrl
}
