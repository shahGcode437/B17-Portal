import type { SearchHit, SearchResultKind } from "@/types/search"
import type { Provider } from "@/types/provider"
import { providers } from "@/data/providers"
import { businesses } from "@/data/businesses"
import { tutors } from "@/data/tutors"
import { properties } from "@/data/properties"
import { newsItems } from "@/data/news"
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

function allHits(): SearchHit[] {
  return [
    ...providers.map((item): SearchHit => ({ kind: "provider", item })),
    ...businesses.map((item): SearchHit => ({ kind: "business", item })),
    ...tutors.map((item): SearchHit => ({ kind: "tutor", item })),
    ...properties.map((item): SearchHit => ({ kind: "property", item })),
    ...newsItems.map((item): SearchHit => ({ kind: "news", item })),
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

export function getProviderById(id: string): Provider | undefined {
  return providers.find((p) => p.id === id)
}

export function getFeaturedProviders(limit = 4) {
  return [...providers].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, limit)
}

export function getFeaturedBusinesses(limit = 4) {
  return [...businesses].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, limit)
}

export function getFeaturedTutors(limit = 3) {
  return tutors.slice(0, limit)
}

export function getFeaturedProperties(limit = 3) {
  return properties.slice(0, limit)
}

export function getLatestNews(limit = 3) {
  return [...newsItems].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit)
}
