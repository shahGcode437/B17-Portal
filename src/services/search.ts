import type { SearchHit, SearchResultKind, SearchFilters, SortOption } from "@/types/search"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Tutor } from "@/types/tutor"
import type { Property, ListingType, FurnishingStatus } from "@/types/property"
import type { NewsArticle } from "@/types/news"
import type { SponsoredCard } from "@/types/sponsored"
import { providers } from "@/data/providers"
import { businesses } from "@/data/businesses"
import { tutors } from "@/data/tutors"
import { properties } from "@/data/properties"
import { sponsoredCards } from "@/data/sponsored"
import { useListingsStore } from "@/state/listingsStore"
import { useNewsStore } from "@/state/newsStore"
import {
  mapProviderToResult,
  mapBusinessToResult,
  mapTutorToResult,
  mapPropertyToResult,
  mapNewsToResult,
} from "@/services/mappers"

/**
 * Thin data-access layer over the local mock datasets (Master Spec §15).
 * Every function here is the seam to swap in a real API later — pages and
 * components must never import from `@/data/*` directly.
 */

/**
 * Approved provider/business listings from the moderation store (Phase 4B).
 * Only `status === "approved"` listings are eligible — pending and rejected
 * listings must never become publicly searchable or resolvable. `search.ts`
 * is a plain module (not a component), so it reads the Zustand store via
 * `getState()`. Shared by both the Search merge below and the by-id lookups
 * further down, so the "approved only" filter lives in exactly one place.
 */
function approvedListings() {
  return useListingsStore.getState().listings.filter((listing) => listing.status === "approved")
}

function approvedListingHits(): SearchHit[] {
  return approvedListings().map((listing): SearchHit => {
    if (listing.kind === "provider") return { kind: "provider", item: listing.data }
    if (listing.kind === "business") return { kind: "business", item: listing.data }
    return { kind: "property", item: listing.data }
  })
}

/** A provider found via the moderation store — caller is trusted to have filtered by `kind`. */
function getApprovedProviderById(id: string): Provider | undefined {
  const listing = approvedListings().find((l) => l.kind === "provider" && l.id === id)
  return listing ? (listing.data as Provider) : undefined
}

function getApprovedBusinessById(id: string): Business | undefined {
  const listing = approvedListings().find((l) => l.kind === "business" && l.id === id)
  return listing ? (listing.data as Business) : undefined
}

function getApprovedPropertyById(id: string): Property | undefined {
  const listing = approvedListings().find((l) => l.kind === "property" && l.id === id)
  return listing ? (listing.data as Property) : undefined
}

/**
 * Published news articles and daily updates (Phase 5A) — one unified list,
 * `kind` distinguishes editorial News from operational Daily Updates.
 * Only `status === "published"` items are eligible for public Search or the
 * public /news pages; drafts must never be publicly visible.
 */
function publishedNews(): NewsArticle[] {
  return useNewsStore.getState().items.filter((item) => item.status === "published")
}

function allHits(): SearchHit[] {
  return [
    ...providers.map((item): SearchHit => ({ kind: "provider", item })),
    ...businesses.map((item): SearchHit => ({ kind: "business", item })),
    ...tutors.map((item): SearchHit => ({ kind: "tutor", item })),
    ...properties.map((item): SearchHit => ({ kind: "property", item })),
    ...publishedNews().map((item): SearchHit => ({ kind: "news", item })),
    ...approvedListingHits(),
  ]
}

/** Builds the same {title, subtitle, description, area, tags} bag used for matching, regardless of kind. */
function searchableText(hit: SearchHit): string {
  const result =
    hit.kind === "provider"
      ? mapProviderToResult(hit.item)
      : hit.kind === "business"
        ? mapBusinessToResult(hit.item)
        : hit.kind === "tutor"
          ? mapTutorToResult(hit.item)
          : hit.kind === "property"
            ? mapPropertyToResult(hit.item)
            : mapNewsToResult(hit.item)

  return [result.title, result.subtitle, result.description, result.area ?? "", ...result.tags]
    .join(" ")
    .toLowerCase()
}

