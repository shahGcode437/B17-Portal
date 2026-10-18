import { apiRequest } from "@/lib/api/client"
import type { AuthUser } from "@/types/auth"

/**
 * Typed wrappers for the backend auth endpoints (docs/backend/AUTH_RBAC.md §12). Request fields are
 * the backend's exact camelCase names. Nothing here stores anything; the AuthProvider owns state.
 */

/** `GET /auth/me` — 200 = signed in, 401 = anonymous. Pre-session by nature (it is how we find out). */
export function fetchMe(signal?: AbortSignal): Promise<AuthUser> {
  return apiRequest<AuthUser>("GET", "/auth/me", { signal })
}

export function login(email: string, password: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("POST", "/auth/login", { body: { email, password } })
}

export function register(input: { email: string; password: string; displayName: string }): Promise<AuthUser> {
  // Only these three fields: never a role, admin, professional or emailVerified flag.
  return apiRequest<AuthUser>("POST", "/auth/register", {
    body: { email: input.email, password: input.password, displayName: input.displayName },
  })
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

/** `POST /auth/forgot-password` — always `202 accepted`, whether or not the account exists. */
export function forgotPassword(email: string): Promise<void> {
  return apiRequest<void>("POST", "/auth/forgot-password", { body: { email } })
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
