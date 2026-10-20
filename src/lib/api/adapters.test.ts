import { describe, expect, it } from "vitest"
import {
  isValidCoordinate,
  toBusiness,
  toListingHit,
  toNewsArticle,
  toProperty,
  toProvider,
  toPublicLocation,
  toSearchHit,
  toSearchHits,
  toSuggestion,
  toTutor,
} from "@/lib/api/adapters"
import type { LocationDto, SearchHitDto } from "@/lib/api/dto/public"
import { BUSINESSES, IDS, NEWS, PROPERTIES, PROVIDERS, TUTORS } from "@/test/fixtures/apiFixtures"

describe("isValidCoordinate", () => {
  it("accepts real WGS-84 points and rejects everything else", () => {
    expect(isValidCoordinate(33.7, 73.05)).toBe(true)
    expect(isValidCoordinate(0, 0)).toBe(true)
    expect(isValidCoordinate(90.0001, 0)).toBe(false)
    expect(isValidCoordinate(0, 180.5)).toBe(false)
    expect(isValidCoordinate(Number.NaN, 73)).toBe(false)
    expect(isValidCoordinate(33, Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidCoordinate("33.7", 73)).toBe(false)
    expect(isValidCoordinate(undefined, undefined)).toBe(false)
    expect(isValidCoordinate(null, null)).toBe(false)
  })
})

describe("toPublicLocation (privacy hardening)", () => {
  const exact: LocationDto = {
    visibility: "exact",
    block: "C",
    address: "Shop 4",
    landmark: "Near the park",
    coordinates: { latitude: 33.7012, longitude: 73.0512, precision: "exact" },
  }

  it("keeps an exact location whole", () => {
    expect(toPublicLocation(exact)).toEqual({
      visibility: "exact",
      block: "C",
      address: "Shop 4",
      landmark: "Near the park",
      coordinates: { latitude: 33.7012, longitude: 73.0512, precision: "exact" },
    })
  })

  it("keeps only the block for area-only, even if the response carries more", () => {
    const leaky = { ...exact, visibility: "area_only" } as LocationDto
    expect(toPublicLocation(leaky)).toEqual({ visibility: "area_only", block: "C" })
  })

  it("never keeps an address or landmark for an approximate location", () => {
    const location = toPublicLocation({
      visibility: "approximate",
      block: "C",
      address: "Should not be here",
      landmark: "Nor this",
      coordinates: { latitude: 33.7, longitude: 73.06, precision: "approximate" },
    })
    expect(location).toEqual({
      visibility: "approximate",
      block: "C",
      coordinates: { latitude: 33.7, longitude: 73.06, precision: "approximate" },
    })
  })

  it("refuses an approximate point labelled exact, and an exact point labelled approximate", () => {
    expect(
      toPublicLocation({ visibility: "approximate", coordinates: { latitude: 33.7, longitude: 73.06, precision: "exact" } })
        .coordinates
    ).toBeUndefined()
    expect(
      toPublicLocation({ visibility: "exact", coordinates: { latitude: 33.7, longitude: 73.06, precision: "approximate" } })
        .coordinates
    ).toBeUndefined()
  })

  it("treats a missing or unknown visibility as area-only", () => {
    expect(toPublicLocation(undefined)).toEqual({ visibility: "area_only" })
    expect(toPublicLocation({ visibility: "mystery", block: "A", coordinates: exact.coordinates } as unknown as LocationDto)).toEqual({
      visibility: "area_only",
      block: "A",
    })
  })

  it("drops malformed and out-of-range coordinates instead of drawing a broken map", () => {
    for (const bad of [
      { latitude: 120, longitude: 73, precision: "exact" },
      { latitude: 33, longitude: 300, precision: "exact" },
      { latitude: Number.NaN, longitude: 73, precision: "exact" },
      { latitude: "33.7", longitude: 73, precision: "exact" },
    ]) {
      const location = toPublicLocation({ ...exact, coordinates: bad } as unknown as LocationDto)
      expect(location.coordinates).toBeUndefined()
      expect(location.visibility).toBe("exact")
    }
  })

  it("trims blank text away", () => {
    expect(toPublicLocation({ visibility: "exact", block: "  ", address: "   " })).toEqual({ visibility: "exact" })
  })
})

describe("listing adapters", () => {
  it("maps a provider, keeping the backend id and category slug", () => {
    const provider = toProvider(PROVIDERS[0])
    expect(provider).toMatchObject({ id: IDS.provider, name: "Sunrise Solar Solutions", category: "solar", featured: true })
    expect(provider.location).toEqual({ visibility: "area_only" })
  })

  it("maps a General business without a food profile", () => {
    const business = toBusiness(BUSINESSES[0])
    expect(business.vertical).toBe("general")
    expect(business.food).toBeUndefined()
    expect(business.location?.coordinates).toMatchObject({ precision: "exact" })
  })

  it("maps Food as a vertical of Business, with server category labels and menu", () => {
    const food = toBusiness(BUSINESSES[2])
    expect(food.vertical).toBe("food")
    expect(food.food?.categories).toEqual(["bakeries", "sweets-desserts"])
    expect(food.food?.categoryLabels).toMatchObject({ bakeries: "Bakeries" })
    expect(food.food?.menuHighlights?.map((item) => item.name)).toContain("Fresh Milk Bread")
  })

  it("maps a tutor and a property (including the approximate / exact points)", () => {
    expect(toTutor(TUTORS[0]).location).toMatchObject({ visibility: "approximate", coordinates: { precision: "approximate" } })
    const property = toProperty(PROPERTIES[0])
    expect(property).toMatchObject({ id: IDS.propertyExact, bedrooms: 3, listingType: "sale" })
    expect(property.location?.address).toBe("Plot 12, Street 4")
  })

  it("never invents a description for a listing that has none", () => {
    const { description: _unused, ...withoutDescription } = PROVIDERS[1]
    void _unused
    expect(toProvider(withoutDescription as typeof PROVIDERS[1]).description).toBe("")
  })

  it("maps a news item", () => {
    expect(toNewsArticle(NEWS[0])).toMatchObject({ id: IDS.news, kind: "news", status: "published", category: "Community" })
  })
})

describe("search hits and suggestions", () => {
  it("maps each kind of hit and skips an unknown kind without failing the page", () => {
    const dtos = [
      { kind: "provider", item: PROVIDERS[0] },
      { kind: "business", item: BUSINESSES[2] },
      { kind: "tutor", item: TUTORS[0] },
      { kind: "property", item: PROPERTIES[0] },
      { kind: "news", item: NEWS[0] },
      { kind: "spaceship", item: {} },
    ] as unknown as SearchHitDto[]
    const hits = toSearchHits(dtos)
    expect(hits.map((hit) => hit.kind)).toEqual(["provider", "business", "tutor", "property", "news"])
    expect(toSearchHit(dtos[0]).kind).toBe("provider")
  })

  it("maps a bare listing to a hit", () => {
    expect(toListingHit(BUSINESSES[0]).kind).toBe("business")
  })

  it("maps a suggestion without losing any field", () => {
    const suggestion = toSuggestion({
      id: IDS.generalExact,
      label: "Glow Salon",
      secondaryLabel: "Business - B-17",
      type: "business",
      value: "Glow Salon",
    })
    expect(suggestion).toEqual({
      id: IDS.generalExact,
      label: "Glow Salon",
      secondaryLabel: "Business - B-17",
      type: "business",
      value: "Glow Salon",
    })
  })
})
