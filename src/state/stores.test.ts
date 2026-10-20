import { beforeEach, describe, expect, it } from "vitest"
import { useResidentStore } from "@/state/residentStore"
import { businessCategoryLabel, businessTypeIcon, businessTypeLabel } from "@/features/provider/listingDisplay"
import type { Business } from "@/types/business"

beforeEach(() => {
  useResidentStore.setState({ savedItems: [], requests: [] })
})

describe("Saved items (residentStore)", () => {
  it("toggles a saved business by reference — kind, id and a timestamp only — and unsaves it", () => {
    const { toggleSaved } = useResidentStore.getState()
    toggleSaved("business", "business-08")
    expect(useResidentStore.getState().savedItems).toEqual([{ kind: "business", id: "business-08", savedAt: expect.any(String) }])
    toggleSaved("business", "business-08")
    expect(useResidentStore.getState().savedItems).toEqual([])
  })

  it("distinguishes the same id under different kinds", () => {
    const { toggleSaved } = useResidentStore.getState()
    toggleSaved("business", "x1")
    toggleSaved("provider", "x1")
    expect(useResidentStore.getState().savedItems).toHaveLength(2)
  })
})

describe("listing display helpers", () => {
  const food: Business = {
    id: "f1",
    name: "Cafe",
    vertical: "food",
    category: "Cafes",
    description: "x",
    area: "B-17",
    tags: [],
    food: { categories: ["cafes", "tea-snacks"], serviceOptions: ["dine-in"] },
  }
  const general: Business = { id: "g1", name: "Shop", vertical: "general", category: "Grocery", description: "x", area: "B-17", tags: [] }

  it("labels a Food business as Food & Dining and lists primary then secondary categories", () => {
    expect(businessTypeLabel(food, "Business / Shop")).toBe("Food & Dining")
    expect(businessCategoryLabel(food)).toBe("Cafes, Tea / Snacks")
  })

  it("leaves a General business unchanged", () => {
    expect(businessTypeLabel(general, "Business / Shop")).toBe("Business / Shop")
    expect(businessCategoryLabel(general)).toBe("Grocery")
    expect(businessTypeIcon(general)).not.toBe(businessTypeIcon(food))
  })
})
