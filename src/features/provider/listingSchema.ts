import { z } from "zod"

/**
 * One shared schema for both onboarding types (UI/UX Spec §18 — "ask only
 * essential information first"). `category` is validated identically for
 * both — a non-empty string — since the UI already constrains Service /
 * Professional to the 11 existing categories via a `<select>`, while
 * Business / Shop uses free text.
 */
export const listingSchema = z.object({
  name: z.string().trim().min(2, "Please enter a name.").max(80, "That name is a bit too long."),
  category: z.string().trim().min(1, "Please choose a category."),
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
  /** A browser-local object URL from ListingImageInput — never a File, never uploaded anywhere. */
  image: z.string().optional(),
})

export type ListingFormValues = z.infer<typeof listingSchema>

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
