import { Building2, Utensils } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Business } from "@/types/business"
import { FOOD_VERTICAL_LABEL, foodCategoryLabel } from "@/config/food"

/**
 * Display-only helpers shared by the Professional and Admin listing surfaces,
 * so a Food & Dining Business is recognisable without a second listing kind or
 * a second card architecture. They read the Business's own data and never
 * change it.
 */

/** "Food & Dining" for Food businesses, otherwise the supplied label (e.g. "Business / Shop"). */
export function businessTypeLabel(business: Business, fallback: string): string {
  return business.vertical === "food" ? FOOD_VERTICAL_LABEL : fallback
}

/**
 * The primary category first, then any secondary Food categories
 * ("Bakeries, Sweets / Desserts"); the plain category for a general Business.
 */
export function businessCategoryLabel(business: Business): string {
  if (business.vertical === "food" && business.food && business.food.categories.length > 1) {
    return business.food.categories.map(foodCategoryLabel).join(", ")
  }
  return business.category
}

export function businessTypeIcon(business: Business): LucideIcon {
  return business.vertical === "food" ? Utensils : Building2
}
