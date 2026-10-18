import { useEffect } from "react"

/**
 * Sets `<meta name="referrer">` for the lifetime of a page (Phase 12C). The e-mail token routes
 * (`/verify-email`, `/reset-password`) use `no-referrer`; it is applied PER ROUTE, not site-wide,
 * because map tile servers (later phases) require a Referer. The real HTTP header is the host's job
 * (docs/backend/DEPLOYMENT.md §12); this is the in-app counterpart.
 */
export function useReferrerPolicy(policy: string): void {
  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "referrer"
    meta.content = policy
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [policy])
}
