import { fetchSuggestions } from "@/lib/api/reads/search"
import { toSuggestion } from "@/lib/api/adapters"
import { MIN_SUGGESTION_QUERY_LENGTH } from "@/config/search"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useRead } from "@/hooks/useRead"
import type { SearchResultKind, SearchSuggestion } from "@/types/search"

const SUGGESTION_DEBOUNCE_MS = 150
const SUGGESTION_LIMIT = 8
const NO_SUGGESTIONS: SearchSuggestion[] = []

/**
 * Predictive suggestions from `GET /search/suggestions` (Phase 12G) for the current draft query and
 * selected type. The draft is debounced; nothing is requested for text shorter than the minimum the
 * contract defines; a new keystroke aborts the previous request, and an answer that belongs to an
 * older query is never shown (`useRead` derives its state from the CURRENT key). Suggestions are a
 * convenience: a failure simply shows none.
 */
export function useSearchSuggestions(query: string, type: SearchResultKind | "all"): SearchSuggestion[] {
  const debounced = useDebouncedValue(query.trim(), SUGGESTION_DEBOUNCE_MS)
  const askable = debounced.length >= MIN_SUGGESTION_QUERY_LENGTH
  const read = useRead(
    `suggest:${type}:${debounced}`,
    async (signal) => {
      const rows = await fetchSuggestions(
        { q: debounced, type: type === "all" ? undefined : type, limit: SUGGESTION_LIMIT },
        signal
      )
      return rows.map(toSuggestion)
    },
    { enabled: askable }
  )
  // Judge "too short" on the live text so clearing the box hides the list at once, not after the debounce.
  if (query.trim().length < MIN_SUGGESTION_QUERY_LENGTH || !askable) return NO_SUGGESTIONS
  return read.status === "success" ? read.data : NO_SUGGESTIONS
}
