import { describe, expect, it } from "vitest"
import { listingPatchFrom, toLocationWrite } from "@/features/provider/listingWriteAdapters"
import type { ListingFormValues } from "@/features/provider/listingSchema"
import type { OwnerListingView } from "@/types/ownerListing"

const listing = (location: OwnerListingView["location"]): OwnerListingView => ({ location }) as OwnerListingView

describe("toLocationWrite (the edit form's starting location)", () => {
  it("keeps address and landmark for exact", () => {
    expect(toLocationWrite(listing({ visibility: "exact", block: "C", address: "Shop 4", landmark: "Park", latitude: 33.7, longitude: 73.05 }))).toEqual({
      visibility: "exact",
      block: "C",
      address: "Shop 4",
      landmark: "Park",
      latitude: 33.7,
      longitude: 73.05,
    })
  })

  it("keeps a PRIVATE address and landmark for approximate (dropping them would make an edit a content change)", () => {
    expect(toLocationWrite(listing({ visibility: "approximate", block: "D", address: "House 12", landmark: "Mosque", latitude: 33.71, longitude: 73.06 }))).toEqual({
      visibility: "approximate",
      block: "D",
      address: "House 12",
      landmark: "Mosque",
      latitude: 33.71,
      longitude: 73.06,
    })
  })

  it("keeps a private address for area_only but never a point", () => {
    expect(toLocationWrite(listing({ visibility: "area_only", block: "E", address: "House 3", latitude: 33.7, longitude: 73.05 }))).toEqual({
      visibility: "area_only",
      block: "E",
      address: "House 3",
    })
  })
})

const common = {
  name: "Capital Stationers",
  category: "stationery",
  description: "Books, copies and office supplies for B-17.",
  area: "B-17",
  tagsInput: "books, copies",
} as const
const location = { visibility: "area_only" as const }

describe("listingPatchFrom (what an edit sends)", () => {
  it("a General business sends NO food block (food: null is not_nullable, a Food block is not_allowed on it)", () => {
    const patch = listingPatchFrom(3, "business", { ...common, vertical: "general" } as ListingFormValues, location)
    expect(patch).not.toHaveProperty("food")
    expect(patch).toMatchObject({ revision: 3, vertical: "general", category: "stationery", area: "B-17", tags: ["books", "copies"] })
  })

  it("a Food business sends its food block, and what the owner emptied is CLEARED (hoursNote / menuImage null, menu [])", () => {
    const emptied = listingPatchFrom(
      2,
      "business",
      { ...common, vertical: "food", food: { categories: ["bakeries"], serviceOptions: ["takeaway"], hoursNote: "", menuHighlights: [], menuImage: "" } } as ListingFormValues,
      location
    )
    expect(emptied).toMatchObject({ vertical: "food", food: { categories: ["bakeries"], serviceOptions: ["takeaway"], hoursNote: null, menuImage: null, menuHighlights: [] } })
    expect(emptied).not.toHaveProperty("category")

    const kept = listingPatchFrom(
      2,
      "business",
      {
        ...common,
        vertical: "food",
        food: { categories: ["bakeries"], serviceOptions: [], hoursNote: "10am-9pm", menuHighlights: [{ name: "Cake", section: "", description: "", price: "PKR 900" }], menuImage: "https://cdn.example.com/menu.jpg" },
      } as ListingFormValues,
      location
    )
    expect(kept.food).toMatchObject({ hoursNote: "10am-9pm", menuImage: "https://cdn.example.com/menu.jpg", menuHighlights: [{ name: "Cake", price: "PKR 900" }] })
  })

  it("never sends null for anything the API cannot clear (only image is nullable on a non-property edit)", () => {
    const patch = listingPatchFrom(1, "provider", { ...common } as ListingFormValues, location)
    const nulls = Object.entries(patch).filter(([, value]) => value === null).map(([key]) => key)
    expect(nulls.every((key) => ["image", "bedrooms", "furnished"].includes(key))).toBe(true)
  })

  it("a stored image is sent back unchanged; with none the image is cleared (null), never dropped silently", () => {
    expect(listingPatchFrom(1, "provider", { ...common, image: "https://cdn.example.com/a.jpg" } as ListingFormValues, location).image).toBe("https://cdn.example.com/a.jpg")
    expect(listingPatchFrom(1, "provider", { ...common } as ListingFormValues, location).image).toBeNull()
    expect(listingPatchFrom(1, "provider", { ...common, image: "blob:http://localhost/x" } as ListingFormValues, location).image).toBeNull()
  })
})
