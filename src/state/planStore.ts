import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Plan } from "@/types/entitlements"

interface PlanState {
  plan: Plan
  setPlan: (plan: Plan) => void
  resetPlan: () => void
}

/**
 * Mocked/local plan source (Phase 9E). There is no backend and no real
 * subscription — this is a demo-only stand-in, persisted to `localStorage`
 * (same pattern as `residentStore`) so a chosen demo plan survives an
 * ordinary reload. `AuthProvider.logout()` calls `resetPlan()` for the same
 * privacy reason `residentStore` is cleared on logout: demo auth has no
 * stable user id, so an explicit Log Out — not reload — is this demo's
 * boundary; the next person on this browser must not inherit the previous
 * person's plan.
 */
export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      plan: "free",
      setPlan: (plan) => set({ plan }),
      resetPlan: () => set({ plan: "free" }),
    }),
    { name: "b17-plan-store" }
  )
)
