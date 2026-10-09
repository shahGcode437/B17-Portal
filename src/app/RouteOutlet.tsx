import { Component, Suspense, type ReactNode } from "react"
import { Outlet, useMatches } from "react-router-dom"
import { RouteError } from "@/components/feedback/RouteError"
import { RouteFallback } from "@/components/feedback/RouteFallback"

/** Catches a page that fails to load/render (e.g. a lazy chunk while offline) so the layout shell stays usable. */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error }
  }

  render() {
    return this.state.failed ? <RouteError error={this.state.error} /> : this.props.children
  }
}

/**
 * The layouts' <Outlet/> wrapped in a Suspense boundary for lazy route pages
 * (Phase 9H). The boundary is keyed by the matched route (not the URL), so:
 * - moving to a different route mounts a fresh boundary (and clears any previous load error) and shows the loading
 *   fallback while that page's chunk downloads (React Router updates run in a
 *   transition, which would otherwise keep the old page frozen on screen);
 * - moving between URLs of the SAME route (e.g. /businesses/1 -> /businesses/2)
 *   keeps the page mounted exactly as before — no behavior change.
 */
function RouteOutlet() {
  const matches = useMatches()
  const routeId = matches[matches.length - 1]?.id

  return (
    <RouteErrorBoundary key={routeId}>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </RouteErrorBoundary>
  )
}

export { RouteOutlet }
