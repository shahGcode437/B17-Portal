import { describe, expect, it } from "vitest"
import { toOwnerListing } from "@/lib/api/ownerAdapters"
import type { OwnerListingDto } from "@/lib/api/dto/private"

/**
 * The owner API echoes the WRITE vocabulary in `category` / `propertyType` (the category SLUGS), so a form can
 * round-trip them; the human name is `categoryLabel` / `categories[].name`. A screen shows the name, never the
 * slug (Phase 12S, S4): these DTOs have the real shape, which the old fixtures did not (they carried labels in
 * those fields, which is why the bug never showed in a mock test).
 */
const common = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "pending" as const,
  revision: 1,
  area: "B-17",
  description: "A description that is long enough to be valid.",
  tags: [],
  location: { visibility: "area_only" as const },
  publicLocation: { visibility: "area_only" as const },
  submittedAt: "2026-10-26T10:00:00Z",
  createdAt: "2026-10-26T10:00:00Z",
  updatedAt: "2026-10-26T10:00:00Z",
}

describe("toOwnerListing: the category line is the human name, never a slug", () => {
  it("a General business shows 'Pharmacy', not 'pharmacy'", () => {
    const view = toOwnerListing({
      ...common,
      kind: "business",
      name: "B-17 Family Pharmacy",
      vertical: "general",
      category: "pharmacy",
      categoryLabel: "Pharmacy",
      categories: [{ slug: "pharmacy", name: "Pharmacy", isPrimary: true }],
    } as OwnerListingDto)
    expect(view.categoryLabel).toBe("Pharmacy")
    expect(view.categorySlug).toBe("pharmacy") // the slug stays available to the form, as an identifier
  })

  it("a Property shows 'Flat · For Rent', not 'flat · For Rent'", () => {
    const view = toOwnerListing({
      ...common,
      kind: "property",
      title: "2 bed flat",
      listingType: "rent",
      propertyType: "flat",
      price: "PKR 65,000 / month",
      categoryLabel: "Flat",
      categories: [{ slug: "flat", name: "Flat", isPrimary: true }],
    } as OwnerListingDto)
    expect(view.categoryLabel).toBe("Flat · For Rent")
    expect(view.categorySlug).toBe("flat")
  })

  it("a multi-word taxonomy name keeps its real spelling and punctuation", () => {
    const view = toOwnerListing({
      ...common,
      kind: "business",
      name: "Sweet Spot",
      vertical: "food",
      categoryLabel: "Sweets / Desserts",
      categories: [
        { slug: "sweets-desserts", name: "Sweets / Desserts", isPrimary: true },
        { slug: "bakeries", name: "Bakeries", isPrimary: false },
      ],
      food: { categories: ["sweets-desserts", "bakeries"], serviceOptions: ["takeaway"] },
    } as unknown as OwnerListingDto)
    expect(view.categoryLabel).toBe("Sweets / Desserts, Bakeries")
  })

  it("Provider and Tutor keep their label, and the tutor's grade", () => {
    const provider = toOwnerListing({ ...common, kind: "provider", name: "Sunrise", category: "solar", categoryLabel: "Solar", categories: [{ slug: "solar", name: "Solar", isPrimary: true }] } as OwnerListingDto)
    expect(provider.categoryLabel).toBe("Solar")
    const tutor = toOwnerListing({ ...common, kind: "tutor", name: "Ali", category: "physics", categoryLabel: "Physics", grade: "Grade 9", categories: [{ slug: "physics", name: "Physics", isPrimary: true }] } as OwnerListingDto)
    expect(tutor.categoryLabel).toBe("Physics · Grade 9")
  })

  it("no kind ever puts a lower-case slug on the screen", () => {
    const slugLike = /^[a-z0-9]+(-[a-z0-9]+)+$|^[a-z0-9]+ · /
    const views = [
      toOwnerListing({ ...common, kind: "business", name: "x", vertical: "general", category: "hairdressing", categoryLabel: "Hairdressing", categories: [{ slug: "hairdressing", name: "Hairdressing", isPrimary: true }] } as OwnerListingDto),
      toOwnerListing({ ...common, kind: "property", title: "x", listingType: "sale", propertyType: "plot", price: "p", categoryLabel: "Plot", categories: [{ slug: "plot", name: "Plot", isPrimary: true }] } as OwnerListingDto),
    ]
    for (const view of views) expect(view.categoryLabel).not.toMatch(slugLike)
  })
})
