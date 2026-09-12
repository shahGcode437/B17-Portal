import { z } from "zod"

/**
 * Shared News/Update content form schema (Phase 5B). `kind` and `status` are
 * managed as plain toggle state outside this schema (mirroring how the
 * provider listing form handles `kind` — see ListingFormPage) since they're
 * always constrained to a valid value by the UI, never freely typed.
 */
export const contentSchema = z.object({
  title: z.string().trim().min(3, "Please enter a title.").max(120, "That title is a bit too long."),
  category: z.string().trim().min(2, "Please enter a category.").max(40, "Please keep this under 40 characters."),
  summary: z
    .string()
    .trim()
    .min(20, "Please add a bit more detail (at least 20 characters).")
    .max(400, "Please keep this under 400 characters."),
  tagsInput: z.string().trim().max(200, "Please keep tags concise."),
  image: z.string().trim().max(200, "That image path looks too long."),
  publishedAt: z.string().trim().min(1, "Please choose a date."),
})

export type ContentFormValues = z.infer<typeof contentSchema>

/** Splits the free-text tags field into a clean string array (mirrors listingSchema's parseTags). */
export function parseContentTags(tagsInput: string): string[] {
  return tagsInput
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
}
