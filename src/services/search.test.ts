import { beforeEach, describe, expect, it } from "vitest"
import { getSearchSuggestions, searchAll, MIN_SUGGESTION_QUERY_LENGTH } from "@/services/search"
import { useListingsStore } from "@/state/listingsStore"
import type { Business } from "@/types/business"
import type { SearchHit } from "@/types/search"

// The real seed data is the fixture (fictional demo businesses); only the approved-listing store is reset per test.
beforeEach(() => {
  useListingsStore.setState({ listings: [] })
})

const names = (hits: SearchHit[]) =>
  hits.map((hit) => ("name" in hit.item ? hit.item.name : "title" in hit.item ? hit.item.title : ""))
const businesses = (hits: SearchHit[]): Business[] =>
  hits.flatMap((hit) => (hit.kind === "business" ? [hit.item] : []))

describe("searchAll — scope and filters", () => {
  it("returns everything for an empty query and honours the type scope", () => {
    expect(searchAll("").length).toBeGreaterThan(searchAll("", "business").length)
    expect(searchAll("", "business").every((hit) => hit.kind === "business")).toBe(true)
    expect(searchAll("", "news").every((hit) => hit.kind === "news")).toBe(true)
  })

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(names(searchAll("  KARAHI  "))).toContain("Karahi Junction")
  })

  it("keeps Food and General businesses apart through the vertical filter", () => {
    const food = businesses(searchAll("", "business", { vertical: "food" }))
    const general = businesses(searchAll("", "business", { vertical: "general" }))
    expect(food.length).toBeGreaterThan(0)
    expect(general.length).toBeGreaterThan(0)
    expect(food.every((b) => b.vertical === "food" && b.food)).toBe(true)
    expect(general.every((b) => b.vertical === "general" && !b.food)).toBe(true)
  })

  it("does not leak Food businesses into a General query even when the text overlaps", () => {
    expect(names(searchAll("Karahi", "business", { vertical: "general" }))).toEqual([])
    expect(names(searchAll("Karahi", "business", { vertical: "food" }))).toEqual(["Karahi Junction"])
  })

  it("filters by Food category (primary OR secondary) and by service option", () => {
    const bakeries = names(searchAll("", "business", { vertical: "food", foodCategory: "bakeries" }))
    expect(bakeries).toEqual(expect.arrayContaining(["Capital Bakers", "Mithai Mahal"]))
    const delivery = businesses(searchAll("", "business", { vertical: "food", service: "delivery" }))
    expect(delivery.length).toBeGreaterThan(0)
    expect(delivery.every((b) => b.food?.serviceOptions.includes("delivery"))).toBe(true)
  })

  it("combines Food category + service (bakeries that deliver) and a menu-item query", () => {
    const both = names(searchAll("", "business", { vertical: "food", foodCategory: "bakeries", service: "delivery" }))
    expect(both).toEqual(expect.arrayContaining(["Capital Bakers", "Mithai Mahal"]))
    expect(names(searchAll("Garlic Naan", "business", { vertical: "food" }))).toEqual(["Karahi Junction"])
  })

  it("never matches a Food-only filter against a business without a Food profile", () => {
    expect(searchAll("", "business", { vertical: "general", foodCategory: "bakeries" })).toEqual([])
  })

  it("returns no results (not an error) for a query nothing matches", () => {
    expect(searchAll("zzzqqq-no-such-thing")).toEqual([])
  })

  it("only makes APPROVED user listings searchable", () => {
    const listing = (status: "pending" | "approved") => ({
      id: `l-${status}`,
      kind: "business" as const,
      status,
      submittedAt: "2026-10-01T00:00:00.000Z",
      submittedBy: "Tester",
      data: { id: `l-${status}`, name: `Zebra Cafe ${status}`, vertical: "general" as const, category: "Cafe", description: "x", area: "B-17", tags: [] },
    })
    useListingsStore.setState({ listings: [listing("pending"), listing("approved")] })
    expect(names(searchAll("Zebra Cafe"))).toEqual(["Zebra Cafe approved"])
  })
})

describe("getSearchSuggestions — ranking and grounding", () => {
  it("returns nothing below the minimum query length", () => {
    expect(MIN_SUGGESTION_QUERY_LENGTH).toBe(2)
    expect(getSearchSuggestions("b")).toEqual([])
    expect(getSearchSuggestions("  ")).toEqual([])
  })

  it("ranks exact → starts-with → word-prefix, then shorter label first", () => {
    const labels = getSearchSuggestions("biryani").map((s) => s.label)
    expect(labels[0]).toBe("Biryani") // exact
    const startsWith = labels.filter((l) => l.toLowerCase().startsWith("biryani") && l !== "Biryani")
    expect(startsWith.length).toBeGreaterThan(0)
    expect(labels).toContain("Chicken Biryani") // word-prefix
    expect(labels.indexOf(startsWith[startsWith.length - 1])).toBeLessThan(labels.indexOf("Chicken Biryani"))
    expect(startsWith).toEqual([...startsWith].sort((a, b) => a.length - b.length || a.localeCompare(b)))
  })

  it("ranks a contains-only match after prefix matches", () => {
    const labels = getSearchSuggestions("ryani").map((s) => s.label)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every((l) => l.toLowerCase().includes("ryani"))).toBe(true)
  })

  it("scopes suggestions to the chosen type and caps the list", () => {
    expect(getSearchSuggestions("ar", "property").every((s) => s.type === "property")).toBe(true)
    expect(getSearchSuggestions("ar", "all", 3).length).toBeLessThanOrEqual(3)
  })

  it("only suggests what search can actually find (selecting one always yields a result)", () => {
    const suggestions = getSearchSuggestions("ba")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) {
      expect(searchAll(suggestion.value, suggestion.type).length).toBeGreaterThan(0)
    }
  })

  it("includes Food category labels and menu-item names as suggestions", () => {
    expect(getSearchSuggestions("desi").map((s) => s.label)).toContain("Desi Food")
    expect(getSearchSuggestions("garlic").map((s) => s.label)).toContain("Garlic Naan")
  })
})
