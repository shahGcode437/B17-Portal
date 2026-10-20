import { apiRequest, apiRequestPage, type Page } from "@/lib/api/client"
import { queryString } from "@/lib/api/query"
import type { SearchHitDto, SuggestionDto } from "@/lib/api/dto/public"

/**
 * The parameters `GET /search` understands (READ_API_PARITY.md §1) — and ONLY those. The frontend's
 * Search URL keys are the API's keys; nothing frontend-only is ever sent.
 */
export interface SearchParams {
  q?: string
  type?: "provider" | "business" | "tutor" | "property" | "news"
  area?: string
  category?: string
  subject?: string
  grade?: string
  bedrooms?: number
  furnished?: string
  listingType?: string
  propertyType?: string
  vertical?: string
  foodCategory?: string
  service?: string
  sort?: "default" | "newest"
  limit?: number
  offset?: number
}

/** `GET /search` — approved listings and published news; `meta.total` is the true match count. */
export function fetchSearch(params: SearchParams, signal?: AbortSignal): Promise<Page<SearchHitDto>> {
  return apiRequestPage<SearchHitDto>("GET", `/search${queryString({ ...params })}`, { signal })
}

export interface SuggestionParams {
  q: string
  type?: SearchParams["type"]
  limit?: number
}

/** `GET /search/suggestions` — a `q` shorter than 2 characters yields `[]` (the caller does not ask). */
export function fetchSuggestions(params: SuggestionParams, signal?: AbortSignal): Promise<SuggestionDto[]> {
  return apiRequest<SuggestionDto[]>("GET", `/search/suggestions${queryString({ ...params })}`, { signal })
}
