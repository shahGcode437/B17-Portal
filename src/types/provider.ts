import type { PublicLocation } from "@/types/location"

/**
 * A construction/home-service provider (Master Spec §5.3 ProviderCard,
 * UI/UX Spec §11 Provider Profile). Fictional prototype data only.
 */
export interface Provider {
  id: string
  name: string
  /** The primary category slug (dynamic data since Phase 12D — not a closed union any more). */
  category: string
  categoryLabel: string
  description: string
  area: string
  /** Where it is, as the PUBLIC may know it (Phase 12B/12G). Absent on legacy demo records. */
  location?: PublicLocation
  /** Optional real asset path — falls back to PlaceholderImage when absent. */
  image?: string
  tags: string[]
  featured?: boolean
}
