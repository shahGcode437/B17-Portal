import { useEffect, useState } from "react"
import { searchAll } from "@/services/search"
import type { SearchHit, SearchResultKind } from "@/types/search"

const SIMULATED_LATENCY_MS = 280

/**
 * Runs the local mock search with a brief simulated latency so the
 * skeleton loading state is visible (Prototype Scope §20 — loading states
 * should exist where they improve realism, without dominating the demo).
 */
export function useSearchResults(query: string, type: SearchResultKind | "all") {
  const [results, setResults] = useState<SearchHit[]>(() => searchAll(query, type))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const timer = setTimeout(() => {
      if (cancelled) return
      setResults(searchAll(query, type))
      setLoading(false)
    }, SIMULATED_LATENCY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, type])

  return { results, loading }
}
