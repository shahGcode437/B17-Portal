import { useEffect, useState } from "react"
import { searchAll } from "@/services/search"
import type { SearchHit, SearchResultKind, SearchFilters, SortOption } from "@/types/search"

const SIMULATED_LATENCY_MS = 280

/** Client-side result "page" size (Phase 9B) — see the module doc below for why this is client-side only. */
const PAGE_SIZE = 12

/**
 * Runs the local mock search with a brief simulated latency so the
 * skeleton loading state is visible (Prototype Scope §20 — loading states
 * should exist where they improve realism, without dominating the demo).
 *
 * Also owns a small client-side "visible window" (Phase 9B) so a query that
 * matches many records doesn't render everything at once — this is a
 * transparent, easy-to-replace stand-in for real pagination, not an attempt
 * to imitate a backend cursor API that doesn't exist yet. The window resets
 * to `PAGE_SIZE` whenever the query/type/filters/sort change.
 */
export function useSearchResults(
  query: string,
  type: SearchResultKind | "all",
  filters: SearchFilters = {},
  sort: SortOption = "default"
) {
  const [results, setResults] = useState<SearchHit[]>(() => searchAll(query, type, filters, sort))
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const timer = setTimeout(() => {
      if (cancelled) return
      setResults(searchAll(query, type, filters, sort))
      setVisibleCount(PAGE_SIZE)
      setLoading(false)
    }, SIMULATED_LATENCY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `filters` must be a referentially-stable object for this dependency to
    // be meaningful (not a new object every render) — see `useFilters` in
    // SearchPage, which memoizes it against the underlying URL params.
  }, [query, type, filters, sort])

  function loadMore() {
    setVisibleCount((count) => Math.min(count + PAGE_SIZE, results.length))
  }

  return {
    results,
    visibleResults: results.slice(0, visibleCount),
    hasMore: visibleCount < results.length,
    loadMore,
    loading,
  }
}
