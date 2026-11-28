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

  it("only the two leaflet engines import Leaflet; nothing imports react-leaflet or a Google Maps SDK", () => {
    const engines = new Set(["/src/components/location/leafletEngine.ts", "/src/components/location/leafletPickerEngine.ts"])
    expect(
      offenders((path, s) => !engines.has(path) && /from\s+["']leaflet(\/|["'])/.test(s))
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

  it("only the grocery staff workspace imports the grocery STAFF API modules", () => {
    // They carry customer contact details, staff names, internal notes and the staff changes.
    const staffApi = /@\/lib\/api\/(dto|reads|writes)\/groceryStaff/
    const allowed = (path: string) => path.startsWith("/src/features/grocery-staff/") || path.startsWith("/src/lib/api/")
    expect(offenders((path, s) => !allowed(path) && staffApi.test(s))).toEqual([])
    // And nothing outside the router reaches into the workspace itself.
    expect(
      offenders(
        (path, s) =>
          !path.startsWith("/src/features/grocery-staff/") && path !== "/src/app/router.tsx" && /@\/features\/grocery-staff\//.test(s)
      )
    ).toEqual([])
    // The guard is not vacuous: the workspace exists and does import them.
    expect(offenders((path, s) => path.startsWith("/src/features/grocery-staff/") && staffApi.test(s)).length).toBeGreaterThan(3)
  })

  it("the API client never sends a request twice", () => {
    // SECURITY: re-sending after a CSRF refresh would carry a change out as whoever signed in meanwhile.
    const client = production.find(([path]) => path === "/src/lib/api/client.ts")?.[1] ?? ""
    expect(client.match(/\bfetch\(/g)).toHaveLength(1)
    // `execute` is the one sender: declared once, called only by the two public functions.
    expect(client.match(/\bexecute</g)).toHaveLength(3)
    const body = client.slice(client.indexOf("async function execute<"), client.indexOf("export async function apiRequest<"))
    expect(body.match(/\bexecute\b/g)).toHaveLength(1)
    expect(body).not.toMatch(/\b(for|while)\s*\(|retr(y|ied)\w*\s*[(=:]/)
    expect(offenders((_path, s) => /replayAfterCsrfRefresh/.test(s))).toEqual([])
  })

  it("authenticated changes live where the account-switch test lists them", () => {
    // `lib/api/writeReplay.test.tsx` covers every export of `writes/`, plus the two in `auth.ts`.
    const changes = (s: string) => s.match(/"(POST|PUT|PATCH|DELETE)"[^)]*?session:\s*true/gs)?.length ?? 0
    expect(
      offenders((path, s) => !path.startsWith("/src/lib/api/writes/") && path !== "/src/lib/api/auth.ts" && changes(s) > 0)
    ).toEqual([])
    expect(changes(production.find(([path]) => path === "/src/lib/api/auth.ts")?.[1] ?? "")).toBe(2)
    expect(offenders((path, s) => path.startsWith("/src/lib/api/writes/") && /session:\s*true/.test(s)).length).toBeGreaterThan(6)
  })

  it("only the screens that need them import the Super Admin settings and staff-management API modules", () => {
    // GROCERY-3C: settings records, staff e-mail addresses, the audit and the changes to both.
    const cases: [RegExp, string][] = [
      [/@\/lib\/api\/(dto|reads|writes)\/grocerySettings/, "/src/features/grocery-staff/settings/"],
      [/@\/lib\/api\/(dto|reads|writes)\/staffAdmin/, "/src/features/staff-management/"],
    ]
    for (const [modules_, folder] of cases) {
      expect(
        offenders((path, s) => !path.startsWith(folder) && !path.startsWith("/src/lib/api/") && modules_.test(s)),
        folder
      ).toEqual([])
      expect(offenders((path, s) => path.startsWith(folder) && modules_.test(s)).length, folder).toBeGreaterThan(1)
    }
    // Only the router reaches into staff management from outside.
    expect(
      offenders(
        (path, s) =>
          !path.startsWith("/src/features/staff-management/") &&
          path !== "/src/app/router.tsx" &&
          /@\/features\/staff-management\//.test(s)
      )
    ).toEqual([])
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

  it("components call writes through the dedicated write modules only (no inline apiRequest outside writes/ and auth)", () => {
    const writers = offenders(
      (path, s) =>
        !path.startsWith("/src/lib/api/client") &&
        !path.startsWith("/src/lib/api/writes/") &&
        !path.startsWith("/src/features/auth/") &&
        !path.startsWith("/src/lib/api/auth") &&
        /apiRequest\w*(<[^>]*>)?\(\s*["'](POST|PUT|PATCH|DELETE)["']/.test(s)
    )
    expect(writers).toEqual([])
  })

  it("the plan is never a client decision: nothing persists or reads it outside the server (`/auth/me`)", () => {
    expect(offenders((_, s) => /@\/state\/(residentStore|planStore)/.test(s))).toEqual([])
    expect(offenders((_, s) => /usePlanStore|useResidentStore/.test(s))).toEqual([])
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

  it("no simulated contact action exists: no helper, no 'simulated' toast copy, no invented contact CTA", () => {
    expect(production.find(([path]) => path === "/src/lib/simulatedActions.ts")).toBeUndefined()
    expect(offenders((_, s) => /simulatedActions|SIMULATED_MESSAGES/.test(s))).toEqual([])
    expect(offenders((_, s) => /simulated for this demo|Full request\/contact flow is available/i.test(s))).toEqual([])
    // A control whose text is a WhatsApp / contact CTA is a FAKE action anywhere except the one real
    // implementation: `ContactActions` renders Call / WhatsApp for a listing's OWN stored numbers
    // (Listing Contact v1), and only when `@/lib/phone` could build a link from them.
    const REAL_CONTACT_ACTION = "/src/components/detail/ContactActions.tsx"
    expect(
      offenders(
        (path, s) =>
          path !== REAL_CONTACT_ACTION &&
          />\s*(Chat on WhatsApp|Contact on WhatsApp|WhatsApp|Contact Business|Contact Agent|Contact)\s*</.test(s)
      )
    ).toEqual([])
    expect(production.find(([path]) => path === REAL_CONTACT_ACTION)).toBeDefined()
  })

  it("a tel: or wa.me link is built from a stored number in one place only", () => {
    // The same rule the Google directions link follows: one builder, so no caller can put raw user
    // input into a dialable or messageable URL (`@/lib/phone` returns null for anything that is not
    // canonical E.164, which makes a dead button unrenderable rather than wrong).
    expect(offenders((path, s) => path !== "/src/lib/phone.ts" && /["'`]tel:|wa\.me/.test(s))).toEqual([])
  })

  it("the browser API base is relative (same-origin): nothing in src names the API's own port", () => {
    expect(offenders((_, s) => /(127\.0\.0\.1|localhost):8000/.test(s))).toEqual([])
  })

  it("the Google directions link is built from numbers in one place only", () => {
    expect(offenders((path, s) => path !== "/src/components/location/directions.ts" && /google\.com\/maps/.test(s))).toEqual([])
  })
})
