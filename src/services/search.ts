import type { SearchHit, SearchResultKind } from "@/types/search"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Tutor } from "@/types/tutor"
import type { Property, ListingType } from "@/types/property"
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

export function searchAll(query: string, type: SearchResultKind | "all" = "all"): SearchHit[] {
  const q = query.trim().toLowerCase()
  return allHits().filter((hit) => {
    if (type !== "all" && hit.kind !== type) return false
    if (!q) return true
    return searchableText(hit).includes(q)
  })
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

export function getFeaturedBusinesses(limit = 4) {
  return [...businesses].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, limit)
}

/** Unique business categories in seed order — feeds the Business Directory landing page's tiles. */
export function getBusinessCategories(): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const business of businesses) {
    if (seen.has(business.category)) continue
    seen.add(business.category)
    result.push(business.category)
  }
  return result
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

export function getFeaturedProperties(limit = 3) {
  return properties.slice(0, limit)
}

/** Unique listing types (Sale/Rent) in seed order — feeds the Property landing page's tiles. */
export function getPropertyListingTypes(): ListingType[] {
  const seen = new Set<ListingType>()
  const result: ListingType[] = []
  for (const property of properties) {
    if (seen.has(property.listingType)) continue
    seen.add(property.listingType)
    result.push(property.listingType)
  }
  return result
}

/** Unique property types (House/Flat/Plot/...) in seed order — feeds the Property landing page's tiles. */
export function getPropertyTypes(): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const property of properties) {
    if (seen.has(property.propertyType)) continue
    seen.add(property.propertyType)
    result.push(property.propertyType)
  }
  return result
}

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

/** Sponsored/featured placements (Master Spec §7) — static demo cards, not a real advertiser. */
export function getSponsoredCards(): SponsoredCard[] {
  return sponsoredCards
}
