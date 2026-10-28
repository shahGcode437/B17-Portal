import { z } from "zod"
import { NOT_PLAIN_TEXT, isOneLine, isPlainText } from "@/features/provider/textRules"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The dates the API accepts for `preferredDate`: today or later, and within the next 365 days
 * (`422 in_the_past` / `too_far_ahead`). Computed when asked, so a tab left open overnight does not keep
 * yesterday's "today".
 */
export function requestDateBounds(now: Date = new Date()): { min: string; max: string } {
  return { min: now.toISOString().slice(0, 10), max: new Date(now.getTime() + 365 * DAY_MS).toISOString().slice(0, 10) }
}

/**
 * Service Request form fields (API_CONTRACT §10.8). Deliberately excludes name / phone / email:
 * the requester's identity comes from the real session, and there is NO contact-number field (the
 * resolved O-3 model is a preference, not a dispatch channel — docs/development/DECISIONS.md).
 */
export const serviceRequestSchema = z.object({
  service: z.string().min(1, "Please select a service."),
  details: z
    .string()
    .trim()
    .min(10, "Please add a few more details (at least 10 characters).")
    .max(500, "Please keep this under 500 characters.")
    .refine(isPlainText, NOT_PLAIN_TEXT),
  area: z
    .string()
    .trim()
    .min(2, "Please enter your area or location.")
    .max(80, "Please keep this under 80 characters.")
    .refine(isOneLine, NOT_PLAIN_TEXT),
  preferredDate: z
    .string()
    .min(1, "Please choose a preferred date.")
    .superRefine((value, ctx) => {
      if (value === "") return // the `min(1)` above already says "choose a date"; one message, not two
      const { min, max } = requestDateBounds()
      if (value < min) ctx.addIssue({ code: "custom", message: "Choose today or a later date." })
      else if (value > max) ctx.addIssue({ code: "custom", message: "Choose a date within the next 365 days." })
    }),
  preferredTime: z.string().optional(),
  notes: z.string().trim().max(500, "Please keep this under 500 characters.").refine(isPlainText, NOT_PLAIN_TEXT).optional(),
  preferredContactChannel: z.enum(["in_app", "whatsapp", "phone"]),
})

export type ServiceRequestValues = z.infer<typeof serviceRequestSchema>
