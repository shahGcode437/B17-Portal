import { useState, useCallback } from "react"
import type { SearchResult } from "@/types/search"

/** Local UI state for the result Preview Dialog (Home + Search share this). */
export function useResultPreview() {
  const [selected, setSelected] = useState<SearchResult | null>(null)

  const open = useCallback((result: SearchResult) => setSelected(result), [])
  const onOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) setSelected(null)
  }, [])

  return { selected, open, onOpenChange }
}
