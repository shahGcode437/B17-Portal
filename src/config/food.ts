/**
 * Food & Dining taxonomy (docs/product/FOOD_DINING.md §4). Static app
 * configuration — like `serviceCategories` — not free text: a Food business
 * picks 1–3 of these canonical slugs, the first being its primary category.
 * Labels are presentation values; slugs are the stable IDs. Adding a category
 * or service option is a config change here and nowhere else.
 */
export const FOOD_CATEGORIES = [
  { slug: "restaurants", label: "Restaurants" },
  { slug: "fast-food", label: "Fast Food" },
  { slug: "biryani-rice", label: "Biryani / Rice" },
  { slug: "bbq", label: "BBQ" },
  { slug: "pizza-burgers", label: "Pizza / Burgers" },
  { slug: "cafes", label: "Cafes" },
  { slug: "juice-shakes", label: "Juice / Shakes" },
  { slug: "bakeries", label: "Bakeries" },
  { slug: "sweets-desserts", label: "Sweets / Desserts" },
  { slug: "desi-food", label: "Desi Food" },
  { slug: "tea-snacks", label: "Tea / Snacks" },
] as const

export type FoodCategorySlug = (typeof FOOD_CATEGORIES)[number]["slug"]

/**
 * "delivery" means delivery offered and arranged by the individual business —
 * it never implies B-17 Portal provides riders, logistics or tracking.
 */
export const FOOD_SERVICE_OPTIONS = [
  { value: "dine-in", label: "Dine-in" },
  { value: "takeaway", label: "Takeaway" },
  { value: "delivery", label: "Delivery by the business" },
] as const

export type FoodServiceOption = (typeof FOOD_SERVICE_OPTIONS)[number]["value"]

/** A Food business chooses between 1 and this many categories. */
export const MAX_FOOD_CATEGORIES = 3

/** A Food listing carries at most this many menu highlights (a discovery aid, not a full menu). */
export const MAX_MENU_HIGHLIGHTS = 8

/** Display name of the vertical (filter chips, future landing page). */
export const FOOD_VERTICAL_LABEL = "Food & Dining"

export function isFoodCategory(value: string): value is FoodCategorySlug {
  return FOOD_CATEGORIES.some((category) => category.slug === value)
}

export function isFoodServiceOption(value: string): value is FoodServiceOption {
  return FOOD_SERVICE_OPTIONS.some((option) => option.value === value)
}

export function foodCategoryLabel(slug: FoodCategorySlug): string {
  return FOOD_CATEGORIES.find((category) => category.slug === slug)?.label ?? slug
}

export function foodServiceLabel(value: FoodServiceOption): string {
  return FOOD_SERVICE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

/**
 * The single source behind `Business.category` for a Food business: the label
 * of its PRIMARY (first) category. Seed data and the onboarding builder call
 * this instead of typing a category string, so the two can never disagree.
 */
export function deriveFoodCategory(categories: readonly FoodCategorySlug[]): string {
  return categories.length > 0 ? foodCategoryLabel(categories[0]) : ""
}
