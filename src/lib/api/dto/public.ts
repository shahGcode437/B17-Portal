/**
 * PUBLIC backend read shapes (Phase 12G) — exactly what `GET /categories`, `/search`,
 * `/search/suggestions`, `/listings/{id}` and `/news` return (docs/backend/READ_API_PARITY.md).
 *
 * These types are the ONLY listing shapes public pages and components may see. They carry no owner,
 * moderation, revision or private-location field — the owner and admin shapes live in their own
 * modules (`owner.ts`, `admin.ts`) and are never imported by a public component.
 */

export type CategoryModule = "services" | "directory" | "food" | "education" | "property" | "news"

export interface CategoryDto {
  id: string
  module: CategoryModule
  slug: string
  name: string
  parentId?: string
  displayOrder: number
}

export interface CategoryRefDto {
  slug: string
  name: string
  isPrimary: boolean
}

export type LocationVisibility = "exact" | "approximate" | "area_only"

/** A PUBLIC point. Exact listings expose the stored point; approximate ones only the rounded one. */
export interface CoordinatesDto {
  latitude: number
  longitude: number
  precision: "exact" | "approximate"
}

/**
 * What the public may know about where a listing is. `address` / `landmark` appear only on the
 * detail of an exact listing; `coordinates` is absent for area-only (and legacy) listings.
 */
export interface LocationDto {
  visibility: LocationVisibility
  block?: string
  address?: string
  landmark?: string
  coordinates?: CoordinatesDto
}

export interface MenuHighlightDto {
  id: string
  name: string
  section?: string
  description?: string
  price?: string
}

export type FoodServiceOptionDto = "dine-in" | "takeaway" | "delivery"

export interface FoodDto {
  categories: string[]
  serviceOptions: FoodServiceOptionDto[]
  hoursNote?: string
  /** Present on listing detail; omitted from search cards. */
  menuHighlights?: MenuHighlightDto[]
  menuImage?: string
}

interface ListingBaseDto {
  id: string
  area: string
  location: LocationDto
  image?: string
  tags: string[]
  categories: CategoryRefDto[]
}

export interface ProviderDto extends ListingBaseDto {
  kind: "provider"
  name: string
  category: string
  categoryLabel: string
  description?: string
  featured?: boolean
}

export interface BusinessDto extends ListingBaseDto {
  kind: "business"
  name: string
  vertical: "general" | "food"
  category: string
  description?: string
  featured?: boolean
  food?: FoodDto
}

export interface TutorDto extends ListingBaseDto {
  kind: "tutor"
  name: string
  subject: string
  grade: string
  bio?: string
}

export interface PropertyDto extends ListingBaseDto {
  kind: "property"
  title: string
  listingType: "sale" | "rent"
  propertyType: string
  price: string
  description?: string
  bedrooms?: number
  furnished?: "Furnished" | "Unfurnished" | "Semi-Furnished"
}

export type ListingDto = ProviderDto | BusinessDto | TutorDto | PropertyDto

export type NewsKindDto = "news" | "update"

export interface NewsDto {
  id: string
  kind: NewsKindDto
  status: "published"
  title: string
  category: string
  categorySlug?: string
  summary: string
  image?: string
  /** `YYYY-MM-DD`. */
  publishedAt: string
  tags: string[]
}

export type SearchHitDto =
  | { kind: "provider"; item: ProviderDto }
  | { kind: "business"; item: BusinessDto }
  | { kind: "tutor"; item: TutorDto }
  | { kind: "property"; item: PropertyDto }
  | { kind: "news"; item: NewsDto }

export interface SuggestionDto {
  id: string
  label: string
  secondaryLabel: string
  type: "provider" | "business" | "tutor" | "property" | "news"
  value: string
}
