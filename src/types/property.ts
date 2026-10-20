import type { PublicLocation } from "@/types/location"
export type ListingType = "sale" | "rent"
export type FurnishingStatus = "Furnished" | "Unfurnished" | "Semi-Furnished"

/** A property listing. Fictional prototype data only — no real transactions. */
export interface Property {
  id: string
  title: string
  listingType: ListingType
  propertyType: string
  /** Formatted demo price string, e.g. "PKR 4.5 Cr" — not a real offer. */
  price: string
  area: string
  /** Where it is, as the PUBLIC may know it (Phase 12B/12G). Absent on legacy demo records. */
  location?: PublicLocation
  /** Optional free-text detail — static seed listings don't have one, user-submitted listings do. */
  description?: string
  bedrooms?: number
  furnished?: FurnishingStatus
  image?: string
  tags: string[]
}
