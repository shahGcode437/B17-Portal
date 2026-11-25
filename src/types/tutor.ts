import type { PublicLocation } from "@/types/location"
/** An individual education/tutoring listing. Fictional prototype data only. */
export interface Tutor {
  id: string
  name: string
  subject: string
  grade: string
  area: string
  /** Where it is, as the PUBLIC may know it (Phase 12B/12G). Absent on legacy demo records. */
  location?: PublicLocation
  /**
   * The number customers should use for THIS listing (Listing Contact v1), E.164, and an optional WhatsApp
   * number. Absent on a listing created before the field.
   */
  contactPhone?: string
  whatsappPhone?: string
  bio: string
  image?: string
  tags: string[]
}
