import { Suspense } from "react"
import { Outlet, useMatches } from "react-router-dom"
import { RouteFallback } from "@/components/feedback/RouteFallback"

/**
 * The layouts' <Outlet/> wrapped in a Suspense boundary for lazy route pages
 * (Phase 9H). The boundary is keyed by the matched route (not the URL), so:
 * - moving to a different route mounts a fresh boundary and shows the loading
 *   fallback while that page's chunk downloads (React Router updates run in a
 *   transition, which would otherwise keep the old page frozen on screen);
 * - moving between URLs of the SAME route (e.g. /businesses/1 -> /businesses/2)
 *   keeps the page mounted exactly as before — no behavior change.
 */
function RouteOutlet() {
  const matches = useMatches()
  const routeId = matches[matches.length - 1]?.id

  return (
    <Suspense key={routeId} fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  )
}

export { RouteOutlet }
