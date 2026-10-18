import { useAuth } from "@/hooks/useAuth"
import type { CurrentUser } from "@/types/auth"

/**
 * The signed-in ADMIN for a screen behind `<AuthGate requires="admin">`. Admin-ness comes only from
 * the backend's `/auth/me` roles — there is no separate admin login, flag or storage. This is UX
 * only: the API (`require_admin`) is the authority, including its session-freshness rules.
 */
export function useRequireAdminAuth(): CurrentUser | null {
  const { user } = useAuth()
  return user && user.roles.includes("admin") ? user : null
}
