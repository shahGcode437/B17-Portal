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
  bio: string
  image?: string
  tags: string[]
}
