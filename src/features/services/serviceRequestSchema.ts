import { z } from "zod"

/**
 * Service Request form fields (UI/UX Spec §12 — "ask only essential
 * information first"). Deliberately excludes name/phone/email: the
 * requester's identity already comes from the simulated auth session.
 */
export const serviceRequestSchema = z.object({
  service: z.string().min(1, "Please select a service."),
  details: z
    .string()
    .trim()
    .min(10, "Please add a few more details (at least 10 characters).")
    .max(500, "Please keep this under 500 characters."),
  area: z.string().trim().min(2, "Please enter your area or location."),
  preferredDate: z.string().min(1, "Please choose a preferred date."),
  preferredTime: z.string().optional(),
  notes: z.string().trim().max(500, "Please keep this under 500 characters.").optional(),
})

export type ServiceRequestValues = z.infer<typeof serviceRequestSchema>
