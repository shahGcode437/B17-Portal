import type { LucideIcon } from "lucide-react"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Tutor } from "@/types/tutor"
import type { Property, ListingType, FurnishingStatus } from "@/types/property"
import type { NewsArticle } from "@/types/news"

export type SearchResultKind = "provider" | "business" | "tutor" | "property" | "news"

/**
 * A search hit paired with its original, fully-typed domain record — lets
 * the result grid render the real per-kind card component (ProviderCard,
 * PropertyCard, ...) instead of a duplicate generic card.
 */
export type SearchHit =
  | { kind: "provider"; item: Provider }
  | { kind: "business"; item: Business }
  | { kind: "tutor"; item: Tutor }
  | { kind: "property"; item: Property }
  | { kind: "news"; item: NewsArticle }

/** Normalized shape for the single-item Preview Dialog (UI/UX Spec §8). */
export interface SearchResult {
  kind: SearchResultKind
  id: string
  title: string
  subtitle: string
  description: string
  area?: string
  image?: string
  icon: LucideIcon
  tags: string[]
}

export interface SearchTypeFilter {
  value: SearchResultKind | "all"
  label: string
  /** Empty-input placeholder for this type. Omitted for "all", which keeps the site-wide search prompt. */
  placeholder?: string
}

/**
 * One predictive-search suggestion (Visual V2.1). Deliberately a flat,
 * UI-ready shape with no domain objects, so the SearchBar never depends on
 * Provider/Business/etc. — a backend suggestions endpoint can return exactly
 * this shape later without touching the UI.
 */
export interface SearchSuggestion {
  /** Stable logical key (not a DOM id). */
  id: string
  /** Text shown for the suggestion. */
  label: string
  /** Short context shown under the label, e.g. "Property · Flat · For Rent". */
  secondaryLabel: string
  /** Content type the suggestion belongs to — selecting it switches Search to this type. */
  type: SearchResultKind
  /** The query committed when the suggestion is selected. */
  value: string
}

/**
 * Contextual filter values (Phase 9B). Every field is honestly backed by a
 * real, existing data field — nothing here is invented. Only the fields
 * relevant to the currently-selected `SearchResultKind` are ever read/shown;
 * see `search.ts` for which fields apply to which kind.
 */
export interface SearchFilters {
  area?: string
  category?: string
  subject?: string
  grade?: string
  minBedrooms?: number
  furnished?: FurnishingStatus
  listingType?: ListingType
  propertyType?: string
}

/**
 * "newest" is only honest where a real timestamp exists (News' `publishedAt`
 * today) — see `search.ts`. "default" is the existing natural/insertion
 * order, unchanged from before Phase 9B.
 */
export type SortOption = "default" | "newest"
