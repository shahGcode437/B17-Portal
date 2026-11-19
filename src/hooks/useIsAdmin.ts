import { useAuth } from "@/hooks/useAuth"

/**
 * Whether the signed-in user holds the backend ``admin`` role, straight from the ``/auth/me``
 * answer the AuthProvider already holds. The source of truth is the backend; this hook only
 * decides whether to render admin-only UX hints (an Admin Dashboard shortcut, an admin-only action
 * on the Professional workspace header). Every admin-only API request is still authorised
 * server-side by ``require_admin`` with its own freshness rules — see
 * ``docs/backend/AUTH_RBAC.md §11.2``.
 *
 * Returns ``false`` during ``loading`` / ``unavailable`` / anonymous, so there is no flash of an
 * admin link before ``/auth/me`` has answered.
 */
export function useIsAdmin(): boolean {
  const { user } = useAuth()
  return user?.roles.includes("admin") ?? false
}
