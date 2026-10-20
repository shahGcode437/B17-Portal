import { useAuth } from "@/hooks/useAuth"
import { usePlanStore } from "@/state/planStore"
import { PLAN_ENTITLEMENTS, hasCapability } from "@/config/plans"
import type { Capability, Plan } from "@/types/entitlements"

/**
 * The plan in force (Phase 12G). The plan is SERVER-OWNED: a professional's plan comes from
 * `GET /auth/me` (`professional.planCode`) and nothing in the browser can change it. The old local
 * demo plan is only a fallback for an account without a professional profile, where it grants nothing
 * that is enforced by the server anyway.
 */
function usePlan(): Plan {
  const { user } = useAuth()
  const local = usePlanStore((state) => state.plan)
  return user?.professional?.planCode ?? local
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
