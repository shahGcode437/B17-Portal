import type { ServiceCategorySlug } from "@/types/category"

/**
 * A construction/home-service provider (Master Spec §5.3 ProviderCard,
 * UI/UX Spec §11 Provider Profile). Fictional prototype data only.
 */
export interface Provider {
  id: string
  name: string
  category: ServiceCategorySlug
  categoryLabel: string
  description: string
  area: string
  /** Optional real asset path — falls back to PlaceholderImage when absent. */
  image?: string
  tags: string[]
  featured?: boolean
}
