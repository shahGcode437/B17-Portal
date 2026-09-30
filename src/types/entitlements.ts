/**
 * Free/Premium capability model (Phase 9E). This is the ONLY vocabulary
 * feature code should use to decide what a professional can do — never
 * `if (plan === "premium")` scattered across components (Master Spec /
 * DECISIONS.md: "Premium/Free is modeled through capabilities/entitlements").
 *
 * IMPORTANT: these checks are UX controls only, not a security boundary.
 * There is no backend yet, so a determined user can always change their own
 * local plan (see `planStore`) — exactly like every other piece of demo
 * auth/state in this prototype. Real authorization will live in the backend
 * once it exists (Phase 10+) and will be authoritative; this frontend model
 * exists so the eventual swap only touches `planStore`/`plans.ts`, not every
 * component that gates a feature.
 */
export type Plan = "free" | "premium"

/**
 * Small, concrete set reflecting actual near-term product needs — not a
 * speculative catalog. Add a new capability only when a real feature needs
 * to check it.
 */
export type Capability =
  | "profile.basic"
  | "listings.basic"
  | "leads.basic"
  /**
   * Reserved for future advanced listing-management features (bulk actions,
   * extra fields, etc.) — NOT the mechanism that controls the numeric
   * listing quota. That's `PlanEntitlements.maxListings` below; nothing
   * currently checks `useCapability("listings.extended")` to decide it.
   * Shown in the Upgrade comparison table as a human-readable label for
   * "Premium's higher/unlimited limit," but the actual enforcement always
   * reads `maxListings`, never this capability.
   */
  | "listings.extended"
  | "analytics.basic"
  /** Reserved for future profession-specific modules (Phase 9E §10 readiness) — not consumed by any component yet. */
  | "professional.modules"

export interface PlanEntitlements {
  capabilities: Capability[]
  /**
   * `null` means no cap (Premium). This — not the `listings.extended`
   * capability above — is the single value every listing-limit check must
   * read; never hardcoded in a component. Counts only *active* listings
   * (`isListingCountedTowardPlanLimit` in `listingsStore.ts`: pending or
   * approved) — archived/rejected listings never consume this quota.
   */
  maxListings: number | null
}
