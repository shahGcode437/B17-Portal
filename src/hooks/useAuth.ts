import { createContext, useContext } from "react"
import type { ApiError } from "@/lib/api/errors"
import type { AuthNotice, AuthStatus, CurrentUser } from "@/types/auth"

/**
 * The single authentication context (Phase 12C). `status` starts as "loading" and only becomes
 * "anonymous" or "authenticated" after `GET /auth/me` has answered — guards and the header must
 * respect that. Only what the UI needs is exposed; the CSRF token and the session never are.
 */
export interface AuthContextValue {
  status: AuthStatus
  /** Present iff `status === "authenticated"`. */
  user: CurrentUser | null
  isAuthenticated: boolean
  /** Set when the user was signed out without asking to be (expired / disabled); shown once. */
  notice: AuthNotice | null
  /** Why bootstrapping failed, when `status === "unavailable"`. */
  bootstrapError: ApiError | null
  login: (email: string, password: string) => Promise<CurrentUser>
  register: (input: { email: string; password: string; displayName: string }) => Promise<CurrentUser>
  /** Revokes the server session, then clears local state. Rejects (state kept) if the server is unreachable. */
  logout: () => Promise<void>
  /**
   * Re-reads `/auth/me`. Concurrent plain calls share one request; `{ fresh: true }` always starts a
   * NEW request (use it right after an action that changes the account, e.g. e-mail verification,
   * so an older in-flight answer cannot be mistaken for the result). Resolves true iff the user is
   * authenticated by that answer.
   */
  refreshMe: (options?: { fresh?: boolean }) => Promise<boolean>
  retryBootstrap: () => void
  dismissNotice: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}
