import { z } from "zod"
import {
  MAX_FOOD_CATEGORIES,
  MAX_MENU_HIGHLIGHTS,
  isFoodCategory,
  isFoodServiceOption,
} from "@/config/food"

/**
 * One shared schema for both onboarding types (UI/UX Spec §18 — "ask only
 * essential information first"). `category` is validated identically for
 * both — a non-empty string — since the UI already constrains Service /
 * Professional to the 11 existing categories via a `<select>`, while
 * General Business / Shop uses free text.
 *
 * `vertical` (FD4) is only meaningful for Business listings: a Food & Dining
 * business never types a `category` (it is derived from its primary Food
 * category by the builder), so the category is required for everything except
 * `vertical === "food"`. Food-specific fields are validated separately by
 * `foodFormSchema` below.
 */
export const listingSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter a name.").max(80, "That name is a bit too long."),
    category: z.string().trim(),
    description: z
      .string()
      .trim()
      .min(20, "Please add a bit more detail (at least 20 characters).")
      .max(400, "Please keep this under 400 characters."),
    area: z.string().trim().min(2, "Please enter an area or location."),
    tagsInput: z
      .string()
      .trim()
      .min(2, "Please list at least one service or specialty."),
    vertical: z.enum(["general", "food"]).optional(),
    /** A browser-local object URL from ListingImageInput — never a File, never uploaded anywhere. */
    image: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.vertical !== "food" && values.category.length < 1) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "Please choose a category." })
    }
  })

type ListingFieldValues = z.infer<typeof listingSchema>

/**
 * Food & Dining fields (docs/product/FOOD_DINING.md §3), validated outside
 * react-hook-form: they are nested/array shaped and the project's hand-rolled
 * resolver bridge only maps top-level keys. Optional fields stay genuinely
 * optional — only what the FoodProfile contract needs is required.
 */
export const menuHighlightFormSchema = z.object({
  name: z.string().trim().min(1, "Please enter the item name.").max(60, "Please keep the name under 60 characters."),
  section: z.string().trim().max(40, "Please keep the section under 40 characters."),
  description: z.string().trim().max(120, "Please keep the description under 120 characters."),
  price: z.string().trim().max(24, "Please keep the price under 24 characters."),
})

export type MenuHighlightFormValues = z.infer<typeof menuHighlightFormSchema>

export const foodFormSchema = z.object({
  categories: z
    .array(z.string().refine(isFoodCategory, "Please choose a listed category."))
    .min(1, "Choose at least one category.")
    .max(MAX_FOOD_CATEGORIES, `Choose up to ${MAX_FOOD_CATEGORIES} categories.`)
    .refine((categories) => new Set(categories).size === categories.length, "Each category can only be chosen once."),
  serviceOptions: z
    .array(z.string().refine(isFoodServiceOption, "Please choose a listed service option."))
    .min(1, "Choose at least one service option."),
  hoursNote: z.string().trim().max(80, "Please keep the hours under 80 characters."),
  menuHighlights: z
    .array(menuHighlightFormSchema)
    .max(MAX_MENU_HIGHLIGHTS, `Add up to ${MAX_MENU_HIGHLIGHTS} menu items.`),
  /** A browser-local object URL from ListingImageInput, like `image`. */
  menuImage: z.string().optional(),
})

export type FoodFormValues = z.infer<typeof foodFormSchema>

/** Field path (e.g. "categories", "menuHighlights.2.name") -> first error message. Empty when valid. */
export type FoodFieldErrors = Record<string, string>

export function validateFoodFields(food: FoodFormValues): FoodFieldErrors {
  const result = foodFormSchema.safeParse(food)
  const errors: FoodFieldErrors = {}
  if (result.success) return errors
  for (const issue of result.error.issues) {
    const path = issue.path.join(".")
    if (!(path in errors)) errors[path] = issue.message
  }
  return errors
}

/**
 * What the Business onboarding/edit form hands to the builders. A Food
 * submission always carries its `food` data (the union makes "Food without
 * FoodProfile" unrepresentable); a General one never does.
 */
export type ListingFormValues = Omit<ListingFieldValues, "vertical"> &
  ({ vertical?: "general"; food?: undefined } | { vertical: "food"; food: FoodFormValues })

/** The react-hook-form field set (everything except the separately-managed `food` block). */
export type ListingFormFields = ListingFieldValues

/**
 * Property onboarding fields (UI/UX Spec §18 extended for Property listings).
 * Kept separate from `listingSchema` since the field set genuinely differs
 * (sale/rent, property type, price, bedrooms, furnishing) rather than
 * overloading one shared shape with mostly-unused optional fields.
 */
export const propertySchema = z.object({
  title: z.string().trim().min(2, "Please enter a title.").max(100, "That title is a bit too long."),
  listingType: z.string().trim().min(1, "Please choose Sale or Rent."),
  propertyType: z.string().trim().min(1, "Please choose a property type."),
  price: z.string().trim().min(1, "Please enter a price."),
  area: z.string().trim().min(2, "Please enter an area or location."),
  description: z
    .string()
    .trim()
    .min(20, "Please add a bit more detail (at least 20 characters).")
    .max(400, "Please keep this under 400 characters."),
  bedrooms: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d+$/.test(v), "Please enter a whole number."),
  furnished: z.string().trim().optional(),
  tagsInput: z.string().trim().optional(),
  image: z.string().optional(),
})

export type PropertyFormValues = z.infer<typeof propertySchema>

/** Splits the free-text tags field into a clean string array. */
export function parseTags(tagsInput: string): string[] {
  return tagsInput
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
}
