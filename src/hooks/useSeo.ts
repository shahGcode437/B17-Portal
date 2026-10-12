import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { clearSeoOverride, setSeoOverride, type SeoDescriptor } from "@/seo/seoState"

/**
 * A page declares what it knows about itself (Phase 9J) — e.g. a business's name, description and
 * photo — while its data is loaded. Pass the descriptor memoised or built from stable values;
 * it is registered for the current URL and removed on unmount so the route default applies again.
 */
export function useSeo(seo: SeoDescriptor) {
  const { pathname } = useLocation()
  const { title, description, indexing, canonicalPath, image, ogType } = seo

  useEffect(() => {
    setSeoOverride(pathname, { title, description, indexing, canonicalPath, image, ogType })
    return () => clearSeoOverride(pathname)
  }, [pathname, title, description, indexing, canonicalPath, image, ogType])
}
