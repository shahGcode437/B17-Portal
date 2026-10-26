import { useLayoutEffect, useRef } from "react"
import { Outlet, useLocation, useNavigationType } from "react-router-dom"
import { scrollIntentFor, type Landing } from "@/app/scrollIntent"

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** The element a URL fragment names, or `null` (a malformed percent-escape is simply "no target"). */
function hashTarget(hash: string): HTMLElement | null {
  if (!hash) return null
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)))
  } catch {
    return null
  }
}

/**
 * Applies `scrollIntentFor` after every navigation. It renders nothing and is mounted ONCE, above every layout
 * (`AppRoot`), so it also sees navigations between layouts (Consumer to Professional Workspace to Admin) and
 * individual links never need their own `scrollTo`. A layout effect, so the position is reset before the new page
 * is painted rather than after a flash of the old offset.
 */
function ScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const previous = useRef<Landing | null>(null)

  useLayoutEffect(() => {
    const next: Landing = { key: location.key, pathname: location.pathname, search: location.search, hash: location.hash }
    const target = hashTarget(next.hash)
    const intent = scrollIntentFor(previous.current, next, navigationType, target !== null)
    previous.current = next

    // `scrollTo(0, 0)` is an instant jump in every browser (the page sets no CSS `scroll-behavior`). The option
    // form `{ behavior: "instant" }` is avoided on purpose: Safari before 15.4 rejects that value with a TypeError,
    // which would break every route change there. Only the glide uses the options form (`"smooth"` is universal).
    if (intent === "hash") target?.scrollIntoView()
    else if (intent === "top") window.scrollTo(0, 0)
    else if (intent === "top-smooth") {
      if (prefersReducedMotion()) window.scrollTo(0, 0)
      else window.scrollTo({ top: 0, left: 0, behavior: "smooth" })
    }
  }, [location.key, location.pathname, location.search, location.hash, navigationType])

  return null
}

/** The router's root element: the scroll rule plus the matched layout. */
function AppRoot() {
  return (
    <>
      <ScrollManager />
      <Outlet />
    </>
  )
}

export { ScrollManager, AppRoot }
