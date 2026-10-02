import { useMemo } from "react"
import { getSearchSuggestions, MIN_SUGGESTION_QUERY_LENGTH } from "@/services/search"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import type { SearchResultKind, SearchSuggestion } from "@/types/search"

const SUGGESTION_DEBOUNCE_MS = 150
const NO_SUGGESTIONS: SearchSuggestion[] = []

/**
 * Predictive suggestions for the current draft query and selected type. This
 * hook is the single place that knows suggestions are local today: a backend
 * `/search/suggestions` call would replace the `useMemo` below (debounce
 * already lives here), and nothing in the SearchBar would need to change.
 */
export function useSearchSuggestions(query: string, type: SearchResultKind | "all"): SearchSuggestion[] {
  const debouncedQuery = useDebouncedValue(query, SUGGESTION_DEBOUNCE_MS)
  const suggestions = useMemo(() => getSearchSuggestions(debouncedQuery, type), [debouncedQuery, type])
  // Judge "too short" on the live text so clearing the box hides the list at
  // once instead of waiting out the debounce.
  return query.trim().length < MIN_SUGGESTION_QUERY_LENGTH ? NO_SUGGESTIONS : suggestions
}
