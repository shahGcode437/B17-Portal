import { describe, expect, it } from "vitest"
import {
  FOOD_CATEGORIES,
  FOOD_SERVICE_OPTIONS,
  MAX_FOOD_CATEGORIES,
  MAX_MENU_HIGHLIGHTS,
  deriveFoodCategory,
  foodCategoryLabel,
  foodServiceLabel,
  isFoodCategory,
  isFoodServiceOption,
} from "@/config/food"

describe("Food taxonomy (config, never free text)", () => {
  it("derives Business.category from the PRIMARY (first) Food category label", () => {
    expect(deriveFoodCategory(["bakeries"])).toBe("Bakeries")
    expect(deriveFoodCategory(["sweets-desserts", "bakeries"])).toBe("Sweets / Desserts")
    expect(deriveFoodCategory(["bakeries", "sweets-desserts"])).toBe("Bakeries")
  })

  it("derives an empty label when no category is chosen", () => {
    expect(deriveFoodCategory([])).toBe("")
  })

  it("recognises only canonical category slugs and service options", () => {
    expect(isFoodCategory("biryani-rice")).toBe(true)
    expect(isFoodCategory("Biryani / Rice")).toBe(false)
    expect(isFoodCategory("sushi")).toBe(false)
    expect(isFoodServiceOption("delivery")).toBe(true)
    expect(isFoodServiceOption("curbside")).toBe(false)
  })

  it("keeps labels config-driven and describes delivery as the business's own", () => {
    expect(foodCategoryLabel("tea-snacks")).toBe("Tea / Snacks")
    expect(foodServiceLabel("delivery")).toBe("Delivery by the business")
  })

  it("exposes every category with a unique slug and the frozen limits", () => {
    const slugs = FOOD_CATEGORIES.map((category) => category.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(FOOD_CATEGORIES).toHaveLength(11)
    expect(FOOD_SERVICE_OPTIONS.map((option) => option.value)).toEqual(["dine-in", "takeaway", "delivery"])
    expect(MAX_FOOD_CATEGORIES).toBe(3)
    expect(MAX_MENU_HIGHLIGHTS).toBe(8)
  })
})
