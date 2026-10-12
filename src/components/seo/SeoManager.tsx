import { useEffect, useSyncExternalStore } from "react"
import { useLocation } from "react-router-dom"
import { applySeo } from "@/seo/applySeo"
import { resolveRouteSeo } from "@/seo/routeSeo"
import { getSeoOverride, subscribeSeo } from "@/seo/seoState"

/**
 * Keeps document metadata in step with the current route (Phase 9J). Rendered once per layout
 * (inside `RouteOutlet`). A page's own override (entity title / description / image) wins for
 * its own URL; everything else uses the route table.
 */
function SeoManager() {
  const { pathname } = useLocation()
  const override = useSyncExternalStore(subscribeSeo, getSeoOverride)
  const seo = override && override.path === pathname ? override.seo : resolveRouteSeo(pathname)

  useEffect(() => {
    applySeo(seo, pathname)
  }, [seo, pathname])

  return null
}

export { SeoManager }
