import type { CurrentUser } from "@/types/auth"

/**
 * Whether `/auth/me` says this account may handle grocery orders: the Super Admin (`admin` role), or a
 * Moderator whose effective scopes include `grocery` (a paused Moderator has none). It mirrors the
 * server's `require_grocery_staff` to decide what to SHOW; the API decides every request again,
 * including its freshness rules.
 */
export function canWorkGroceryOrders(user: Pick<CurrentUser, "roles" | "staffScopes"> | null | undefined): boolean {
  if (!user) return false
  return user.roles.includes("admin") || (user.roles.includes("moderator") && user.staffScopes.includes("grocery"))
}

/** The Super Admin, who has the extra grocery powers (act without claiming; cancel while preparing). */
export function isSuperAdmin(user: Pick<CurrentUser, "roles"> | null | undefined): boolean {
  return user?.roles.includes("admin") ?? false
}
