import type { LucideIcon } from "lucide-react"

export type ServiceCategorySlug =
  | "construction"
  | "electrical"
  | "solar"
  | "architecture"
  | "painting"
  | "plumbing"
  | "interior-design"
  | "renovation"
  | "finishing"
  | "aluminium"
  | "hardware"

export interface ServiceCategory {
  slug: ServiceCategorySlug
  label: string
  icon: LucideIcon
}

/** A top-level portal area shown as a Quick Discovery card on Home. */
export interface DiscoveryCategory {
  label: string
  description: string
  path: string
  icon: LucideIcon
  /** Renders with stronger visual prominence (construction/home services). */
  emphasis?: boolean
}
