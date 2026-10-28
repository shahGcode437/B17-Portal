import { describe, expect, it } from "vitest"
import { canonicalLocality, hasListingRoom, isValidMediaReference, validateListingBody } from "./listingRules"

/**
 * The mock server's listing rules, written from `backend/app/schemas/write.py` and `listing_state.py` (see the module).
 * These pin the codes the LIVE API answers (captured against the real stack), so a change here is a backend change.
 */
const codes = (kind: string, body: Record<string, unknown>, mode: "create" | "patch" = "create", stored?: { vertical?: string }) =>
  validateListingBody(kind, body, mode, stored).map((p) => `${p.field}:${p.code}`)

const provider = {
  kind: "provider",
  name: "Imran Electrical Works",
  category: "electrical",
  description: "Wiring, repairs and fittings across B-17.",
  area: "B-17",
  tags: ["wiring"],
  location: { visibility: "area_only" },
}

describe("validateListingBody: shape and lengths", () => {
  it("a valid provider has no problem", () => expect(codes("provider", provider)).toEqual([]))

  it("reports every problem at once, with the API's codes", () => {
    expect(codes("provider", { ...provider, name: "X", description: "short", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toEqual(
      expect.arrayContaining(["name:string_too_short", "description:string_too_short", "tags:too_long"])
    )
  })

  it("an omitted required field is `missing` on create and fine on a PATCH", () => {
    const { description: _omitted, ...without } = provider
    expect(codes("provider", without)).toContain("description:missing")
    expect(codes("provider", { revision: 1, name: "Imran Electrical Works" }, "patch")).toEqual([])
  })

  it("an empty area is refused by the request model (string_too_short); an unknown one by the service (unknown_locality)", () => {
    expect(codes("provider", { ...provider, area: "" })).toEqual(["area:string_too_short"])
    expect(codes("provider", { ...provider, area: "Islamabad" })).toEqual(["area:unknown_locality"])
    expect(canonicalLocality("  b-17 ")).toBe("B-17")
    expect(canonicalLocality("B-17 Block C")).toBeNull()
  })

  it("printable text: a non-breaking space is invalid_characters, a line break only in a description", () => {
    expect(codes("provider", { ...provider, name: "Imran Electrical" })).toContain("name:invalid_characters")
    expect(codes("provider", { ...provider, description: "Wiring and repairs.\nAcross all of B-17." })).toEqual([])
    expect(codes("provider", { ...provider, name: "Imran\nElectrical" })).toContain("name:invalid_characters")
  })

  it("property: price 1-40, bedrooms 0-30 (an integer), title 2-100", () => {
    const property = { kind: "property", title: "5 Marla House", listingType: "sale", propertyType: "house", price: "PKR 2.2 Cr", description: "A corner house close to the park.", area: "B-17", location: { visibility: "exact" } }
    expect(codes("property", property)).toEqual([])
    expect(codes("property", { ...property, price: "p".repeat(41) })).toContain("price:string_too_long")
    expect(codes("property", { ...property, bedrooms: 31 })).toContain("bedrooms:less_than_equal")
    expect(codes("property", { ...property, bedrooms: -1 })).toContain("bedrooms:greater_than_equal")
    expect(codes("property", { ...property, bedrooms: 2.5 })).toContain("bedrooms:int_type")
  })
})

describe("validateListingBody: the location block", () => {
  it("accepts letters, digits, space, - / . and refuses anything else (invalid_format) or over 40 (string_too_long)", () => {
    expect(codes("provider", { ...provider, location: { visibility: "area_only", block: "Block C-2/1." } })).toEqual([])
    expect(codes("provider", { ...provider, location: { visibility: "area_only", block: "C <b>" } })).toEqual(["location.block:invalid_format"])
    expect(codes("provider", { ...provider, location: { visibility: "area_only", block: "C".repeat(41) } })).toEqual(["location.block:string_too_long"])
    expect(codes("provider", { ...provider, location: { visibility: "exact", address: "a".repeat(201) } })).toContain("location.address:string_too_long")
  })
})

describe("validateListingBody: strict keys (not_allowed)", () => {
  it("a key the model does not declare is refused, set or null", () => {
    expect(codes("provider", { ...provider, status: "approved", ownerId: "x", featured: true }).sort()).toEqual(["featured:not_allowed", "ownerId:not_allowed", "status:not_allowed"])
    expect(codes("provider", { revision: 1, kind: "provider" }, "patch")).toEqual(["kind:not_allowed"])
  })
})

describe("validateListingBody: what a PATCH may clear (not_nullable)", () => {
  it("null clears ONLY image, bedrooms and furnished", () => {
    expect(codes("property", { revision: 1, image: null, bedrooms: null, furnished: null }, "patch")).toEqual([])
    for (const field of ["description", "name", "tags", "location", "area", "category", "price"]) {
      expect(codes("provider", { revision: 1, [field]: null }, "patch"), field).toContain(`${field}:not_nullable`)
    }
  })

  it("inside a Food patch only hoursNote and menuImage may be null", () => {
    expect(codes("business", { revision: 1, vertical: "food", food: { hoursNote: null, menuImage: null } }, "patch")).toEqual([])
    expect(codes("business", { revision: 1, vertical: "food", food: { menuHighlights: null } }, "patch")).toContain("food.menuHighlights:not_nullable")
  })
})

describe("validateListingBody: a field the stored kind does not have (not_allowed)", () => {
  it("a Food block on a General business, a category on a Food one", () => {
    expect(codes("business", { revision: 1, food: { categories: ["bakeries"] } }, "patch", { vertical: "general" })).toContain("food:not_allowed")
    expect(codes("business", { revision: 1, category: "stationery" }, "patch", { vertical: "food" })).toContain("category:not_allowed")
    // switching sides is legal: General -> Food takes the food block, Food -> General takes a category
    expect(codes("business", { revision: 1, vertical: "food", food: { categories: ["bakeries"] } }, "patch", { vertical: "general" })).toEqual([])
    expect(codes("business", { revision: 1, vertical: "general", category: "stationery" }, "patch", { vertical: "food" })).toEqual([])
    // and `food: null` is never the way to say "no food": it is not_nullable
    expect(codes("business", { revision: 1, food: null }, "patch", { vertical: "general" })).toEqual(["food:not_nullable"])
  })
})

describe("media references and the Free plan's room", () => {
  it("a picture must be a public https address or a site path (invalid_media_reference)", () => {
    expect(isValidMediaReference("https://images.example.org/a.jpg")).toBe(true)
    expect(isValidMediaReference("/assets/a.jpg")).toBe(true)
    for (const bad of ["blob:http://localhost/x", "data:image/png;base64,AAAA", "http://x.org/a.jpg", "https://u:p@x.org/a.jpg", "//x.org/a.jpg", "/a/../b"]) {
      expect(isValidMediaReference(bad), bad).toBe(false)
    }
    expect(codes("provider", { ...provider, image: "blob:http://localhost/x" })).toEqual(["image:invalid_media_reference"])
    expect(codes("provider", { revision: 1, image: null }, "patch")).toEqual([]) // null clears the picture
  })

  it("Free allows 3 active listings, Premium any number", () => {
    expect(hasListingRoom("free", 2)).toBe(true)
    expect(hasListingRoom("free", 3)).toBe(false)
    expect(hasListingRoom(undefined, 3)).toBe(false)
    expect(hasListingRoom("premium", 50)).toBe(true)
  })
})
