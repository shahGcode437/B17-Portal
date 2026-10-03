import type { FoodCategorySlug, FoodServiceOption } from "@/config/food"

/** Which part of the Business Directory a business belongs to. Food & Dining is a vertical of Business, not a separate kind. */
export type BusinessVertical = "general" | "food"

/**
 * One informational menu entry (docs/product/FOOD_DINING.md §8) — for
 * discovery only. `price` is a display string (never parsed); there are no
 * quantity, cart or ordering fields.
 */
export interface MenuHighlight {
  id: string
  name: string
  section?: string
  description?: string
  price?: string
}

/** Food-specific data nested on a Business whose `vertical` is "food". */
export interface FoodProfile {
  /** 1–3 canonical slugs; the first is the primary category. */
  categories: FoodCategorySlug[]
  serviceOptions: FoodServiceOption[]
  /** Free display text (e.g. "Mon–Sun, 12 PM–11 PM") — no structured hours, no "open now". */
  hoursNote?: string
  /** Small discovery list (practical cap ≈ 8). */
  menuHighlights?: MenuHighlight[]
  menuImage?: string
}

/**
 * A business directory listing. Fictional prototype data only.
 * For a Food business, `category` is the label of its primary Food category
 * (derived via `deriveFoodCategory`) so every existing Business consumer keeps
 * working with one source of truth.
 */
export interface Business {
  id: string
  name: string
  vertical: BusinessVertical
  category: string
  description: string
  area: string
  image?: string
  tags: string[]
  featured?: boolean
  /** Present only when `vertical === "food"`. */
  food?: FoodProfile
}
