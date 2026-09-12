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
})

export type ListingFormValues = z.infer<typeof listingSchema>

/** Splits the free-text tags field into a clean string array. */
export function parseTags(tagsInput: string): string[] {
  return tagsInput
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
}
