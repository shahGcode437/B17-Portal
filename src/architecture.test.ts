import { describe, expect, it } from "vitest"

/**
 * Static guards for the Phase 12G boundaries. They read the source text of every production module
 * (test files and fixtures excluded) and fail if a rule is broken, so the boundary cannot erode
 * silently.
 */
const modules = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })

/** Source with comments removed, so a rule is judged on code, not on prose that names what it avoids. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const production = Object.entries(modules)
  .filter(([path]) => !/\.test\.(ts|tsx)$/.test(path) && !path.startsWith("/src/test/"))
  .map(([path, source]): [string, string] => [path, stripComments(source)])

function offenders(match: (path: string, source: string) => boolean): string[] {
  return production.filter(([path, source]) => match(path, source)).map(([path]) => path)
}

describe("architecture guards", () => {
  it("has production modules to scan (the glob works)", () => {
    expect(production.length).toBeGreaterThan(200)
  })

  it("no module imports a removed demo-data array or store (no silent mock fallback)", () => {
    expect(
      offenders((_, s) => /@\/data\/(providers|businesses|tutors|properties|news|pendingListings)\b/.test(s))
    ).toEqual([])
    expect(offenders((_, s) => /@\/state\/(listingsStore|newsStore)\b/.test(s))).toEqual([])
    expect(offenders((_, s) => /@\/services\/search["']/.test(s))).toEqual([])
  })

  it("only the central API client calls fetch", () => {
    expect(offenders((path, s) => path !== "/src/lib/api/client.ts" && /\bfetch\s*\(/.test(s) && !/\.fetch\(/.test(s))).toEqual([])
  })

  it("only leafletEngine.ts imports Leaflet; nothing imports react-leaflet or a Google Maps SDK", () => {
    expect(
      offenders((path, s) => path !== "/src/components/location/leafletEngine.ts" && /from\s+["']leaflet(\/|["'])/.test(s))
    ).toEqual([])
    expect(offenders((_, s) => /react-leaflet|@googlemaps|maps\.googleapis\.com|google\.maps/.test(s))).toEqual([])
  })

  it("the map engine is loaded lazily (dynamic import), never imported statically", () => {
    expect(offenders((_, s) => /import[^;\n]*from\s+["']@\/components\/location\/leafletEngine["']/.test(s))).toEqual([])
    const mapView = production.find(([path]) => path === "/src/components/location/MapView.tsx")?.[1] ?? ""
    expect(mapView).toMatch(/import\(\s*["']@\/components\/location\/leafletEngine["']\s*\)/)
  })

  it("uses no geolocation, geocoding or place-search API", () => {
    expect(offenders((_, s) => /navigator\.geolocation|geocod|nominatim|places\.googleapis/i.test(s))).toEqual([])
  })

  it("public (non-workspace) pages and components never import the private DTO or adapter modules", () => {
    const privateModules = /@\/lib\/api\/(dto\/private|privateAdapters|ownerAdapters|reads\/(saved|requests|owner|admin|counts))/
    const allowed = (path: string) =>
      path.startsWith("/src/features/provider/") ||
      path.startsWith("/src/features/admin/") ||
      path.startsWith("/src/features/resident/") ||
      path.startsWith("/src/lib/api/") ||
      path.startsWith("/src/hooks/") ||
      path.startsWith("/src/types/")
    expect(offenders((path, s) => !allowed(path) && privateModules.test(s))).toEqual([])
  })

  it("the public DTO module has no private-location field names", () => {
    const source = production.find(([path]) => path === "/src/lib/api/dto/public.ts")?.[1] ?? ""
    expect(source).not.toMatch(/\b(privateLocation|publicLocation|latitude\??:\s*number;\s*\n\s*longitude)/)
  })

  it("map and location components accept the PUBLIC location type only", () => {
    for (const path of [
      "/src/components/location/MapView.tsx",
      "/src/components/location/LocationSection.tsx",
      "/src/components/location/DirectionsButton.tsx",
    ]) {
      const source = production.find(([p]) => p === path)?.[1] ?? ""
      expect(source, path).toMatch(/PublicLocation/)
      expect(source, path).not.toMatch(/PrivateLocationView|OwnerListingView|AdminListingView/)
    }
  })

  it("no component writes to the API yet: no unsafe-method call exists outside the auth module", () => {
    const writers = offenders(
      (path, s) =>
        !path.startsWith("/src/lib/api/client") &&
        !path.startsWith("/src/features/auth/") &&
        !path.startsWith("/src/lib/api/auth") &&
        /apiRequest\w*(<[^>]*>)?\(\s*["'](POST|PUT|PATCH|DELETE)["']/.test(s)
    )
    expect(writers).toEqual([])
  })

  it("no Demo label exists for API listings: the DemoBadge component and its copy are gone", () => {
    expect(offenders((_, s) => /DemoBadge|Demo Listing|demo details/.test(s))).toEqual([])
    expect(production.find(([path]) => path === "/src/components/feedback/DemoBadge.tsx")).toBeUndefined()
  })

  it("filter options are never derived from a page of search results (no facet lookup from /search)", () => {
    expect(production.find(([path]) => path === "/src/hooks/useFilterOptions.ts")).toBeUndefined()
    // The only consumers of fetchSearch are the results hook and the bounded landing-page previews.
    const consumers = offenders((path, s) => /fetchSearch\(/.test(s) && !path.startsWith("/src/lib/api/"))
    expect(consumers.sort()).toEqual(["/src/hooks/useListings.ts", "/src/hooks/useSearchResults.ts"])
  })

  it("the Google directions link is built from numbers in one place only", () => {
    expect(offenders((path, s) => path !== "/src/components/location/directions.ts" && /google\.com\/maps/.test(s))).toEqual([])
  })
})
