import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"
import type { LocationVisibility } from "@/types/location"
import type { FoodServiceOptionDto } from "@/lib/api/dto/public"
import type { OwnerListingDto } from "@/lib/api/dto/private"

/**
 * The exact bodies `POST /listings` and `PATCH /listings/{id}` accept (API_CONTRACT §10.6).
 *
 * - `location` is the whole block; on PATCH it REPLACES the whole block (§10.6 last paragraph).
 * - `kind` is immutable; it is sent on create and must be omitted on PATCH.
 * - Backend-owned fields (id, ownerId, status, revision — except as the PATCH concurrency token,
 *   featured, …) are refused with `422 not_allowed`; this type space makes them unreachable.
 * - Media: `image` / `menuImage` must be `https://…` or a site-relative path.
 */

/** The writable location block (`LOCATION_MAP.md §8`). `latitude` / `longitude` are omitted for area_only. */
export interface LocationWrite {
  visibility: LocationVisibility
  block?: string
  address?: string
  landmark?: string
  latitude?: number
  longitude?: number
}

export interface FoodMenuItemWrite {
  name: string
  section?: string
  description?: string
  price?: string
}

export interface FoodWrite {
  categories: string[]
  serviceOptions: FoodServiceOptionDto[]
  hoursNote?: string
  menuHighlights?: FoodMenuItemWrite[]
  menuImage?: string
}

interface Base {
  name?: string
  description: string
  area: string
  tags: string[]
  image?: string
  location: LocationWrite
}

export interface ProviderCreate extends Base {
  kind: "provider"
  name: string
  category: string
}

export interface BusinessCreate extends Base {
  kind: "business"
  name: string
  vertical: "general" | "food"
  category?: string
  food?: FoodWrite
}

export interface TutorCreate extends Base {
  kind: "tutor"
  name: string
  category: string
  grade: string
}

export interface PropertyCreate extends Omit<Base, "name"> {
  kind: "property"
  title: string
  listingType: "sale" | "rent"
  propertyType: string
  price: string
  bedrooms?: number
  furnished?: "Furnished" | "Unfurnished" | "Semi-Furnished"
}

export type ListingCreate = ProviderCreate | BusinessCreate | TutorCreate | PropertyCreate

export function createListing(body: ListingCreate): Promise<OwnerListingDto> {
  return apiRequest<OwnerListingDto>("POST", "/listings", { session: true, body })
}

/**
 * `PATCH /listings/{id}` body. `revision` is the owner's concurrency token; a stale value is
 * `409 listing_conflict`. Omitted fields are left unchanged; `null` clears only declared-clearable
 * fields; arrays replace the whole array; `location` replaces the whole block.
 */
export interface ListingPatch {
  revision: number
  name?: string
  title?: string
  description?: string
  area?: string
  tags?: string[]
  image?: string | null
  category?: string
  vertical?: "general" | "food"
  food?: FoodWrite | null
  grade?: string
  listingType?: "sale" | "rent"
  propertyType?: string
  price?: string
  bedrooms?: number | null
  furnished?: "Furnished" | "Unfurnished" | "Semi-Furnished" | null
  location?: LocationWrite
}

export function patchListing(id: string, body: ListingPatch): Promise<OwnerListingDto> {
  return apiRequest<OwnerListingDto>("PATCH", `/listings/${segment(id)}`, { session: true, body })
}

export function archiveListing(id: string, revision: number): Promise<OwnerListingDto> {
  return apiRequest<OwnerListingDto>("POST", `/listings/${segment(id)}/archive`, {
    session: true,
    body: { revision },
  })
}
