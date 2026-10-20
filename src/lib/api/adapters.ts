import type {
  BusinessDto,
  FoodDto,
  ListingDto,
  LocationDto,
  NewsDto,
  PropertyDto,
  ProviderDto,
  SearchHitDto,
  SuggestionDto,
  TutorDto,
} from "@/lib/api/dto/public"
import type { Business, FoodProfile } from "@/types/business"
import type { NewsArticle } from "@/types/news"
import type { Property } from "@/types/property"
import type { Provider } from "@/types/provider"
import type { SearchHit, SearchSuggestion } from "@/types/search"
import type { Tutor } from "@/types/tutor"
import type { LocationVisibility, PublicLocation } from "@/types/location"
import { isFoodServiceOption } from "@/config/food"

/**
 * Backend DTO -> UI view model (Phase 12G).
 *
 * Components never see a backend field quirk: ids and the canonical values are preserved, optional
 * values are normalised without inventing anything (a missing description is "", never a made-up
 * sentence), and the PUBLIC location is rebuilt through `toPublicLocation`, which re-checks the
 * privacy invariants so a misbehaving response cannot make an approximate or area-only listing look
 * exact.
 */

const VISIBILITIES: readonly LocationVisibility[] = ["exact", "approximate", "area_only"]

function text(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/** A real WGS-84 coordinate: finite numbers inside the valid ranges. */
export function isValidCoordinate(latitude: unknown, longitude: unknown): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

/**
 * The public location, hardened:
 *  - an unknown visibility is treated as area-only (the most private reading);
 *  - `area_only` keeps the block text only — never coordinates, address or landmark;
 *  - `approximate` keeps the rounded point only if the server labelled it `approximate`, and never an
 *    address or landmark;
 *  - `exact` keeps the point only if labelled `exact`, plus address and landmark;
 *  - a malformed or out-of-range point is dropped (the page then shows text only, never a broken map).
 */
export function toPublicLocation(dto: LocationDto | undefined): PublicLocation {
  const visibility: LocationVisibility =
    dto && VISIBILITIES.includes(dto.visibility) ? dto.visibility : "area_only"
  const location: PublicLocation = { visibility }
  const block = text(dto?.block)
  if (block) location.block = block
  if (visibility === "area_only" || !dto) return location

  const point = dto.coordinates
  if (
    point &&
    point.precision === visibility &&
    isValidCoordinate(point.latitude, point.longitude)
  ) {
    location.coordinates = { latitude: point.latitude, longitude: point.longitude, precision: point.precision }
  }
  if (visibility === "exact") {
    const address = text(dto.address)
    const landmark = text(dto.landmark)
    if (address) location.address = address
    if (landmark) location.landmark = landmark
  }
  return location
}

export function toProvider(dto: ProviderDto): Provider {
  return {
    id: dto.id,
    name: dto.name,
    category: dto.category,
    categoryLabel: dto.categoryLabel,
    description: dto.description ?? "",
    area: dto.area,
    location: toPublicLocation(dto.location),
    image: dto.image,
    tags: dto.tags,
    ...(dto.featured ? { featured: true } : {}),
  }
}

function toFood(dto: FoodDto, labels: Map<string, string>): FoodProfile {
  const food: FoodProfile = {
    categories: dto.categories,
    serviceOptions: dto.serviceOptions.filter(isFoodServiceOption),
    categoryLabels: Object.fromEntries(dto.categories.flatMap((slug) => (labels.has(slug) ? [[slug, labels.get(slug)!]] : []))),
  }
  if (dto.hoursNote) food.hoursNote = dto.hoursNote
  if (dto.menuImage) food.menuImage = dto.menuImage
  if (dto.menuHighlights) {
    food.menuHighlights = dto.menuHighlights.map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.section ? { section: item.section } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.price ? { price: item.price } : {}),
    }))
  }
  return food
}

export function toBusiness(dto: BusinessDto): Business {
  const labels = new Map(dto.categories.map((ref) => [ref.slug, ref.name]))
  return {
    id: dto.id,
    name: dto.name,
    vertical: dto.vertical,
    category: dto.category,
    description: dto.description ?? "",
    area: dto.area,
    location: toPublicLocation(dto.location),
    image: dto.image,
    tags: dto.tags,
    ...(dto.featured ? { featured: true } : {}),
    // Food is a vertical of Business, never a kind: the profile exists only when vertical === "food".
    ...(dto.vertical === "food" && dto.food ? { food: toFood(dto.food, labels) } : {}),
  }
}

export function toTutor(dto: TutorDto): Tutor {
  return {
    id: dto.id,
    name: dto.name,
    subject: dto.subject,
    grade: dto.grade,
    area: dto.area,
    location: toPublicLocation(dto.location),
    bio: dto.bio ?? "",
    image: dto.image,
    tags: dto.tags,
  }
}

export function toProperty(dto: PropertyDto): Property {
  return {
    id: dto.id,
    title: dto.title,
    listingType: dto.listingType,
    propertyType: dto.propertyType,
    price: dto.price,
    area: dto.area,
    location: toPublicLocation(dto.location),
    ...(dto.description ? { description: dto.description } : {}),
    ...(dto.bedrooms !== undefined ? { bedrooms: dto.bedrooms } : {}),
    ...(dto.furnished ? { furnished: dto.furnished } : {}),
    image: dto.image,
    tags: dto.tags,
  }
}

export function toNewsArticle(dto: NewsDto): NewsArticle {
  return {
    id: dto.id,
    kind: dto.kind,
    status: "published",
    title: dto.title,
    category: dto.category,
    summary: dto.summary,
    image: dto.image,
    publishedAt: dto.publishedAt,
    tags: dto.tags,
  }
}

export function toSearchHit(dto: SearchHitDto): SearchHit {
  switch (dto.kind) {
    case "provider":
      return { kind: "provider", item: toProvider(dto.item) }
    case "business":
      return { kind: "business", item: toBusiness(dto.item) }
    case "tutor":
      return { kind: "tutor", item: toTutor(dto.item) }
    case "property":
      return { kind: "property", item: toProperty(dto.item) }
    case "news":
      return { kind: "news", item: toNewsArticle(dto.item) }
  }
}

const HIT_KINDS = new Set<string>(["provider", "business", "tutor", "property", "news"])

/** A page of hits. An entry of a kind this client does not know is skipped, never rendered half-built. */
export function toSearchHits(dtos: readonly SearchHitDto[]): SearchHit[] {
  return dtos.filter((dto) => HIT_KINDS.has(dto.kind)).map(toSearchHit)
}

/** A listing detail: the same view models as a search hit, discriminated on the DTO's `kind`. */
export function toListingHit(dto: ListingDto): Exclude<SearchHit, { kind: "news" }> {
  switch (dto.kind) {
    case "provider":
      return { kind: "provider", item: toProvider(dto) }
    case "business":
      return { kind: "business", item: toBusiness(dto) }
    case "tutor":
      return { kind: "tutor", item: toTutor(dto) }
    case "property":
      return { kind: "property", item: toProperty(dto) }
  }
}

export function toSuggestion(dto: SuggestionDto): SearchSuggestion {
  return { id: dto.id, label: dto.label, secondaryLabel: dto.secondaryLabel, type: dto.type, value: dto.value }
}
