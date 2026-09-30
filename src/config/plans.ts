import type { Plan, Capability, PlanEntitlements } from "@/types/entitlements"

/**
 * The mocked/local entitlement source (Phase 9E) — there is no backend, so
 * this is the single place plan → capabilities is defined. Swapping in real
 * backend-provided entitlements later means replacing this file's internals
 * (and `planStore`'s source), not touching any feature component that calls
 * `useCapability`/`hasCapability`.
 */
export const PLAN_ENTITLEMENTS: Record<Plan, PlanEntitlements> = {
  free: {
    capabilities: ["profile.basic", "listings.basic", "leads.basic"],
    maxListings: 3,
  },
  premium: {
    capabilities: [
      "profile.basic",
      "listings.basic",
      "leads.basic",
      // "listings.extended" is a display label for Premium's higher/unlimited
      // limit below — `maxListings`, not this capability, is what any limit
      // check must read. See its doc comment in types/entitlements.ts.
      "listings.extended",
      "analytics.basic",
      "professional.modules",
    ],
    maxListings: null,
  },
}

/** Pure check usable outside React (event handlers, non-hook code) — the hook version wraps this. */
export function hasCapability(plan: Plan, capability: Capability): boolean {
  return PLAN_ENTITLEMENTS[plan].capabilities.includes(capability)
}
