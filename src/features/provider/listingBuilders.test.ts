import { describe, expect, it } from "vitest"
import {
  buildBusiness,
  buildFoodProfile,
  buildProperty,
  buildProvider,
  emptyFoodFormValues,
  foodProfileToFormValues,
} from "@/features/provider/listingBuilders"
import type { FoodFormValues, ListingFormValues } from "@/features/provider/listingSchema"

const base = {
  name: "Sweet Crumbs Bakery",
  category: "ignored for Food",
  description: "Fresh cakes and bread baked every morning.",
  area: "B-17, Block B",
  tagsInput: "Cakes, Bread",
  image: undefined,
}

const food: FoodFormValues = {
  categories: ["sweets-desserts", "bakeries"],
  serviceOptions: ["delivery", "takeaway"],
  hoursNote: "Daily, 8 AM–10 PM",
  menuHighlights: [
    { name: "Fudge Cake", section: "Cakes", description: "Made fresh.", price: "PKR 1,800" },
    { name: "Naan", section: "", description: "", price: "" },
  ],
  menuImage: "blob:menu",
}

describe("buildBusiness", () => {
  it("builds a General business exactly as before: vertical general, typed category, no food key", () => {
    const business = buildBusiness({ ...base, category: "Stationery", vertical: "general" } as ListingFormValues, "id-1")
    expect(business).toMatchObject({ id: "id-1", vertical: "general", category: "Stationery", tags: ["cakes", "bread"] })
    expect("food" in business).toBe(false)
  })

  it("treats a missing vertical as General (the pre-Food form shape)", () => {
    expect(buildBusiness({ ...base, category: "Salon" } as ListingFormValues, "id-2").vertical).toBe("general")
  })

  it("builds a Food business whose category is DERIVED from the primary Food category", () => {
    const business = buildBusiness({ ...base, vertical: "food", food } as ListingFormValues, "id-3")
    expect(business.vertical).toBe("food")
    expect(business.category).toBe("Sweets / Desserts")
    expect(business.food?.categories).toEqual(["sweets-desserts", "bakeries"])
  })

  it("re-derives the category when the primary changes (edit → resubmit)", () => {
    const reordered = { ...food, categories: ["bakeries", "sweets-desserts"] } as FoodFormValues
    expect(buildBusiness({ ...base, vertical: "food", food: reordered } as ListingFormValues, "id-3").category).toBe("Bakeries")
  })
})

describe("buildFoodProfile", () => {
  it("stores service options in canonical order regardless of click order", () => {
    expect(buildFoodProfile(food, "x").serviceOptions).toEqual(["takeaway", "delivery"])
  })

  it("keeps category order (the first is the primary category)", () => {
    expect(buildFoodProfile(food, "x").categories).toEqual(["sweets-desserts", "bakeries"])
  })

  it("normalises blanks to omitted and gives menu rows stable ids", () => {
    const profile = buildFoodProfile({ ...food, hoursNote: "" }, "listing-9")
    expect(profile.hoursNote).toBeUndefined()
    expect(profile.menuHighlights?.map((row) => row.id)).toEqual(["listing-9-mh-1", "listing-9-mh-2"])
    expect(profile.menuHighlights?.[1]).toMatchObject({ name: "Naan", section: undefined, description: undefined, price: undefined })
    expect(buildFoodProfile({ ...food, menuHighlights: [] }, "x").menuHighlights).toBeUndefined()
  })

  it("carries the menu image through", () => {
    expect(buildFoodProfile(food, "x").menuImage).toBe("blob:menu")
  })
})

describe("FoodProfile ↔ form values (edit prefill)", () => {
  it("round-trips without losing any field", () => {
    const profile = buildFoodProfile(food, "listing-1")
    const form = foodProfileToFormValues(profile)
    expect(form.categories).toEqual(["sweets-desserts", "bakeries"])
    expect(form.serviceOptions).toEqual(["takeaway", "delivery"])
    expect(form.hoursNote).toBe("Daily, 8 AM–10 PM")
    expect(form.menuHighlights).toEqual([
      { name: "Fudge Cake", section: "Cakes", description: "Made fresh.", price: "PKR 1,800" },
      { name: "Naan", section: "", description: "", price: "" },
    ])
    expect(form.menuImage).toBe("blob:menu")
    expect(buildFoodProfile(form, "listing-1")).toEqual(profile)
  })

  it("prefills a minimal profile with empty (not undefined) text fields", () => {
    const form = foodProfileToFormValues({ categories: ["cafes"], serviceOptions: ["dine-in"] })
    expect(form).toMatchObject({ hoursNote: "", menuHighlights: [], menuImage: undefined })
  })

  it("starts a new Food block empty", () => {
    expect(emptyFoodFormValues()).toEqual({ categories: [], serviceOptions: [], hoursNote: "", menuHighlights: [], menuImage: undefined })
  })
})

describe("buildProvider / buildProperty", () => {
  it("maps a Service category slug to its label", () => {
    const provider = buildProvider({ ...base, category: "solar" } as ListingFormValues, "p-1")
    expect(provider.category).toBe("solar")
    expect(provider.categoryLabel.length).toBeGreaterThan(0)
  })

  it("builds a Property with numeric bedrooms and parsed tags, omitting blanks", () => {
    const property = buildProperty(
      { title: "Flat", listingType: "rent", propertyType: "Flat", price: "PKR 80k", area: "B-17", description: "Nice flat.", bedrooms: "2", furnished: "Furnished", tagsInput: "Balcony, Lift", image: undefined },
      "pr-1"
    )
    expect(property).toMatchObject({ listingType: "rent", bedrooms: 2, furnished: "Furnished", tags: ["balcony", "lift"] })
    const bare = buildProperty({ title: "Plot", listingType: "sale", propertyType: "Plot", price: "PKR 1 Cr", area: "B-17", description: "Corner plot.", bedrooms: "", furnished: "", tagsInput: "" }, "pr-2")
    expect(bare.bedrooms).toBeUndefined()
    expect(bare.furnished).toBeUndefined()
    expect(bare.tags).toEqual([])
  })
})
