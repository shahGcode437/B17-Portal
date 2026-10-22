import { useAuth } from "@/hooks/useAuth"
import { PLAN_ENTITLEMENTS, hasCapability } from "@/config/plans"
import type { Capability, Plan } from "@/types/entitlements"

/**
 * The plan in force (Phase 12H). The plan is SERVER-OWNED: a professional's plan comes from
 * `GET /auth/me` (`professional.planCode`) and nothing in the browser can change it. An account
 * without a professional profile has the Free plan's entitlements by default; the Upgrade page is
 * informational only (there is no billing yet) and cannot unlock backend-restricted behaviour.
 */
function usePlan(): Plan {
  const { user } = useAuth()
  return user?.professional?.planCode ?? "free"
}

/** Whether the current plan includes `capability`. The one mechanism feature code should use - never `plan === "premium"` directly. */
export function useCapability(capability: Capability): boolean {
  return hasCapability(usePlan(), capability)
}

/** Full entitlements for the current plan (e.g. `maxListings`) plus the plan name itself, for badges/limits/upgrade UI. */
export function usePlanEntitlements() {
  const plan = usePlan()
  return { plan, entitlements: PLAN_ENTITLEMENTS[plan] }
}
