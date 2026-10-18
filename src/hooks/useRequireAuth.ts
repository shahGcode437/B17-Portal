import { useAuth } from "@/hooks/useAuth"
import type { CurrentUser } from "@/types/auth"

/**
 * The signed-in user for a screen that sits behind `<AuthGate>` (Phase 12C). Redirecting an
 * anonymous visitor to Log In is the gate's job — it knows the difference between "loading",
 * "anonymous" and "server unreachable" — so this hook never navigates and never guesses: it just
 * returns the authenticated user, or `null` while that is not (yet) the case.
 */
export function useRequireAuth(): CurrentUser | null {
  return useAuth().user
}
