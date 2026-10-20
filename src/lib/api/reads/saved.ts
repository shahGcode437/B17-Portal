import { apiRequestPage, type Page } from "@/lib/api/client"
import { queryString } from "@/lib/api/query"
import type { SavedHitDto } from "@/lib/api/dto/private"

export interface PageParams {
  limit?: number
  offset?: number
}

/**
 * `GET /saved` — the signed-in user's saved listings that are STILL approved, as public cards.
 * READ ONLY in Phase 12G: saving / un-saving is Phase 12H.
 */
export function fetchSaved(params: PageParams = {}, signal?: AbortSignal): Promise<Page<SavedHitDto>> {
  return apiRequestPage<SavedHitDto>("GET", `/saved${queryString({ ...params })}`, { signal, session: true })
}
