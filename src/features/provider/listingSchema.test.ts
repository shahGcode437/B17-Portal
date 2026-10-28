import { describe, expect, it } from "vitest"
import {
  AREA_MESSAGE,
  foodFormSchema,
  listingSchema,
  parseTags,
  propertySchema,
  tagsProblem,
  validateFoodFields,
  type FoodFormValues,
} from "@/features/provider/listingSchema"
import { MAX_TAGS, MAX_TAG_LENGTH } from "@/config/listingLimits"

const validListing = {
  name: "Capital Stationers",
  category: "Stationery",
  description: "Office and school stationery, printing and photocopying.",
  area: "B-17",
  tagsInput: "stationery, printing",
}

const validFood: FoodFormValues = {
  categories: ["bakeries"],
  serviceOptions: ["takeaway"],
  hoursNote: "",
  menuHighlights: [],
  menuImage: undefined,
}

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join("."))
}

describe("listingSchema (General Business / Service)", () => {
  it("accepts a complete General listing", () => {
    expect(listingSchema.safeParse(validListing).success).toBe(true)
  })

  it("requires a category for a General business and for a Service", () => {
    expect(issuePaths(listingSchema.safeParse({ ...validListing, category: "  " }))).toContain("category")
    expect(issuePaths(listingSchema.safeParse({ ...validListing, category: "", vertical: "general" }))).toContain("category")
  })

  it("does NOT require a typed category for Food (it is derived from the primary Food category)", () => {
    expect(listingSchema.safeParse({ ...validListing, category: "", vertical: "food" }).success).toBe(true)
  })

  it("keeps the shared field rules: name, description length, area", () => {
    const paths = issuePaths(listingSchema.safeParse({ ...validListing, name: "A", description: "too short", area: "" }))
    expect(paths).toEqual(expect.arrayContaining(["name", "description", "area"]))
    expect(issuePaths(listingSchema.safeParse({ ...validListing, description: "x".repeat(401) }))).toContain("description")
  })

  describe("area is a configured locality, never free text (S4)", () => {
    it("accepts B-17, in any casing or spacing the server also accepts", () => {
      for (const area of ["B-17", "b-17", "  B-17  "]) expect(listingSchema.safeParse({ ...validListing, area }).success, area).toBe(true)
    })

    it("refuses anything else: a city, a block inside the area, a street, empty", () => {
      for (const area of ["Islamabad", "B-17 Block C", "B-17, Block A", "B 17", "G-11", ""]) {
        const result = listingSchema.safeParse({ ...validListing, area })
        expect(result.success, area).toBe(false)
        expect(issuePaths(result), area).toContain("area")
      }
    })

    it("says what to do instead", () => {
      const result = listingSchema.safeParse({ ...validListing, area: "Islamabad" })
      const message = result.success ? "" : result.error.issues.find((issue) => issue.path[0] === "area")?.message
      expect(message).toBe(AREA_MESSAGE)
      expect(AREA_MESSAGE).toMatch(/B-17/)
      expect(AREA_MESSAGE).toMatch(/Block field/)
    })
  })

  describe("tags are optional and bounded exactly like the API (S4)", () => {
    const tagsOf = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`).join(", ")

    it("are not required: the API's tags default to none", () => {
      expect(listingSchema.safeParse({ ...validListing, tagsInput: "" }).success).toBe(true)
      expect(listingSchema.safeParse({ ...validListing, tagsInput: undefined }).success).toBe(true)
    })

    it("allow exactly 20 tags and refuse the 21st, naming how many to remove", () => {
      expect(listingSchema.safeParse({ ...validListing, tagsInput: tagsOf(MAX_TAGS) }).success).toBe(true)
      const result = listingSchema.safeParse({ ...validListing, tagsInput: tagsOf(MAX_TAGS + 1) })
      expect(result.success).toBe(false)
      expect(issuePaths(result)).toContain("tagsInput")
      expect(tagsProblem(tagsOf(MAX_TAGS + 3))).toBe("You can add up to 20 tags. Remove 3 to continue.")
    })

    it("count tags the way the server will: blanks, repeats and casing do not add to the count", () => {
      const noisy = `${tagsOf(MAX_TAGS)}, , TAG0, Tag1,  tag2 ,`
      expect(parseTags(noisy)).toHaveLength(MAX_TAGS)
      expect(tagsProblem(noisy)).toBeNull()
    })

    it("allow 40 characters per tag and refuse 41", () => {
      expect(tagsProblem("x".repeat(MAX_TAG_LENGTH))).toBeNull()
      expect(tagsProblem(`ok, ${"x".repeat(MAX_TAG_LENGTH + 1)}`)).toMatch(/up to 40 characters/)
    })

    it("never read as raw backend text", () => {
      expect(tagsProblem(tagsOf(25))).not.toMatch(/List should|items after validation|pydantic/i)
    })
  })

  it("rejects an unknown vertical", () => {
    expect(listingSchema.safeParse({ ...validListing, vertical: "pharmacy" }).success).toBe(false)
  })
})

describe("foodFormSchema / validateFoodFields", () => {
  it("accepts the smallest valid Food profile (1 category, 1 service)", () => {
    expect(validateFoodFields(validFood)).toEqual({})
  })

  it("requires 1–3 canonical, unique categories", () => {
    expect(validateFoodFields({ ...validFood, categories: [] }).categories).toBe("Choose at least one category.")
    expect(validateFoodFields({ ...validFood, categories: ["bakeries", "cafes", "bbq", "desi-food"] }).categories).toMatch(/up to 3/i)
    expect(validateFoodFields({ ...validFood, categories: ["bakeries", "bakeries"] }).categories).toMatch(/only be chosen once/i)
    expect(foodFormSchema.safeParse({ ...validFood, categories: ["sushi"] }).success).toBe(false)
    expect(validateFoodFields({ ...validFood, categories: ["bakeries", "cafes", "bbq"] })).toEqual({})
  })

  it("requires at least one canonical service option (frozen decision)", () => {
    expect(validateFoodFields({ ...validFood, serviceOptions: [] }).serviceOptions).toBe("Choose at least one service option.")
    expect(foodFormSchema.safeParse({ ...validFood, serviceOptions: ["curbside"] }).success).toBe(false)
  })

  it("keeps hours optional but bounded", () => {
    expect(validateFoodFields({ ...validFood, hoursNote: "Mon–Sun, 12 PM–11 PM" })).toEqual({})
    expect(validateFoodFields({ ...validFood, hoursNote: "h".repeat(81) }).hoursNote).toMatch(/under 80/)
  })

  it("requires a name on every menu row and bounds the optional fields; paths are per-row", () => {
    const errors = validateFoodFields({
      ...validFood,
      menuHighlights: [
        { name: "Karahi", section: "", description: "", price: "" },
        { name: "", section: "", description: "", price: "" },
        { name: "n".repeat(61), section: "s".repeat(41), description: "d".repeat(121), price: "p".repeat(25) },
      ],
    })
    expect(errors["menuHighlights.0.name"]).toBeUndefined()
    expect(errors["menuHighlights.1.name"]).toBe("Please enter the item name.")
    expect(Object.keys(errors).filter((key) => key.startsWith("menuHighlights.2."))).toEqual(
      expect.arrayContaining(["menuHighlights.2.name", "menuHighlights.2.section", "menuHighlights.2.description", "menuHighlights.2.price"])
    )
  })

  it("allows up to 8 menu highlights and rejects the 9th", () => {
    const row = { name: "Item", section: "", description: "", price: "" }
    expect(validateFoodFields({ ...validFood, menuHighlights: Array.from({ length: 8 }, () => row) })).toEqual({})
    expect(validateFoodFields({ ...validFood, menuHighlights: Array.from({ length: 9 }, () => row) }).menuHighlights).toMatch(/up to 8/)
  })
})

describe("propertySchema", () => {
  const validProperty = {
    title: "5 Marla House — B-17 Block C",
    listingType: "sale",
    propertyType: "House",
    price: "PKR 3 Cr",
    area: "B-17",
    description: "A well-kept family home with a garden and parking.",
  }

  it("accepts a valid Property and keeps optional fields optional", () => {
    expect(propertySchema.safeParse(validProperty).success).toBe(true)
    expect(propertySchema.safeParse({ ...validProperty, bedrooms: "3", furnished: "Furnished", tagsInput: "garden" }).success).toBe(true)
  })

  it("requires sale/rent, type, price, title, area and a meaningful description", () => {
    const paths = issuePaths(propertySchema.safeParse({ ...validProperty, title: "", listingType: "", propertyType: "", price: "", area: "", description: "short" }))
    expect(paths).toEqual(expect.arrayContaining(["title", "listingType", "propertyType", "price", "area", "description"]))
  })

  it("validates bedrooms as a whole number", () => {
    expect(issuePaths(propertySchema.safeParse({ ...validProperty, bedrooms: "2.5" }))).toContain("bedrooms")
    expect(issuePaths(propertySchema.safeParse({ ...validProperty, bedrooms: "three" }))).toContain("bedrooms")
  })
})

describe("parseTags", () => {
  it("splits on commas, trims, lowercases and drops empties", () => {
    expect(parseTags(" Karahi , NAAN,, family dining ")).toEqual(["karahi", "naan", "family dining"])
    expect(parseTags("")).toEqual([])
    expect(parseTags(undefined)).toEqual([])
  })

  it("drops repeats (case-insensitively) and keeps the first-seen order, like the server's normalisation", () => {
    expect(parseTags("Solar, wiring, SOLAR,  wiring , solar panels")).toEqual(["solar", "wiring", "solar panels"])
  })
})
