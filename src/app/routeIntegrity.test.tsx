import { matchRoutes } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { router } from "@/app/router"
import { routes } from "@/config/routes"
import { resolveRouteSeo } from "@/seo/routeSeo"

/**
 * No dead navigation target (Phase 12S Step A). `/provider/listings/pending` was a route constant and an SEO entry
 * with no page behind it; this keeps every named route honest in both directions: each is a registered page (not the
 * 404 catch-all) and each has its own SEO entry (not the "Page Not Found" title), and the removed one stays removed.
 */
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, "sample-id")
const lastRoute = (pathname: string) => matchRoutes(router.routes, pathname)?.at(-1)?.route

describe("every named route leads to a real page", () => {
  it.each(Object.entries(routes))("routes.%s (%s) is a registered page, not the 404 catch-all", (_name, path) => {
    const route = lastRoute(concrete(path))
    expect(route, path).toBeDefined()
    expect(route?.path, path).not.toBe("*")
  })

  it.each(Object.entries(routes))("routes.%s (%s) has its own SEO entry, not the 'Page Not Found' title", (_name, path) => {
    expect(resolveRouteSeo(concrete(path)).title, path).not.toMatch(/Page Not Found/)
  })
})

describe("the removed /provider/listings/pending", () => {
  it("is not a named route any more", () => {
    expect(Object.keys(routes)).not.toContain("listingPending")
    expect(Object.values(routes)).not.toContain("/provider/listings/pending")
  })

  it("is the 404 page now, and is not indexed", () => {
    expect(lastRoute("/provider/listings/pending")?.path).toBe("*")
    expect(resolveRouteSeo("/provider/listings/pending")).toMatchObject({ title: "Page Not Found | B-17 Portal", indexing: "noindex,nofollow" })
  })
})
