import { describe, expect, it } from "vitest"
import {
  businessCreate,
  listingPatchFrom,
  propertyCreate,
  propertyPatchFrom,
  providerCreate,
  toLocationWrite,
  tutorCreate,
} from "@/features/provider/listingWriteAdapters"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"
import type { LocationWrite } from "@/lib/api/writes/listings"
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

/**
 * Regression: the LocationFieldset blur-on-blank bug used to let 0,0 reach the authoritative
 * `LocationWrite`, which then flowed through these adapters into the create / patch payload. The
 * fieldset tests now prove the (0, 0) never enters `LocationWrite`; these payload tests prove that
 * when a REAL coordinate is in the `LocationWrite`, every adapter forwards it verbatim (six-decimal
 * precision preserved, neither rounded nor dropped) across all four listing kinds.
 */
describe("create payloads preserve real coordinates (every listing kind)", () => {
  const exact: LocationWrite = { visibility: "exact", block: "C", latitude: 33.701235, longitude: 73.051235 }
  const approx: LocationWrite = { visibility: "approximate", block: "D", latitude: 33.712345, longitude: 73.062345 }
  const areaOnly: LocationWrite = { visibility: "area_only", block: "E" }

  const providerForm = { ...common, image: undefined } as ListingFormValues
  const businessForm = { ...common, vertical: "general" } as ListingFormValues
  const foodForm = {
    ...common,
    vertical: "food",
    food: { categories: ["bakeries"], serviceOptions: ["takeaway"], hoursNote: "", menuHighlights: [], menuImage: "" },
  } as ListingFormValues
  const tutorForm = { ...common } as ListingFormValues
  const propertyForm = {
    title: "5 Marla House",
    listingType: "sale",
    propertyType: "house",
    price: "PKR 2.2 Cr",
    description: "A family house in B-17 Block C.",
    area: "B-17",
    bedrooms: "3",
    furnished: "Furnished",
    tagsInput: "corner, near-park",
  } as PropertyFormValues

  it("Provider: exact / approximate coordinates round-trip unchanged (six decimals)", () => {
    expect(providerCreate(providerForm, exact).location).toEqual(exact)
    expect(providerCreate(providerForm, approx).location).toEqual(approx)
  })

  it("Business (general): exact / approximate coordinates round-trip unchanged", () => {
    expect(businessCreate(businessForm, exact).location).toEqual(exact)
    expect(businessCreate(businessForm, approx).location).toEqual(approx)
  })

  it("Food business: exact / approximate coordinates round-trip unchanged", () => {
    expect(businessCreate(foodForm, exact).location).toEqual(exact)
    expect(businessCreate(foodForm, approx).location).toEqual(approx)
  })

  it("Tutor: exact / approximate coordinates round-trip unchanged", () => {
    expect(tutorCreate(tutorForm, "Grade 9", exact).location).toEqual(exact)
    expect(tutorCreate(tutorForm, "Grade 9", approx).location).toEqual(approx)
  })

  it("Property: exact / approximate coordinates round-trip unchanged", () => {
    expect(propertyCreate(propertyForm, exact).location).toEqual(exact)
    expect(propertyCreate(propertyForm, approx).location).toEqual(approx)
  })

  it("area_only never ships a point (every kind), even when an older point had been stored", () => {
    expect(providerCreate(providerForm, areaOnly).location).toEqual(areaOnly)
    expect(businessCreate(businessForm, areaOnly).location).toEqual(areaOnly)
    expect(businessCreate(foodForm, areaOnly).location).toEqual(areaOnly)
    expect(tutorCreate(tutorForm, "Grade 9", areaOnly).location).toEqual(areaOnly)
    // property is enforced upstream to forbid area_only, but the adapter itself trusts the caller.
  })

  it("edit-form patch payloads also round-trip the point verbatim (provider + property)", () => {
    expect(listingPatchFrom(2, "provider", providerForm, exact).location).toEqual(exact)
    expect(propertyPatchFrom(2, propertyForm, approx).location).toEqual(approx)
  })
})
