import { usePlanStore } from "@/state/planStore"
import { PLAN_ENTITLEMENTS, hasCapability } from "@/config/plans"
import type { Capability } from "@/types/entitlements"

/** Whether the current demo plan includes `capability`. The one mechanism feature code should use — never `plan === "premium"` directly. */
export function useCapability(capability: Capability): boolean {
  const plan = usePlanStore((state) => state.plan)
  return hasCapability(plan, capability)
}

/** Full entitlements for the current plan (e.g. `maxListings`) plus the plan name itself, for badges/limits/upgrade UI. */
export function usePlanEntitlements() {
  const plan = usePlanStore((state) => state.plan)
  return { plan, entitlements: PLAN_ENTITLEMENTS[plan] }
}
