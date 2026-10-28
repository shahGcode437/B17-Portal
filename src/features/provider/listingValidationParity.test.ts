import { describe, expect, it } from "vitest"
import {
  foodFormSchema,
  gradeProblem,
  listingSchema,
  propertySchema,
  validateFoodFields,
  type FoodFormValues,
  type ListingFormValues,
  type PropertyFormValues,
} from "@/features/provider/listingSchema"
import { businessCreate, propertyCreate, providerCreate, tutorCreate } from "@/features/provider/listingWriteAdapters"
import type { LocationWrite } from "@/lib/api/writes/listings"
import { validateListingBody, type Problem } from "@/test/fixtures/listingRules"

/**
 * Audit of all FIVE listing forms (Service, General Business, Food & Dining, Tutor, Property): for every
 * limit the API enforces, the form's own check and the mock server's check (which mirrors the backend's
 * request models, `src/test/fixtures/listingRules.ts`) must AGREE at the boundary - one value either side.
 * A form that accepts what the API refuses becomes a raw 422 for a real person; a form stricter than the
 * API is a lie about the rules. Either way this table fails.
 *
 * (Ported into main from the parallel S4 worktree and adapted: in main a listing picture is never typed - it is a
 * stored `https://` reference that is kept or removed - so the picture rows check what the BUILDERS send, not a field.)
 */

const LOCATION: LocationWrite = { visibility: "area_only" }
const general: ListingFormValues = {
  name: "Capital Stationers",
  category: "stationery",
  description: "Office and school stationery, printing and photocopying.",
  area: "B-17",
  tagsInput: "stationery, printing",
}
const foodBlock: FoodFormValues = { categories: ["bakeries"], serviceOptions: ["takeaway"], hoursNote: "", menuHighlights: [], menuImage: undefined }
const foodValues: ListingFormValues = { ...general, category: "", vertical: "food", food: foodBlock }
const propertyValues: PropertyFormValues = {
  title: "5 Marla House",
  listingType: "sale",
  propertyType: "house",
  price: "PKR 2.2 Cr",
  area: "B-17",
  description: "A corner house close to the park and the main road.",
}

