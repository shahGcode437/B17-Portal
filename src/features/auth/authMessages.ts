import { NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"

/**
 * User-facing copy for authentication outcomes (Phase 12C). The UI maps stable backend error CODES
 * to its own fixed text and never renders arbitrary server text for a failure: an unknown code gets
 * the generic message. Wording is deliberately neutral where the backend is (no "unknown email").
 */

const GENERIC = "Something went wrong. Please try again."

const BY_CODE: Record<string, string> = {
  [NETWORK_ERROR_CODE]: "We couldn't reach the server. Check your connection and try again.",
  invalid_credentials: "Incorrect email or password.",
  account_disabled: "This account isn't available. If you think this is a mistake, please contact us.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  email_already_registered: "An account with this email already exists. Try logging in instead.",
  session_expired: "Your session has ended. Please log in again.",
  unauthenticated: "Your session has ended. Please log in again.",
  email_not_verified: "Please verify your email address first.",
  token_invalid: "This link is invalid or has already been used.",
  token_expired: "This link has expired. Please request a new one.",
  csrf_failed: "We couldn't verify that request. Please refresh the page and try again.",
  service_unavailable: "This is temporarily unavailable. Please try again soon.",
  validation_error: "Please check the highlighted fields and try again.",
}

export function authErrorMessage(error: unknown): string {
  if (!isApiError(error)) return GENERIC
  return BY_CODE[error.code] ?? GENERIC
}

/** Google sign-in outcomes the backend can put in `/login?error=` (docs/backend/AUTH_RBAC.md §10.2). */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: "Google sign-in was cancelled. You can try again or use your email and password.",
  oauth_failed: "We couldn't complete Google sign-in. Please try again.",
  identity_conflict:
    "An account with this email already exists. Log in with your existing email and password first.",
  email_not_verified: "Google couldn't confirm this email address, so we couldn't use it to sign you in.",
  account_disabled: "This account isn't available. If you think this is a mistake, please contact us.",
}

/** Only the fixed, documented codes are ever shown; anything else (or nothing) yields null. */
export function oauthErrorMessage(code: string | null): string | null {
  if (code === null) return null
  return Object.hasOwn(OAUTH_ERRORS, code) ? OAUTH_ERRORS[code] : OAUTH_ERRORS.oauth_failed
}

export const GOOGLE_UNAVAILABLE = "Google sign-in isn't available right now. Please use your email and password."
