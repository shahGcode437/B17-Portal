/**
 * Listing form values -> API create/patch payloads (Phase 12H).
 *
 * The forms do not know the backend's exact shape: they are UI (`ListingForm`, `PropertyListingForm`),
 * so an adapter per kind turns their values + a shared `LocationWrite` + an optional `image` URL into
 * the exact body `POST /listings` or `PATCH /listings/{id}` accepts (API_CONTRACT §10.6).
 *
 * Rules enforced here, so no caller can forget:
 *  - no backend-owned field is ever included (id, ownerId, status, revision — except as the PATCH
 *    concurrency token, which `patchListing` passes separately);
 *  - `blob:` / `data:` images are DROPPED (backend refuses them, §10.1); only `https://` and
 *    site-relative paths pass through;
 *  - tags are the parsed array (never the free-text field);
 *  - a Business switched to General carries no Food block;
 *  - a Food submission carries no `category` (the server derives the display label from the primary
 *    Food category);
 *  - `location` is the single source of truth: `area_only` sends no coordinates, no address, no
 *    landmark; `approximate`/`exact` send the point only when the coordinates are finite numbers.
 */
import type { FoodServiceOptionDto } from "@/lib/api/dto/public"
import { isFoodServiceOption } from "@/config/food"
import { parseTags } from "@/features/provider/listingSchema"
import type { FoodFormValues, ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"
import type {
  BusinessCreate,
  FoodMenuItemWrite,
  FoodWrite,
  ListingCreate,
  ListingPatch,
  LocationWrite,
  ProviderCreate,
  PropertyCreate,
  TutorCreate,
} from "@/lib/api/writes/listings"

/** `blob:` / `data:` URLs are not acceptable to the backend; drop them so the server never 422s on media. */
function cleanImage(image: string | undefined): string | undefined {
  if (!image) return undefined
  if (image.startsWith("https://") || image.startsWith("/")) return image
  return undefined
}

function foodToWrite(food: FoodFormValues): FoodWrite {
  const serviceOptions = food.serviceOptions.filter(isFoodServiceOption) as FoodServiceOptionDto[]
  const menuHighlights: FoodMenuItemWrite[] = food.menuHighlights.map((item) => ({
    name: item.name,
    ...(item.section ? { section: item.section } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.price ? { price: item.price } : {}),
  }))
  return {
    categories: food.categories,
    serviceOptions,
    ...(food.hoursNote ? { hoursNote: food.hoursNote } : {}),
    ...(menuHighlights.length > 0 ? { menuHighlights } : {}),
    ...(cleanImage(food.menuImage) ? { menuImage: cleanImage(food.menuImage)! } : {}),
  }
}

export function providerCreate(values: ListingFormValues, location: LocationWrite): ProviderCreate {
  return {
    kind: "provider",
    name: values.name,
    category: values.category,
    description: values.description,
    area: values.area,
    tags: parseTags(values.tagsInput),
    ...(cleanImage(values.image) ? { image: cleanImage(values.image)! } : {}),
    location,
  }
}

export function businessCreate(values: ListingFormValues, location: LocationWrite): BusinessCreate {
  if (values.vertical === "food") {
    return {
      kind: "business",
      name: values.name,
      vertical: "food",
      description: values.description,
      area: values.area,
      tags: parseTags(values.tagsInput),
      ...(cleanImage(values.image) ? { image: cleanImage(values.image)! } : {}),
      food: foodToWrite(values.food),
      location,
    }
  }
  return {
    kind: "business",
    name: values.name,
    vertical: "general",
    category: values.category,
    description: values.description,
    area: values.area,
    tags: parseTags(values.tagsInput),
    ...(cleanImage(values.image) ? { image: cleanImage(values.image)! } : {}),
    location,
  }
}

export function tutorCreate(values: ListingFormValues, grade: string, location: LocationWrite): TutorCreate {
  return {
    kind: "tutor",
    name: values.name,
    category: values.category,
    grade,
    description: values.description,
    area: values.area,
    tags: parseTags(values.tagsInput),
    ...(cleanImage(values.image) ? { image: cleanImage(values.image)! } : {}),
    location,
  }
}

export function propertyCreate(values: PropertyFormValues, location: LocationWrite): PropertyCreate {
  return {
    kind: "property",
    title: values.title,
    listingType: values.listingType as "sale" | "rent",
    propertyType: values.propertyType,
    price: values.price,
    description: values.description,
    area: values.area,
    tags: values.tagsInput ? parseTags(values.tagsInput) : [],
    ...(cleanImage(values.image) ? { image: cleanImage(values.image)! } : {}),
    ...(values.bedrooms ? { bedrooms: Number(values.bedrooms) } : {}),
    ...(values.furnished ? { furnished: values.furnished as PropertyCreate["furnished"] } : {}),
    location,
  }
}

export function toListingCreate(
  kind: "provider" | "business" | "tutor",
  values: ListingFormValues,
  location: LocationWrite,
  grade?: string
): ListingCreate {
  if (kind === "provider") return providerCreate(values, location)
  if (kind === "tutor") return tutorCreate(values, grade ?? "", location)
  return businessCreate(values, location)
}

/**
 * PATCH payload: `revision` plus every writable field. The backend's semantics are
 * omitted = unchanged. We send the full writable set (bar `kind`) rather than diffing in the UI,
 * because comparing nested arrays/objects across prefill transformations is error-prone and the
 * backend treats a no-op PATCH as a no-op anyway (§10.3 row 2). `location` replaces the whole block.
 */
export function listingPatchFrom(
  revision: number,
  kind: "provider" | "business" | "tutor",
  values: ListingFormValues,
  location: LocationWrite,
  grade?: string
): ListingPatch {
  const base: ListingPatch = {
    revision,
    name: values.name,
    description: values.description,
    area: values.area,
    tags: parseTags(values.tagsInput),
    image: cleanImage(values.image) ?? null,
    location,
  }
  if (kind === "provider") return { ...base, category: values.category }
  if (kind === "tutor") return { ...base, category: values.category, ...(grade !== undefined ? { grade } : {}) }
  // business
  if (values.vertical === "food") return { ...base, vertical: "food", food: foodToWrite(values.food) }
  return { ...base, vertical: "general", category: values.category, food: null }
}

export function propertyPatchFrom(revision: number, values: PropertyFormValues, location: LocationWrite): ListingPatch {
  return {
    revision,
    title: values.title,
    listingType: values.listingType as "sale" | "rent",
    propertyType: values.propertyType,
    price: values.price,
    description: values.description,
    area: values.area,
    tags: values.tagsInput ? parseTags(values.tagsInput) : [],
    image: cleanImage(values.image) ?? null,
    bedrooms: values.bedrooms ? Number(values.bedrooms) : null,
    furnished: values.furnished ? (values.furnished as "Furnished" | "Unfurnished" | "Semi-Furnished") : null,
    location,
  }
}
