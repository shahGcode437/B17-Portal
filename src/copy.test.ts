import { describe, expect, it } from "vitest"

/**
 * Copy guards (Phase 12S, S4). A screen must never tell a person that something is "coming soon" when it already
 * works, and a button that submits must never be called a preview. The guard reads the source text of every
 * production module (comments removed: prose that names what it avoids is not copy) and fails on a forbidden
 * phrase unless the file is on the allowlist below, where each entry is a feature that is GENUINELY deferred.
 *
 * Adding to the allowlist is a product decision, not a convenience: write why next to the entry.
 */
const modules = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const production = Object.entries(modules)
  .filter(([path]) => !/\.test\.(ts|tsx)$/.test(path) && !path.startsWith("/src/test/"))
  .map(([path, source]): [string, string] => [path, stripComments(source)])

/** Phrases that say a feature is unfinished. */
const UNFINISHED = /coming soon|is coming\b|not available yet|isn't available yet|is still being built|\bprototype\b|simulated/i

/** Files where such a phrase is TRUE today, and why. */
const GENUINELY_DEFERRED: Record<string, string> = {
  "/src/features/future-modules/ComingSoonPage.tsx": "the page for Marketplace, Pharmacy, Pick & Drop, Community and the Vault (outside Production V1)",
  "/src/features/home/sections/FutureModules.tsx": "the Home teaser for those same future modules",
  "/src/components/navigation/Footer.tsx": "the 'Coming Soon' footer column for them, and the product-level 'early prototype' disclaimer",
  "/src/seo/routeSeo.ts": "the page title of that future-modules page",
  "/src/data/site.ts": "the site's own description ('a prototype hyperlocal ecosystem')",
  "/src/features/admin/NewsAdminSoon.tsx": "news administration: the backend has no news write API",
  "/src/features/admin/ContentListPage.tsx": "news administration (no write API)",
  "/src/features/admin/ContentFormPage.tsx": "news administration (no write API)",
  "/src/features/provider/ListingImageInput.tsx": "image upload: media storage is Phase 13",
}

describe("copy guards", () => {
  it("has production modules to scan (the glob works)", () => {
    expect(production.length).toBeGreaterThan(200)
  })

  it("no screen says a feature that already works is 'coming soon', unfinished or simulated", () => {
    const offenders = production
      .filter(([path, source]) => UNFINISHED.test(source) && !(path in GENUINELY_DEFERRED))
      .map(([path, source]) => `${path}: "${source.match(UNFINISHED)![0]}"`)
    expect(offenders).toEqual([])
  })

  it("every allowlisted file still contains such a phrase (an entry that no longer applies must be removed)", () => {
    const stale = Object.keys(GENUINELY_DEFERRED).filter((path) => {
      const source = production.find(([candidate]) => candidate === path)?.[1]
      return source === undefined || !UNFINISHED.test(source)
    })
    expect(stale).toEqual([])
  })

  it("the stale lines S4 removed stay removed", () => {
    const all = production.map(([, source]) => source).join("\n")
    for (const gone of [
      "Sending requests is coming soon",
      "saving items is coming soon",
      "Approving and rejecting from here is coming soon",
      "Creating a listing is coming soon",
      "Creating listings is coming soon",
      "prototype preview only",
      "you can upgrade later", // there is no billing in V1: the Professional prompt must not promise one
    ]) {
      expect(all, gone).not.toContain(gone)
    }
  })

  it("a button that submits a listing is never labelled 'Preview'", () => {
    expect(production.filter(([, source]) => /Preview Listing/.test(source)).map(([path]) => path)).toEqual([])
  })

  it("the listing forms no longer suggest a free-text area or a demo address", () => {
    // (The Service Request form's own area is the REQUESTER's free text, by contract: it keeps its example.)
    const forms = production.filter(([path]) => path.startsWith("/src/features/provider/")).map(([, source]) => source).join("\n")
    expect(forms).not.toContain("e.g. B-17, Block C")
    expect(forms).not.toContain("Demo Plaza")
  })
})
