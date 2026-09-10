import type { LucideIcon } from "lucide-react"

export interface NavItem {
  label: string
  path: string
  icon?: LucideIcon
  /** Marks a destination that isn't built yet — routes to the Coming Soon stub. */
  future?: boolean
}
