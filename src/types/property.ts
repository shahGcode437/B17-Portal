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
  bedrooms?: number
  furnished?: FurnishingStatus
  image?: string
  tags: string[]
}
