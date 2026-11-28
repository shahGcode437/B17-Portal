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

describe("which gate guards each staff and admin page (the real router)", () => {
  /** The nearest access gate above the page a URL matches. */
  const gateOf = (pathname: string) =>
    matchRoutes(router.routes, pathname)
      ?.map((match) => (match.route.element as { props?: { requires?: string } } | undefined)?.props?.requires)
      .filter(Boolean)
      .at(-1)

  it.each([
    routes.adminDashboard,
    routes.adminModeration,
    routes.adminCategories,
    routes.adminContent,
    routes.adminGrocerySettings,
    routes.adminStaff,
    routes.adminStaffHistory,
  ])("%s is Super Admin only", (path) => {
    expect(gateOf(path)).toBe("admin")
  })

  it.each([routes.adminGrocery, concrete(routes.adminGroceryOrder)])("%s is for grocery staff", (path) => {
    expect(gateOf(path)).toBe("grocery-staff")
  })

  it("the settings address is its own page, never read as an order id", () => {
    expect(lastRoute(routes.adminGrocerySettings)?.path).toBe("grocery/settings")
    expect(lastRoute(concrete(routes.adminGroceryOrder))?.path).toBe("grocery/:orderId")
    expect(resolveRouteSeo(routes.adminGrocerySettings).title).toMatch(/Grocery settings/)
  })
})
