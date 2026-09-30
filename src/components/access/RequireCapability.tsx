import type { ReactNode } from "react"
import { useCapability } from "@/hooks/useCapability"
import type { Capability } from "@/types/entitlements"

interface RequireCapabilityProps {
  capability: Capability
  children: ReactNode
  /** Rendered instead of `children` when the capability is missing — e.g. a locked-feature preview. Defaults to nothing. */
  fallback?: ReactNode
}

/**
 * The single gating mechanism for capability-based UI (Phase 9E). Reasons a
 * capability exists — paid plan today, a trial or admin override later —
 * are irrelevant here; this only ever asks "does the current plan include
 * this capability," so new reasons can be added later in `planStore`/
 * `plans.ts` without touching a single gated component.
 */
function RequireCapability({ capability, children, fallback = null }: RequireCapabilityProps) {
  const allowed = useCapability(capability)
  return allowed ? <>{children}</> : <>{fallback}</>
}

export { RequireCapability }