/** Collects unique values (by `keyFn`) from `items`, in first-seen order. Shared by every filter-option enumerator below. */
function uniqueInOrder<T, K>(items: T[], keyFn: (item: T) => K): K[] {
  const seen = new Set<K>()
  const result: K[] = []
  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

/**
 * Applies only the filter fields that genuinely exist on a hit's own kind —
 * an empty `filters` object always matches everything, so callers that don't
 * pass filters get identical behavior to before Phase 9B. No field here is
 * invented: each check reads a real property already present on the domain
 * type (see the honesty notes on `SearchFilters` in types/search.ts).
 */
function matchesFilters(hit: SearchHit, filters: SearchFilters): boolean {
  switch (hit.kind) {
    case "provider":
      if (filters.area && hit.item.area !== filters.area) return false
      if (filters.category && hit.item.category !== filters.category) return false
      return true
    case "business":
      if (filters.area && hit.item.area !== filters.area) return false
      if (filters.category && hit.item.category !== filters.category) return false
      return true
    case "tutor":
      if (filters.area && hit.item.area !== filters.area) return false
      if (filters.subject && hit.item.subject !== filters.subject) return false
      if (filters.grade && hit.item.grade !== filters.grade) return false
      return true
    case "property":
      if (filters.area && hit.item.area !== filters.area) return false
      if (filters.listingType && hit.item.listingType !== filters.listingType) return false
      if (filters.propertyType && hit.item.propertyType !== filters.propertyType) return false
      if (filters.minBedrooms && (!hit.item.bedrooms || hit.item.bedrooms < filters.minBedrooms)) return false
      if (filters.furnished && hit.item.furnished !== filters.furnished) return false
      return true
    case "news":
      if (filters.category && hit.item.category !== filters.category) return false
      return true
  }
}

/**
 * "newest" only has a genuine timestamp to sort by on News (`publishedAt`);
 * every other kind has no date field today, so this only reorders when the
 * hit is news — everything else keeps its existing relative order. "default"
 * is a no-op (the pre-Phase-9B natural/insertion order).
 */
function sortHits(hits: SearchHit[], sort: SortOption): SearchHit[] {
  if (sort !== "newest") return hits
  return [...hits].sort((a, b) => {
    const aDate = a.kind === "news" ? a.item.publishedAt : ""
    const bDate = b.kind === "news" ? b.item.publishedAt : ""
    return bDate.localeCompare(aDate)
  })
}

export function searchAll(
  query: string,
  type: SearchResultKind | "all" = "all",
  filters: SearchFilters = {},
  sort: SortOption = "default"
): SearchHit[] {
  const q = query.trim().toLowerCase()
  const matched = allHits().filter((hit) => {
    if (type !== "all" && hit.kind !== type) return false
    if (!matchesFilters(hit, filters)) return false
    if (!q) return true
    return searchableText(hit).includes(q)
  })
  return sortHits(matched, sort)
}

/**
 * A provider can come from the static seed data or from an approved listing
 * submitted through the provider onboarding flow (Phase 4A/4B) — check the
 * static array first, then fall back to the moderation store.
 */
export function getProviderById(id: string): Provider | undefined {
  return providers.find((p) => p.id === id) ?? getApprovedProviderById(id)
}

export function getFeaturedProviders(limit = 4) {
  return [...providers].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, limit)
}

/** Unique provider areas in seed order — feeds the Search "Area" filter for Services. */
export function getProviderAreas(): string[] {
  return uniqueInOrder(providers, (p) => p.area)
}

export function getFeaturedBusinesses(limit = 4) {
  return [...businesses].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, limit)
}

/** Unique business categories in seed order — feeds the Business Directory landing page's tiles. */
export function getBusinessCategories(): string[] {
  return uniqueInOrder(businesses, (b) => b.category)
}

