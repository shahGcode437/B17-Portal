import type { SearchParams } from "@/lib/api/reads/search"
import type { SearchFilters, SearchResultKind, SortOption } from "@/types/search"

/**
 * The canonical URL state of the Search page -> the exact parameters `GET /search` accepts
 * (READ_API_PARITY.md §1). Blank values are omitted; `sort` is sent only when it is not the default;
 * nothing frontend-only is ever put on the wire. The returned object is also the cache key.
 */
export function toSearchParams(
  query: string,
  type: SearchResultKind | "all",
  filters: SearchFilters,
  sort: SortOption
): SearchParams {
  const params: SearchParams = {}
  const q = query.trim()
  if (q) params.q = q
  if (type !== "all") params.type = type
  if (filters.area) params.area = filters.area
  if (filters.category) params.category = filters.category
  if (filters.subject) params.subject = filters.subject
  if (filters.grade) params.grade = filters.grade
  if (filters.minBedrooms) params.bedrooms = filters.minBedrooms
  if (filters.furnished) params.furnished = filters.furnished
  if (filters.listingType) params.listingType = filters.listingType
  if (filters.propertyType) params.propertyType = filters.propertyType
  if (filters.vertical) params.vertical = filters.vertical
  if (filters.foodCategory) params.foodCategory = filters.foodCategory
  if (filters.service) params.service = filters.service
  if (sort === "newest") params.sort = "newest"
  return params
}

/** A stable string for a parameter bag: same parameters (in any order) -> same key. */
export function paramsKey(params: object): string {
  return JSON.stringify(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