const repeat = (char: string, n: number) => char.repeat(n)
const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i + 1}`).join(", ")

interface Case {
  /** "provider" | "business" | "food" | "tutor" | "property" */
  form: string
  field: string
  value: string
  ok: boolean
}

type Verdict = { client: boolean; server: boolean }

/** One value through the form's check and through the mock server's. `true` = accepted. */
function verdict(c: Case): Verdict {
  const set = <T extends object>(values: T): T => ({ ...values, [c.field]: c.value })
  switch (c.form) {
    case "provider": {
      const values = set(general)
      const client = listingSchema.safeParse(values).success
      const body = providerCreate(values, LOCATION)
      return { client, server: validateListingBody("provider", body as unknown as Record<string, unknown>, "create").length === 0 }
    }
    case "business": {
      const values = set(general)
      const client = listingSchema.safeParse(values).success
      const body = businessCreate(values, LOCATION)
      return { client, server: validateListingBody("business", body as unknown as Record<string, unknown>, "create").length === 0 }
    }
    case "tutor": {
      const values = c.field === "grade" ? general : set(general)
      const grade = c.field === "grade" ? c.value : "Grade 9"
      const client = listingSchema.safeParse(values).success && gradeProblem(grade) === null
      const body = tutorCreate(values, grade.trim(), LOCATION)
      return { client, server: validateListingBody("tutor", body as unknown as Record<string, unknown>, "create").length === 0 }
    }
    case "property": {
      const values = set(propertyValues)
      const client = propertySchema.safeParse(values).success
      const body = propertyCreate(values, { visibility: "approximate" })
      return { client, server: validateListingBody("property", body as unknown as Record<string, unknown>, "create").length === 0 }
    }
    case "food": {
      // A Food field is `food.<name>` or `menu.<name>`; the rest of the form stays valid.
      const [scope, name] = c.field.includes(".") ? c.field.split(".") : ["block", c.field]
      let food = foodBlock
      if (scope === "menu") food = { ...foodBlock, menuHighlights: [{ name: "Karahi", section: "", description: "", price: "", [name]: c.value }] }
      else food = { ...foodBlock, [name]: c.value }
      const values: ListingFormValues = { ...general, category: "", vertical: "food", food }
      const client = Object.keys(validateFoodFields(food)).length === 0 && foodFormSchema.safeParse(food).success
      const body = businessCreate(values, LOCATION)
      return { client, server: validateListingBody("business", body as unknown as Record<string, unknown>, "create").length === 0 }
    }
    default:
      throw new Error(`unknown form ${c.form}`)
  }
}

/** The same value on the shared fields of each of the four "name + description + tags" forms. */
function shared(field: string, value: string, ok: boolean): Case[] {
  return ["provider", "business", "tutor"].map((form) => ({ form, field, value, ok }))
}

const CASES: Case[] = [
  // name 2-80, printable
  ...shared("name", "Al", true),
  ...shared("name", "A", false),
  ...shared("name", repeat("n", 80), true),
  ...shared("name", repeat("n", 81), false),
  ...shared("name", "Capital Stationers", false),
  ...shared("name", "Capital\tStationers", false),
  // description 20-400, printable (a line break is allowed)
  ...shared("description", repeat("d", 20), true),
  ...shared("description", repeat("d", 19), false),
  ...shared("description", repeat("d", 400), true),
  ...shared("description", repeat("d", 401), false),
  ...shared("description", "First line of detail.\nSecond line of detail.", true),
  ...shared("description", "Description with a hidden​character inside.", false),
  // tags: 20 distinct, 40 characters, repeats do not count
  ...shared("tagsInput", tags(20), true),
  ...shared("tagsInput", tags(21), false),
  ...shared("tagsInput", `${tags(20)}, tag1, tag2, TAG3`, true),
  ...shared("tagsInput", repeat("x", 40), true),
  ...shared("tagsInput", repeat("x", 41), false),
  // the picture: a public https link or a site path, nothing else
  ...shared("image", "https://images.example.org/a.jpg", true),
  ...shared("image", "/assets/a.jpg", true),
  ...shared("image", "", true),

  // tutor grade 1-60
  { form: "tutor", field: "grade", value: "Grade 9", ok: true },
  { form: "tutor", field: "grade", value: repeat("g", 60), ok: true },
  { form: "tutor", field: "grade", value: repeat("g", 61), ok: false },
  { form: "tutor", field: "grade", value: "   ", ok: false },

  // property: title 2-100, price 1-40, description, bedrooms 0-30, tags, picture
  { form: "property", field: "title", value: repeat("t", 100), ok: true },
  { form: "property", field: "title", value: repeat("t", 101), ok: false },
  { form: "property", field: "title", value: "T", ok: false },
  { form: "property", field: "price", value: repeat("p", 40), ok: true },
  { form: "property", field: "price", value: repeat("p", 41), ok: false },
  { form: "property", field: "price", value: "PKR 1 Cr", ok: false },
  { form: "property", field: "description", value: repeat("d", 19), ok: false },
  { form: "property", field: "description", value: repeat("d", 400), ok: true },
  { form: "property", field: "description", value: repeat("d", 401), ok: false },
  { form: "property", field: "bedrooms", value: "0", ok: true },
  { form: "property", field: "bedrooms", value: "30", ok: true },
  { form: "property", field: "bedrooms", value: "31", ok: false },
  { form: "property", field: "tagsInput", value: tags(20), ok: true },
  { form: "property", field: "tagsInput", value: tags(21), ok: false },
  { form: "property", field: "tagsInput", value: repeat("x", 41), ok: false },
  { form: "property", field: "image", value: "https://images.example.org/p.jpg", ok: true },

  // Food & Dining: hours 80; menu item name 1-60, section 40, description 120, price 24; menu picture
  { form: "food", field: "hoursNote", value: repeat("h", 80), ok: true },
  { form: "food", field: "hoursNote", value: repeat("h", 81), ok: false },
  { form: "food", field: "hoursNote", value: "Daily 8 AM", ok: false },
  { form: "food", field: "menu.name", value: repeat("m", 60), ok: true },
  { form: "food", field: "menu.name", value: repeat("m", 61), ok: false },
  { form: "food", field: "menu.section", value: repeat("s", 40), ok: true },
  { form: "food", field: "menu.section", value: repeat("s", 41), ok: false },
  { form: "food", field: "menu.description", value: repeat("d", 120), ok: true },
  { form: "food", field: "menu.description", value: repeat("d", 121), ok: false },
  { form: "food", field: "menu.price", value: repeat("p", 24), ok: true },
  { form: "food", field: "menu.price", value: repeat("p", 25), ok: false },
  { form: "food", field: "menuImage", value: "https://images.example.org/menu.jpg", ok: true },
]

describe("the five listing forms agree with the API's request rules at every boundary", () => {
  it.each(CASES.map((c) => [`${c.form}: ${c.field} = ${JSON.stringify(c.value.length > 48 ? `${c.value.slice(0, 20)}…(${c.value.length})` : c.value)}`, c] as const))(
    "%s",
    (_, c) => {
      const { client, server } = verdict(c)
      expect({ client, server }, "the form and the server must give the same answer").toEqual({ client: c.ok, server: c.ok })
    }
  )

  it("every form has cases (the table is not silently skipping a form)", () => {
    expect(new Set(CASES.map((c) => c.form))).toEqual(new Set(["provider", "business", "tutor", "property", "food"]))
  })
})

describe("what the builders never send, so the server never has to refuse it", () => {
  /** A picture reference the server refuses. Main has no field to type one; a stored value like it is never sent. */
  const BAD_PICTURES = ["http://images.example.org/a.jpg", "blob:http://localhost:5173/6f1c", "data:image/png;base64,AAAA", "https://user:pw@example.org/a.jpg", "not a link"]

  it.each(BAD_PICTURES)("%s: the server would refuse it, and no create body ever carries it", (image) => {
    const withImage = { ...providerCreate({ ...general, image }, LOCATION) } as unknown as Record<string, unknown>
    expect(withImage).not.toHaveProperty("image")
    expect(validateListingBody("provider", withImage, "create")).toEqual([])
    // ...while the mock does refuse the value if it were sent
    const sent = validateListingBody("provider", { ...withImage, image }, "create") as Problem[]
    expect(sent.map((p) => p.code)).toContain("invalid_media_reference")
    // the Property and Food builders agree
    expect(propertyCreate({ ...propertyValues, image }, { visibility: "approximate" })).not.toHaveProperty("image")
    const foodBody = businessCreate({ ...foodValues, food: { ...foodBlock, menuImage: image } }, LOCATION) as unknown as { food: Record<string, unknown> }
    expect(foodBody.food).not.toHaveProperty("menuImage")
  })

  it("a stored https picture is kept, exactly as it is", () => {
    const image = "https://images.example.org/a.jpg"
    expect(providerCreate({ ...general, image }, LOCATION)).toMatchObject({ image })
    expect(propertyCreate({ ...propertyValues, image }, { visibility: "approximate" })).toMatchObject({ image })
  })

  it("the area is fixed: the form always sends B-17, and the server refuses anything else", () => {
    const body = providerCreate({ ...general, area: "B-17" }, LOCATION) as unknown as Record<string, unknown>
    expect(validateListingBody("provider", body, "create")).toEqual([])
    expect(validateListingBody("provider", { ...body, area: "B-17, Block C" }, "create").map((p) => p.code)).toContain("unknown_locality")
    expect(validateListingBody("provider", { ...body, area: "Sector F-7" }, "create").map((p) => p.code)).toContain("unknown_locality")
    // The server accepts the configured spelling in any case and spacing; the form never sends anything else.
    expect(validateListingBody("provider", { ...body, area: "  b-17 " }, "create")).toEqual([])
  })

  it("no backend-owned key is ever in a create body (the server answers not_allowed to any)", () => {
    const bodies = [
      providerCreate(general, LOCATION),
      businessCreate(general, LOCATION),
      businessCreate(foodValues, LOCATION),
      tutorCreate(general, "Grade 9", LOCATION),
      propertyCreate(propertyValues, { visibility: "approximate" }),
    ]
    for (const body of bodies) {
      const record = body as unknown as Record<string, unknown>
      expect(validateListingBody(String(record.kind), record, "create"), String(record.kind)).toEqual([])
    }
    const refused = validateListingBody("provider", { ...providerCreate(general, LOCATION), status: "approved", ownerId: "x", featured: true }, "create")
    expect(refused.map((p) => p.field).sort()).toEqual(["featured", "ownerId", "status"])
    expect(new Set(refused.map((p) => p.code))).toEqual(new Set(["not_allowed"]))
  })
})
