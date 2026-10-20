import { fetchSearch } from "@/lib/api/reads/search"
import { toSearchHits } from "@/lib/api/adapters"
import { usePagedRead } from "@/hooks/usePagedRead"
import { paramsKey, toSearchParams } from "@/services/searchParams"
import type { SearchResultKind, SearchFilters, SortOption } from "@/types/search"

/** How many hits one request asks for (the API allows 1-50). */
export const SEARCH_PAGE_SIZE = 12

/**
 * Real search over `GET /api/v1/search` (Phase 12G).
 *
 * The committed URL state (query, type, filters, sort) is the request: a change aborts the previous
 * request, so an old answer can never replace a newer one. "Load more" fetches the NEXT server page
 * and appends it, and `total` is the server's true match count. Typing is already debounced into the
 * URL by the Search page, so this sends one request per committed state.
 */
export function useSearchResults(
  query: string,
  type: SearchResultKind | "all",
  filters: SearchFilters = {},
  sort: SortOption = "default"
) {
  const params = toSearchParams(query, type, filters, sort)
  const key = paramsKey(params)
  const paged = usePagedRead(key, async (offset, signal) => {
    const page = await fetchSearch({ ...params, limit: SEARCH_PAGE_SIZE, offset }, signal)
    return { items: toSearchHits(page.items), raw: page.items.length, total: page.meta.total, extra: undefined }
  })
  return { ...paged, results: paged.items }
}
