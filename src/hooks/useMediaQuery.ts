import { useSyncExternalStore } from "react"

function subscribe(query: string, callback: () => void) {
  const mql = window.matchMedia(query)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

/** Subscribes to a CSS media query (e.g. Tailwind's `md` breakpoint). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => subscribe(query, callback),
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** Convenience: matches Tailwind's `md` breakpoint (tablet and up). */
export function useIsDesktopNav() {
  return useMediaQuery("(min-width: 768px)")
}
