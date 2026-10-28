import { describe, expect, it } from "vitest"
import {
  gradeProblem,
  listingSchema,
  parseTags,
  propertySchema,
  tagsProblem,
  validateFoodFields,
  type FoodFormValues,
} from "@/features/provider/listingSchema"
import { addressProblem, landmarkProblem, locationTextProblems } from "@/features/provider/locationRules"
import { NOT_PLAIN_TEXT } from "@/features/provider/textRules"

/**
 * The client-side listing rules (Phase 12S S4) against the numbers the API enforces (`backend/app/schemas/write.py`):
 * tags (20, 40 characters, no repeats), one-line printable text, the property's price / bedrooms, the tutor's grade,
 * the location's text. Each one used to reach the server as a raw `422`. The same boundaries are cross-checked
 * against the mock server in `listingValidationParity.test.ts`.
 *
 * Invisible characters are written as escapes (a non-breaking space looks exactly like a space).
 */
const NBSP = " "
const ZWSP = "​"

const base = {
  name: "Capital Stationers",
  category: "stationery",
  description: "Office and school stationery, printing and photocopying.",
  area: "B-17",
  tagsInput: "stationery, printing",
}
const property = {
  title: "5 Marla House",
  listingType: "sale",
  propertyType: "house",
  price: "PKR 2.2 Cr",
  area: "B-17",
  description: "A corner house close to the park and the main road.",
}
const food: FoodFormValues = { categories: ["bakeries"], serviceOptions: ["takeaway"], hoursNote: "", menuHighlights: [], menuImage: undefined }

function messageFor(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) {
  return result.success ? undefined : result.error?.issues.find((issue) => issue.path.join(".") === field)?.message
}
const tags = (count: number) => Array.from({ length: count }, (_, i) => `tag${i + 1}`).join(", ")

describe("parseTags", () => {
  it("trims, lower-cases, drops blanks and repeats and keeps first-seen order (what the server stores)", () => {
    expect(parseTags(" Solar , panels,, SOLAR,Panels , net metering ")).toEqual(["solar", "panels", "net metering"])
    expect(parseTags(",,, ")).toEqual([])
  })
})

describe("tags (General listing): optional, bounded like the API", () => {
  it("allows exactly 20 and refuses 21 with how many to remove", () => {
    expect(listingSchema.safeParse({ ...base, tagsInput: tags(20) }).success).toBe(true)
    expect(messageFor(listingSchema.safeParse({ ...base, tagsInput: tags(21) }), "tagsInput")).toBe("You can add up to 20 tags. Remove 1 to continue.")
    expect(messageFor(listingSchema.safeParse({ ...base, tagsInput: tags(30) }), "tagsInput")).toMatch(/Remove 10 to continue/)
  })

  it("counts distinct tags: repeats and blanks do not use up the limit", () => {
    expect(listingSchema.safeParse({ ...base, tagsInput: `${tags(20)}, tag1, TAG2, , ,` }).success).toBe(true)
  })

  it("allows a tag of 40 characters and refuses 41, naming the tag", () => {
    expect(listingSchema.safeParse({ ...base, tagsInput: "x".repeat(40) }).success).toBe(true)
    expect(messageFor(listingSchema.safeParse({ ...base, tagsInput: `ok, ${"y".repeat(41)}` }), "tagsInput")).toMatch(/Each tag can be up to 40 characters\. "y+…" is 41\./)
  })

  it("is optional: empty, or only commas, is fine (the API's tags default to none)", () => {
    expect(listingSchema.safeParse({ ...base, tagsInput: "" }).success).toBe(true)
    expect(listingSchema.safeParse({ ...base, tagsInput: ",, ," }).success).toBe(true)
    expect(tagsProblem("")).toBeNull()
  })

  it("refuses a tag with a hidden character (the server would answer invalid_characters)", () => {
    expect(tagsProblem(`so${NBSP}lar`)).toBe(NOT_PLAIN_TEXT)
    expect(tagsProblem(`so${ZWSP}lar`)).toBe(NOT_PLAIN_TEXT)
    expect(tagsProblem("solar, panels")).toBeNull()
  })
})

describe("tags (Property listing): same limits", () => {
  it("may be empty, accepts 20, refuses 21", () => {
    expect(propertySchema.safeParse({ ...property, tagsInput: "" }).success).toBe(true)
    expect(propertySchema.safeParse({ ...property, tagsInput: tags(20) }).success).toBe(true)
    expect(messageFor(propertySchema.safeParse({ ...property, tagsInput: tags(21) }), "tagsInput")).toMatch(/up to 20/)
  })
})

