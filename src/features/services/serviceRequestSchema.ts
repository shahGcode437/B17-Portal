import { z } from "zod"

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
    .max(500, "Please keep this under 500 characters."),
  area: z.string().trim().min(2, "Please enter your area or location.").max(80, "Please keep this under 80 characters."),
  preferredDate: z.string().min(1, "Please choose a preferred date."),
  preferredTime: z.string().optional(),
  notes: z.string().trim().max(500, "Please keep this under 500 characters.").optional(),
  preferredContactChannel: z.enum(["in_app", "whatsapp", "phone"]),
})

export type ServiceRequestValues = z.infer<typeof serviceRequestSchema>
