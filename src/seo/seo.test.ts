import { afterEach, describe, expect, it } from "vitest"
import { HOME_TITLE, SITE_DESCRIPTION, pageTitle, publicImagePath, summarize } from "@/config/seo"
import { applySeo } from "@/seo/applySeo"
import { businessSeo, newsSeo, propertySeo } from "@/seo/entitySeo"
import { resolveRouteSeo } from "@/seo/routeSeo"
import { getBusinessById, getNewsById, getPropertyById } from "@/services/search"

const meta = (selector: string) => document.head.querySelector(selector)?.getAttribute("content") ?? null

afterEach(() => {
  document.head.innerHTML = ""
  document.title = ""
})

describe("title and text helpers", () => {
  it("formats titles consistently", () => {
    expect(pageTitle("Karahi Junction")).toBe("Karahi Junction | B-17 Portal")
    expect(HOME_TITLE).toBe("B-17 Portal | Local Services, Property, Food & More")
  })

  it("summarises to a meta-description length at a word boundary, collapsing whitespace", () => {
    const long = "word ".repeat(80)
    const result = summarize(long, "fallback")
    expect(result.length).toBeLessThanOrEqual(155)
    expect(result.endsWith("…")).toBe(true)
    expect(result).not.toMatch(/\s{2}/)
    expect(summarize("  Short   text  ", "fallback")).toBe("Short text")
  })

  it("falls back when there is no text", () => {
    expect(summarize("   ", "fallback")).toBe("fallback")
    expect(summarize(undefined, "fallback")).toBe("fallback")
  })

  it("accepts only site-relative public image paths (never blob:, data: or external URLs)", () => {
    expect(publicImagePath("/images/news/water.jpg")).toBe("/images/news/water.jpg")
    expect(publicImagePath("blob:http://x/abc")).toBeUndefined()
    expect(publicImagePath("data:image/png;base64,AAAA")).toBeUndefined()
    expect(publicImagePath("https://evil.example/x.jpg")).toBeUndefined()
    expect(publicImagePath("//evil.example/x.jpg")).toBeUndefined()
    expect(publicImagePath(undefined)).toBeUndefined()
  })
})

describe("route indexing rules", () => {
  it.each(["/", "/services", "/directory", "/food", "/education", "/property", "/news"])("%s is indexable with a canonical", (path) => {
    const seo = resolveRouteSeo(path)
    expect(seo.indexing).toBe("index")
    expect(seo.canonicalPath).toBe(path)
  })

  it("gives Home its own title and description", () => {
    expect(resolveRouteSeo("/")).toMatchObject({ title: HOME_TITLE, description: SITE_DESCRIPTION })
  })

  it("keeps Search out of the index but followable, with a stable canonical", () => {
    expect(resolveRouteSeo("/search")).toMatchObject({ indexing: "noindex,follow", canonicalPath: "/search" })
  })

  it.each([
    "/login",
    "/register",
    "/profile",
    "/profile/saved",
    "/profile/requests",
    "/provider",
    "/provider/listings",
    "/provider/listings/new",
    "/provider/listings/abc/edit",
    "/provider/leads",
    "/provider/analytics",
    "/provider/upgrade",
    "/admin",
    "/admin/login",
    "/admin/moderation",
    "/admin/content",
    "/admin/content/new",
    "/admin/content/abc/edit",
    "/coming-soon",
  ])("%s is noindex, nofollow and has a real title", (path) => {
    const seo = resolveRouteSeo(path)
    expect(seo.indexing).toBe("noindex,nofollow")
    expect(seo.title).toMatch(/\| B-17 Portal$/)
    expect(seo.canonicalPath).toBeUndefined()
  })

  it("treats every unknown URL, including removed routes, as a noindex 404", () => {
    for (const path of ["/definitely-missing", "/services/home-construction", "/provider/xyz/abc/def", "/food/some-id"]) {
      expect(resolveRouteSeo(path)).toMatchObject({ title: "Page Not Found | B-17 Portal", indexing: "noindex,nofollow" })
    }
  })
})

describe("entity metadata", () => {
  it("builds a business title, description, canonical and a public-only image", () => {
    const business = getBusinessById("business-08")
    const seo = businessSeo(business)
    expect(seo).toMatchObject({ title: "Karahi Junction | B-17 Portal", indexing: "index", canonicalPath: "/businesses/business-08" })
    expect(seo.description).toContain("Desi Food in B-17, Block A")
    expect(seo.description.length).toBeLessThanOrEqual(155)
  })

  it("never exposes a blob: preview image for a user-submitted business", () => {
    const seo = businessSeo({ id: "u1", name: "User Cafe", vertical: "general", category: "Cafe", description: "A cafe.", area: "B-17", tags: [], image: "blob:http://x/1" })
    expect(seo.image).toBeUndefined()
  })

  it("uses the article image and type for news, and the sale/rent wording for property", () => {
    const news = newsSeo(getNewsById("news-01"))
    expect(news.ogType).toBe("article")
    expect(news.image).toMatch(/^\/images\/news\//)
    expect(propertySeo(getPropertyById("property-01")).description).toMatch(/for (sale|rent) in/)
  })

  it("marks a missing entity noindex with a 'not found' title", () => {
    for (const seo of [businessSeo(undefined), newsSeo(undefined), propertySeo(undefined)]) {
      expect(seo.indexing).toBe("noindex,nofollow")
      expect(seo.title).toMatch(/not found \| B-17 Portal$/)
      expect(seo.canonicalPath).toBeUndefined()
    }
  })
})

describe("applySeo (document head)", () => {
  it("writes title, description, one canonical and the social tags; indexable pages carry no robots tag", () => {
    applySeo(resolveRouteSeo("/food"), "/food")
    expect(document.title).toBe("Food & Dining in B-17 | B-17 Portal")
    expect(meta('meta[name="description"]')).toContain("B-17, Islamabad")
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(/\/food$/)
    expect(meta('meta[name="robots"]')).toBeNull()
    expect(meta('meta[property="og:title"]')).toBe("Food & Dining in B-17 | B-17 Portal")
    expect(meta('meta[name="twitter:card"]')).toBe("summary")
  })

  it("adds noindex, nofollow and drops the canonical on a private route, then restores on a public one (no duplicates)", () => {
    applySeo(resolveRouteSeo("/food"), "/food")
    applySeo(resolveRouteSeo("/admin"), "/admin")
    expect(meta('meta[name="robots"]')).toBe("noindex, nofollow")
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    applySeo(resolveRouteSeo("/news"), "/news")
    expect(meta('meta[name="robots"]')).toBeNull()
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
  })

  it("uses the large Twitter card only when the page has its own image", () => {
    applySeo(newsSeo(getNewsById("news-01")), "/news/news-01")
    expect(meta('meta[name="twitter:card"]')).toBe("summary_large_image")
    expect(meta('meta[property="og:type"]')).toBe("article")
    expect(meta('meta[property="og:image"]')).toMatch(/\/images\/news\/.+\.jpg$/)
  })
})