describe("plain text only (the server refuses control and hidden characters)", () => {
  it("refuses a non-breaking space, a zero-width space or a tab in a one-line field", () => {
    expect(messageFor(listingSchema.safeParse({ ...base, name: `Capital${NBSP}Stationers` }), "name")).toBe(NOT_PLAIN_TEXT)
    expect(messageFor(listingSchema.safeParse({ ...base, name: "Capital\tStationers" }), "name")).toBe(NOT_PLAIN_TEXT)
    expect(messageFor(propertySchema.safeParse({ ...property, price: `PKR${ZWSP}1 Cr` }), "price")).toBe(NOT_PLAIN_TEXT)
    expect(messageFor(propertySchema.safeParse({ ...property, title: `House${NBSP}for sale` }), "title")).toBe(NOT_PLAIN_TEXT)
  })

  it("lets a description keep its line breaks, but not hidden characters", () => {
    expect(listingSchema.safeParse({ ...base, description: "Office stationery.\nPrinting and photocopying." }).success).toBe(true)
    expect(messageFor(listingSchema.safeParse({ ...base, description: `Office stationery,${NBSP}printing and copying.` }), "description")).toBe(NOT_PLAIN_TEXT)
    expect(messageFor(propertySchema.safeParse({ ...property, description: `A corner house${ZWSP} close to the park.` }), "description")).toBe(NOT_PLAIN_TEXT)
  })

  it("applies to the Food block's one-line fields too", () => {
    expect(validateFoodFields({ ...food, hoursNote: `Daily 8${NBSP}AM` }).hoursNote).toBe(NOT_PLAIN_TEXT)
    expect(validateFoodFields({ ...food, menuHighlights: [{ name: "Kar\tahi", section: "", description: "", price: "" }] })["menuHighlights.0.name"]).toBe(NOT_PLAIN_TEXT)
  })

  it("says what is wrong in words a person can act on", () => {
    expect(NOT_PLAIN_TEXT).toMatch(/non-breaking space/)
    expect(NOT_PLAIN_TEXT).not.toMatch(/invalid_characters|printable/)
  })
})

describe("field limits that match the API", () => {
  it("name 2-80 and description 20-400 for the shared form", () => {
    expect(listingSchema.safeParse({ ...base, name: "x".repeat(80) }).success).toBe(true)
    expect(messageFor(listingSchema.safeParse({ ...base, name: "x".repeat(81) }), "name")).toBe("That name is a bit too long.")
    expect(listingSchema.safeParse({ ...base, description: "d".repeat(20) }).success).toBe(true)
    expect(listingSchema.safeParse({ ...base, description: "d".repeat(19) }).success).toBe(false)
    expect(listingSchema.safeParse({ ...base, description: "d".repeat(400) }).success).toBe(true)
    expect(listingSchema.safeParse({ ...base, description: "d".repeat(401) }).success).toBe(false)
  })

  it("property: title 2-100, price 1-40, bedrooms a whole number 0-30", () => {
    expect(propertySchema.safeParse({ ...property, title: "t".repeat(100) }).success).toBe(true)
    expect(propertySchema.safeParse({ ...property, title: "t".repeat(101) }).success).toBe(false)
    expect(propertySchema.safeParse({ ...property, price: "p".repeat(40) }).success).toBe(true)
    expect(messageFor(propertySchema.safeParse({ ...property, price: "p".repeat(41) }), "price")).toBe("Please keep the price under 40 characters.")
    for (const ok of ["0", "3", "30", ""]) expect(propertySchema.safeParse({ ...property, bedrooms: ok }).success, ok).toBe(true)
    for (const bad of ["31", "100", "-1", "3.5", "three"]) {
      expect(messageFor(propertySchema.safeParse({ ...property, bedrooms: bad }), "bedrooms"), bad).toBe("Please enter a whole number from 0 to 30.")
    }
  })

  it("tutor grade: 1-60 characters of plain text", () => {
    expect(gradeProblem("Grade 9")).toBeNull()
    expect(gradeProblem("g".repeat(60))).toBeNull()
    expect(gradeProblem("   ")).toBe("Please enter the grade you teach.")
    expect(gradeProblem("g".repeat(61))).toBe("Please keep the grade under 60 characters.")
    expect(gradeProblem(`Grade${NBSP}9`)).toBe(NOT_PLAIN_TEXT)
  })
})

describe("location text: block, address and landmark", () => {
  it("address: at most 200 characters on one line", () => {
    expect(addressProblem("Shop 4, Main Market")).toBeNull()
    expect(addressProblem(undefined)).toBeNull()
    expect(addressProblem("a".repeat(200))).toBeNull()
    expect(addressProblem("a".repeat(201))).toBe("Please keep the address under 200 characters.")
    expect(addressProblem("Shop 4\nMain Market")).toMatch(/one line/)
    expect(addressProblem(`Shop 4,${NBSP}Main Market`)).toMatch(/plain characters/)
  })

  it("landmark: at most 100 characters of plain text", () => {
    expect(landmarkProblem("Next to the park")).toBeNull()
    expect(landmarkProblem("l".repeat(100))).toBeNull()
    expect(landmarkProblem("l".repeat(101))).toBe("Please keep the landmark under 100 characters.")
    expect(landmarkProblem(`Next${ZWSP}to the park`)).toBe(NOT_PLAIN_TEXT)
  })

  it("collects every problem of a location, keyed like the server's location.* errors", () => {
    expect(locationTextProblems({ block: "C", address: "Shop 4", landmark: "Park" })).toEqual({})
    const problems = locationTextProblems({ block: "C <b>", address: "a".repeat(201), landmark: "l".repeat(101) })
    expect(Object.keys(problems).sort()).toEqual(["location.address", "location.block", "location.landmark"])
  })
})
