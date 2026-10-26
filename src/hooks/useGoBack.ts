import { useCallback } from "react"
import { useNavigate } from "react-router-dom"

/**
 * The "Back" button on a detail page (Phase 12S, S3). `navigate(-1)` goes back only if THIS app put an earlier
 * entry in the tab's history; on a deep link (a shared link, a bookmark, a new tab, a reload of the first page) it
 * does nothing, or worse, leaves the site. React Router records each entry's position in `history.state.idx`
 * (0 = the first entry it created), so: with an earlier page of ours, go back to it exactly as before; without
 * one, go to `fallback` (the page's own section) instead of a dead control.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (index > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}