/** Unique business areas in seed order — feeds the Search "Area" filter for the Directory. */
export function getBusinessAreas(): string[] {
  return uniqueInOrder(businesses, (b) => b.area)
}

/** Same static-then-approved-listing resolution as getProviderById, for the same reason. */
export function getBusinessById(id: string): Business | undefined {
  return businesses.find((b) => b.id === id) ?? getApprovedBusinessById(id)
}

export function getFeaturedTutors(limit = 3) {
  return tutors.slice(0, limit)
}

export function getTutorById(id: string): Tutor | undefined {
  return tutors.find((t) => t.id === id)
}

/** Unique subjects (paired with their first-seen grade) in seed order — feeds the Education landing page's tiles. */
export function getTutorSubjects(): { subject: string; grade: string }[] {
  const seen = new Set<string>()
  const result: { subject: string; grade: string }[] = []
  for (const tutor of tutors) {
    if (seen.has(tutor.subject)) continue
    seen.add(tutor.subject)
    result.push({ subject: tutor.subject, grade: tutor.grade })
  }
  return result
}

/** Unique grades in seed order — feeds the Search "Grade" filter for Education, independent of subject. */
export function getTutorGrades(): string[] {
  return uniqueInOrder(tutors, (t) => t.grade)
}

/** Unique tutor areas in seed order — feeds the Search "Area" filter for Education. */
export function getTutorAreas(): string[] {
  return uniqueInOrder(tutors, (t) => t.area)
}

export function getFeaturedProperties(limit = 3) {
  return properties.slice(0, limit)
}

/** Unique listing types (Sale/Rent) in seed order — feeds the Property landing page's tiles. */
export function getPropertyListingTypes(): ListingType[] {
  return uniqueInOrder(properties, (p) => p.listingType)
}

/** Unique property types (House/Flat/Plot/...) in seed order — feeds the Property landing page's tiles. */
export function getPropertyTypes(): string[] {
  return uniqueInOrder(properties, (p) => p.propertyType)
}

/** Unique property areas in seed order — feeds the Search "Area" filter for Property. */
export function getPropertyAreas(): string[] {
  return uniqueInOrder(properties, (p) => p.area)
}

/**
 * Minimum-bedroom filter options, honestly derived from the real range of
 * `bedrooms` values present in the data (1 up to the highest value found) —
 * not an arbitrary constant. Properties without a `bedrooms` field (e.g.
 * plots) are excluded from the range but still correctly excluded by the
 * filter itself in `matchesFilters`.
 */
export function getPropertyBedroomOptions(): number[] {
  const max = properties.reduce((highest, p) => (p.bedrooms && p.bedrooms > highest ? p.bedrooms : highest), 0)
  return Array.from({ length: max }, (_, i) => i + 1)
}

/** The full set of furnishing statuses the `Property` type supports — a closed enum, not seed-derived. */
export const FURNISHED_OPTIONS: FurnishingStatus[] = ["Furnished", "Semi-Furnished", "Unfurnished"]

/** Same static-then-approved-listing resolution as getProviderById/getBusinessById, for the same reason. */
export function getPropertyById(id: string): Property | undefined {
  return properties.find((p) => p.id === id) ?? getApprovedPropertyById(id)
}

/** Sorted newest-first; omit `limit` to get every published item (used by the /news listing page). */
export function getLatestNews(limit?: number) {
  const sorted = [...publishedNews()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return limit === undefined ? sorted : sorted.slice(0, limit)
}

/** Only published items are resolvable — a draft's direct URL must not reveal it publicly. */
export function getNewsById(id: string): NewsArticle | undefined {
  return publishedNews().find((item) => item.id === id)
}

/** Unique published-news categories in seed order — feeds the Search "Category" filter for News. */
export function getNewsCategories(): string[] {
  return uniqueInOrder(publishedNews(), (item) => item.category)
}

/** Sponsored/featured placements (Master Spec §7) — static demo cards, not a real advertiser. */
export function getSponsoredCards(): SponsoredCard[] {
  return sponsoredCards
}
