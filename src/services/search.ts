import type { SearchHit, SearchResultKind, SearchFilters, SearchSuggestion, SortOption } from "@/types/search"
import type { Provider } from "@/types/provider"
import type { Business, BusinessVertical, FoodProfile } from "@/types/business"
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
import { searchTypeFilters } from "@/config/search"
import { foodCategoryLabel } from "@/config/food"
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

/** Extra searchable Food terms: the DISPLAY labels of every Food category and the menu-highlight names. */
function foodSearchTerms(food: FoodProfile): string[] {
  return [...food.categories.map(foodCategoryLabel), ...(food.menuHighlights ?? []).map((highlight) => highlight.name)]
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

  const foodTerms = hit.kind === "business" && hit.item.food ? foodSearchTerms(hit.item.food) : []

  return [result.title, result.subtitle, result.description, result.area ?? "", ...result.tags, ...foodTerms]
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
      if (filters.vertical && hit.item.vertical !== filters.vertical) return false
      // Food-only filters: a business without a Food profile can never match them.
      if (filters.foodCategory && !hit.item.food?.categories.includes(filters.foodCategory)) return false
      if (filters.service && !hit.item.food?.serviceOptions.includes(filters.service)) return false
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

/** Shortest query that produces suggestions — a single character is too ambiguous to be useful. */
export const MIN_SUGGESTION_QUERY_LENGTH = 2

const KIND_LABELS = new Map(searchTypeFilters.map((filter) => [filter.value, filter.label]))
const KIND_ORDER: SearchResultKind[] = ["provider", "business", "tutor", "property", "news"]

/** The real, already-searchable pieces of a hit that suggestions may be built from — nothing is invented. */
interface SuggestionSource {
  entity: { id: string; label: string; subtitle: string }
  /** Categorical fields (category, subject, grade, property type, listing type). */
  fields: string[]
  tags: string[]
}

function suggestionSource(hit: SearchHit): SuggestionSource {
  switch (hit.kind) {
    case "provider":
      return {
        entity: { id: hit.item.id, label: hit.item.name, subtitle: hit.item.categoryLabel },
        fields: [hit.item.categoryLabel],
        tags: hit.item.tags,
      }
    case "business": {
      const food = hit.item.food
      return {
        entity: { id: hit.item.id, label: hit.item.name, subtitle: hit.item.category },
        fields: [hit.item.category, ...(food ? food.categories.map(foodCategoryLabel) : [])],
        // Menu-highlight names are searchable (see `foodSearchTerms`), so they are valid suggestions too.
        tags: [...hit.item.tags, ...(food?.menuHighlights ?? []).map((highlight) => highlight.name)],
      }
    }
    case "tutor":
      return {
        entity: { id: hit.item.id, label: hit.item.name, subtitle: `${hit.item.subject} · ${hit.item.grade}` },
        fields: [hit.item.subject, hit.item.grade],
        tags: hit.item.tags,
      }
    case "property": {
      const listing = hit.item.listingType === "sale" ? "For Sale" : "For Rent"
      return {
        entity: { id: hit.item.id, label: hit.item.title, subtitle: `${hit.item.propertyType} · ${listing}` },
        fields: [hit.item.propertyType, listing],
        tags: hit.item.tags,
      }
    }
    case "news":
      return {
        entity: { id: hit.item.id, label: hit.item.title, subtitle: hit.item.category },
        fields: [hit.item.category],
        tags: hit.item.tags,
      }
  }
}

/** 0 exact, 1 starts-with, 2 word-prefix, 3 contains — or null when `label` doesn't contain `q` at all. Both arguments must already be lowercased. */
function suggestionRank(label: string, q: string): number | null {
  const first = label.indexOf(q)
  if (first === -1) return null
  if (label === q) return 0
  if (first === 0) return 1
  for (let i = first; i !== -1; i = label.indexOf(q, i + 1)) {
    if (!/[\p{L}\p{N}]/u.test(label[i - 1])) return 2
  }
  return 3
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Predictive suggestions for the Search box (Visual V2.1), derived only from
 * fields the existing search already matches on — item names/titles,
 * categorical fields and tags — for approved/published content only (it reuses
 * `allHits`). Selecting any suggestion therefore always yields at least one
 * result in its own type. Area and furnishing are intentionally not
 * suggested: each already has an exact-match filter, and a substring query
 * like "furnished" would also match "Unfurnished".
 *
 * Ranking is deterministic: exact → starts-with → word-prefix → contains, then
 * shorter label, then alphabetical. Results are de-duplicated per type and
 * capped at `limit`.
 *
 * This signature deliberately mirrors the future backend contract
 * (`GET /api/v1/search/suggestions?q=&type=&limit=`) so the local
 * implementation can be swapped for an API call behind `useSearchSuggestions`.
 */
export function getSearchSuggestions(
  query: string,
  type: SearchResultKind | "all" = "all",
  limit = 8
): SearchSuggestion[] {
  const q = query.trim().toLowerCase()
  if (q.length < MIN_SUGGESTION_QUERY_LENGTH) return []

  const sources = allHits()
    .filter((hit) => type === "all" || hit.kind === type)
    .map((hit) => ({ kind: hit.kind, source: suggestionSource(hit) }))

  const seen = new Set<string>()
  const ranked: { suggestion: SearchSuggestion; rank: number }[] = []

  function consider(kind: SearchResultKind, id: string, label: string, secondaryLabel: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    const lowered = trimmed.toLowerCase()
    const key = `${kind}|${lowered}`
    if (seen.has(key)) return
    const rank = suggestionRank(lowered, q)
    if (rank === null) return
    seen.add(key)
    ranked.push({ suggestion: { id, label: trimmed, secondaryLabel, type: kind, value: trimmed }, rank })
  }

  // Categorical fields first, then tags, then individual items: when the same
  // text appears in more than one role, the best-cased, most general one wins.
  for (const { kind, source } of sources) {
    const kindLabel = KIND_LABELS.get(kind) ?? kind
    for (const field of source.fields) consider(kind, `${kind}:term:${field.toLowerCase()}`, field, kindLabel)
  }
  for (const { kind, source } of sources) {
    const kindLabel = KIND_LABELS.get(kind) ?? kind
    for (const tag of source.tags) consider(kind, `${kind}:term:${tag.toLowerCase()}`, capitalizeFirst(tag), kindLabel)
  }
  for (const { kind, source } of sources) {
    const kindLabel = KIND_LABELS.get(kind) ?? kind
    const { id, label, subtitle } = source.entity
    consider(kind, `${kind}:item:${id}`, label, `${kindLabel} · ${subtitle}`)
  }

  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.suggestion.label.length - b.suggestion.label.length ||
      a.suggestion.label.localeCompare(b.suggestion.label) ||
      KIND_ORDER.indexOf(a.suggestion.type) - KIND_ORDER.indexOf(b.suggestion.type)
  )
  return ranked.slice(0, limit).map((entry) => entry.suggestion)
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

/**
 * Unique business categories in seed order — feeds the Business Directory landing page's tiles.
 * Pass a `vertical` to scope to it (the general Directory passes "general" so Food categories
 * aren't duplicated there); omitted, every business is included, as before.
 */
export function getBusinessCategories(vertical?: BusinessVertical): string[] {
  return uniqueInOrder(
    businesses.filter((b) => !vertical || b.vertical === vertical),
    (b) => b.category
  )
}

/**
 * Food & Dining businesses for the /food preview (FD2): records flagged `featured` first
 * (the existing real flag, nothing is promoted), then seed order. Static seed only, like
 * `getFeaturedBusinesses`.
 */
export function getFoodBusinesses(limit = 4): Business[] {
  return businesses
    .filter((b) => b.vertical === "food")
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
    .slice(0, limit)
}

/** Unique business areas in seed order — feeds the Search "Area" filter for the Directory (optionally scoped to a vertical). */
export function getBusinessAreas(vertical?: BusinessVertical): string[] {
  return uniqueInOrder(
    businesses.filter((b) => !vertical || b.vertical === vertical),
    (b) => b.area
  )
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
