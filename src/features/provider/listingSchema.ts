import { z } from "zod"
import {
  MAX_FOOD_CATEGORIES,
  MAX_MENU_HIGHLIGHTS,
  isFoodCategory,
  isFoodServiceOption,
} from "@/config/food"
import { LOCALITIES, canonicalLocality } from "@/config/localities"
import {
  MAX_BEDROOMS,
  MAX_DESCRIPTION_LENGTH,
  MAX_GRADE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PRICE_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_DESCRIPTION_LENGTH,
} from "@/config/listingLimits"
import { NOT_PLAIN_TEXT, isOneLine, isPlainText } from "@/features/provider/textRules"

/** The only localities `area` may name (`config/localities`); the block is its own field inside `location`. */
export const AREA_MESSAGE = `Choose ${LOCALITIES.join(" or ")}. Put a block or street in the Block field.`

const areaField = z.string().trim().refine((value) => canonicalLocality(value) !== null, AREA_MESSAGE)

/**
 * What is wrong with the free-text tags field, or `null`. Counted exactly as the server will see them
 * (`parseTags`: trimmed, lower-cased, blanks and repeats dropped), so a field the form accepts is one the
 * API accepts. Tags are OPTIONAL: the API's `tags` defaults to an empty list.
 */
export function tagsProblem(tagsInput: string): string | null {
  const tags = parseTags(tagsInput)
  if (tags.length > MAX_TAGS) {
    const extra = tags.length - MAX_TAGS
    return `You can add up to ${MAX_TAGS} tags. Remove ${extra} to continue.`
  }
  const tooLong = tags.find((tag) => tag.length > MAX_TAG_LENGTH)
  if (tooLong) return `Each tag can be up to ${MAX_TAG_LENGTH} characters. "${tooLong.slice(0, 20)}…" is ${tooLong.length}.`
  if (tags.some((tag) => !isOneLine(tag))) return NOT_PLAIN_TEXT
  return null
}

/**
 * A tutor's grade / level. It sits beside the shared listing form (it is not one of its fields), so the create and
 * the edit page both render `TutorGradeField` and check it with this: 1 to 60 characters on one line.
 */
export function gradeProblem(grade: string): string | null {
  const trimmed = grade.trim()
  if (trimmed.length < 1) return "Please enter the grade you teach."
  if (trimmed.length > MAX_GRADE_LENGTH) return `Please keep the grade under ${MAX_GRADE_LENGTH} characters.`
  if (!isOneLine(trimmed)) return NOT_PLAIN_TEXT
  return null
}

const tagsField = z
  .string()
  .trim()
  .optional()
  .superRefine((value, ctx) => {
    const problem = tagsProblem(value ?? "")
    if (problem) ctx.addIssue({ code: "custom", message: problem })
  })

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
    name: z
      .string()
      .trim()
      .min(2, "Please enter a name.")
      .max(MAX_NAME_LENGTH, "That name is a bit too long.")
      .refine(isOneLine, NOT_PLAIN_TEXT),
    category: z.string().trim(),
    description: z
      .string()
      .trim()
      .min(MIN_DESCRIPTION_LENGTH, `Please add a bit more detail (at least ${MIN_DESCRIPTION_LENGTH} characters).`)
      .max(MAX_DESCRIPTION_LENGTH, `Please keep this under ${MAX_DESCRIPTION_LENGTH} characters.`)
      .refine(isPlainText, NOT_PLAIN_TEXT),
    area: areaField,
    tagsInput: tagsField,
    vertical: z.enum(["general", "food"]).optional(),
    /** The listing's stored image reference (an `https://` URL or a site path) - never a File: uploads are not built yet. */
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
  name: z.string().trim().min(1, "Please enter the item name.").max(60, "Please keep the name under 60 characters.").refine(isOneLine, NOT_PLAIN_TEXT),
  section: z.string().trim().max(40, "Please keep the section under 40 characters.").refine(isOneLine, NOT_PLAIN_TEXT),
  description: z.string().trim().max(120, "Please keep the description under 120 characters.").refine(isOneLine, NOT_PLAIN_TEXT),
  price: z.string().trim().max(24, "Please keep the price under 24 characters.").refine(isOneLine, NOT_PLAIN_TEXT),
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
  hoursNote: z.string().trim().max(80, "Please keep the hours under 80 characters.").refine(isOneLine, NOT_PLAIN_TEXT),
  menuHighlights: z
    .array(menuHighlightFormSchema)
    .max(MAX_MENU_HIGHLIGHTS, `Add up to ${MAX_MENU_HIGHLIGHTS} menu items.`),
  /** The stored menu image reference, like `image` (uploads are not built yet). */
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
  title: z
    .string()
    .trim()
    .min(2, "Please enter a title.")
    .max(MAX_TITLE_LENGTH, "That title is a bit too long.")
    .refine(isOneLine, NOT_PLAIN_TEXT),
  listingType: z.string().trim().min(1, "Please choose Sale or Rent."),
  propertyType: z.string().trim().min(1, "Please choose a property type."),
  price: z
    .string()
    .trim()
    .min(1, "Please enter a price.")
    .max(MAX_PRICE_LENGTH, `Please keep the price under ${MAX_PRICE_LENGTH} characters.`)
    .refine(isOneLine, NOT_PLAIN_TEXT),
  area: areaField,
  description: z
    .string()
    .trim()
    .min(MIN_DESCRIPTION_LENGTH, `Please add a bit more detail (at least ${MIN_DESCRIPTION_LENGTH} characters).`)
    .max(MAX_DESCRIPTION_LENGTH, `Please keep this under ${MAX_DESCRIPTION_LENGTH} characters.`)
    .refine(isPlainText, NOT_PLAIN_TEXT),
  bedrooms: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (/^\d{1,2}$/.test(v) && Number(v) <= MAX_BEDROOMS), `Please enter a whole number from 0 to ${MAX_BEDROOMS}.`),
  furnished: z.string().trim().optional(),
  tagsInput: tagsField,
  image: z.string().optional(),
})

export type PropertyFormValues = z.infer<typeof propertySchema>

/**
 * Splits the free-text tags field into the array the API stores: trimmed, lower-cased, blanks and repeats
 * dropped, first-seen order (the server normalises the same way, `normalize_tags`).
 */
export function parseTags(tagsInput: string | undefined): string[] {
  const seen = new Set<string>()
  for (const raw of (tagsInput ?? "").split(",")) {
    const tag = raw.trim().toLowerCase()
    if (tag) seen.add(tag)
  }
  return [...seen]
}
