import { beforeEach, describe, expect, it } from "vitest"
import { resetWriteState, routeWrite, writeState } from "./writeRouter"

/**
 * Mock-versus-real parity (Phase 12S, S4). The mock backend used by the component and mock-lane tests used to accept
 * everything the real API refuses (a free-text area, 40 tags, a Free user's fourth listing, a request to your own
 * listing...), so a test could pass against a flow the real stack would reject. These tests pin the rules the mock now
 * enforces, with the codes the live API answers (captured against the real stack in this phase). If one of them has to
 * change, the backend rule changed first.
 */
type Caller = NonNullable<Parameters<typeof routeWrite>[3]>
const owner: Caller = { roles: ["resident", "professional"], displayName: "Sana Owner", email: "owner@example.com", professional: true, planCode: "free", emailVerified: true }
const premium: Caller = { ...owner, email: "premium@example.com", planCode: "premium" }
const requester: Caller = { roles: ["resident"], displayName: "Rida Resident", email: "rida@example.com", professional: false, emailVerified: true }
const admin: Caller = { roles: ["admin"], displayName: "Admin", email: "admin@example.com" }

const location = { visibility: "area_only" as const }
const providerBody = (over: Record<string, unknown> = {}) => ({
  kind: "provider",
  name: "Imran Electrical Works",
  category: "electrical",
  description: "Wiring, repairs and fittings across B-17.",
  area: "B-17",
  tags: ["wiring", "repairs"],
  location,
  ...over,
})

type ErrorBody = { error: { code: string; details: { field: string; code: string }[] } }
type Reply = ReturnType<typeof routeWrite>
/** The mock always answers a write it knows; a null here is a test bug. */
const replied = (reply: Reply) => {
  if (reply === null) throw new Error("the mock did not handle this write")
  return reply
}
const dataOf = <T,>(reply: Reply): T => (replied(reply).body as { data: T }).data
const statusOf = (reply: Reply) => replied(reply).status
const errorOf = (reply: Reply) => (replied(reply).body as ErrorBody).error
const detailsOf = (reply: Reply) => errorOf(reply).details.map((d) => `${d.field}:${d.code}`)
const create = (body: Record<string, unknown>, me = owner) => routeWrite("POST", "/listings", body, me)

beforeEach(() => resetWriteState())

describe("mock parity: the listing field rules the real API enforces", () => {
  it("accepts a valid listing and stores the area as B-17", () => {
    const reply = create(providerBody())
    expect(statusOf(reply)).toBe(201)
    expect(dataOf<{ area: string }>(reply).area).toBe("B-17")
  })

  it.each(["Islamabad", "B-17 Block C", "B-17, Block C", "F-7"])("refuses area %j as unknown_locality", (area) => {
    const reply = create(providerBody({ area }))
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toContain("area:unknown_locality")
  })

  it("an EMPTY area never reaches the locality check: the request model refuses it first (string_too_short)", () => {
    const reply = create(providerBody({ area: "" }))
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toEqual(["area:string_too_short"])
  })

  it("matches the locality like the API does: case-insensitively, whitespace collapsed, stored as B-17", () => {
    const reply = create(providerBody({ area: "  b-17 " }))
    expect(statusOf(reply)).toBe(201)
    expect(dataOf<{ area: string }>(reply).area).toBe("B-17")
  })

  it("refuses more than 20 tags (too_long) and a tag over 40 characters (string_too_long)", () => {
    const many = create(providerBody({ tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }))
    expect(detailsOf(many)).toContain("tags:too_long")
    const long = create(providerBody({ tags: ["x".repeat(41)] }))
    expect(detailsOf(long)).toContain("tags.0:string_too_long")
    expect(statusOf(create(providerBody({ tags: Array.from({ length: 20 }, (_, i) => `tag${i}`) })))).toBe(201)
  })

  it("refuses a block outside the allowed characters (invalid_format) or over 40 characters (string_too_long)", () => {
    expect(detailsOf(create(providerBody({ location: { visibility: "area_only", block: "C <b>" } })))).toContain("location.block:invalid_format")
    expect(detailsOf(create(providerBody({ location: { visibility: "area_only", block: "C".repeat(41) } })))).toContain("location.block:string_too_long")
    expect(statusOf(create(providerBody({ location: { visibility: "area_only", block: "Block C-2/1." } })))).toBe(201)
  })

  it("refuses a short name or description, and a missing description, all in one aggregated answer", () => {
    const reply = create(providerBody({ name: "X", description: "too short" }))
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toEqual(expect.arrayContaining(["name:string_too_short", "description:string_too_short"]))
    const { description: _omitted, ...withoutDescription } = providerBody()
    expect(detailsOf(create(withoutDescription))).toContain("description:missing")
  })

  it("refuses an image that is not an https address or a site path (uploads do not exist yet)", () => {
    expect(detailsOf(create(providerBody({ image: "blob:http://localhost/abc" })))).toContain("image:invalid_media_reference")
    expect(detailsOf(create(providerBody({ image: "data:image/png;base64,AAAA" })))).toContain("image:invalid_media_reference")
    expect(statusOf(create(providerBody({ image: "https://cdn.example.com/a.jpg" })))).toBe(201)
  })

  it("a property cannot be area_only (not_allowed), as on the real API", () => {
    const reply = create({ kind: "property", title: "Corner house", listingType: "rent", propertyType: "house", price: "PKR 1", description: "A bright, well-kept home in a quiet block.", area: "B-17", location })
    expect(detailsOf(reply)).toContain("location.visibility:not_allowed")
  })

  it("a PATCH is held to the same rules, and a refused PATCH changes nothing", () => {
    const id = dataOf<{ id: string }>(create(providerBody())).id
    const before = JSON.stringify(writeState().listings.find((l) => l.id === id))
    const reply = routeWrite("PATCH", `/listings/${id}`, { revision: 1, area: "Islamabad" }, owner)
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toContain("area:unknown_locality")
    expect(JSON.stringify(writeState().listings.find((l) => l.id === id))).toBe(before)
  })

  it("a PATCH may clear ONLY image, bedrooms and furnished; any other null is not_nullable (the General-business `food: null` bug)", () => {
    const id = (dataOf<{ id: string }>(create(providerBody())))!.id
    for (const field of ["description", "name", "tags", "location", "area", "category"]) {
      const reply = routeWrite("PATCH", `/listings/${id}`, { revision: 1, [field]: null }, owner)
      expect(statusOf(reply), field).toBe(422)
      expect(detailsOf(reply), field).toContain(`${field}:not_nullable`)
    }
    expect(statusOf(routeWrite("PATCH", `/listings/${id}`, { revision: 1, image: null, description: "A real change, long enough to be valid." }, owner))).toBe(200)
  })

  it("a General business PATCH carrying a Food block is refused (not_allowed); the same PATCH without it is saved", () => {
    const general = writeState().listings.find((l) => l.kind === "business" && l.vertical === "general")!
    const withFood = routeWrite("PATCH", `/listings/${general.id}`, { revision: general.revision, description: "A real change, long enough to be valid.", food: { categories: ["bakeries"] } }, owner)
    expect(statusOf(withFood)).toBe(422)
    expect(detailsOf(withFood)).toContain("food:not_allowed")
    const withNull = routeWrite("PATCH", `/listings/${general.id}`, { revision: general.revision, description: "A real change, long enough to be valid.", food: null }, owner)
    expect(detailsOf(withNull)).toContain("food:not_nullable")
    expect(statusOf(routeWrite("PATCH", `/listings/${general.id}`, { revision: general.revision, description: "A real change, long enough to be valid." }, owner))).toBe(200)
  })

  it("echoes the category SLUG in `category` and the human name in `categoryLabel`", () => {
    const data = dataOf<{ category: string; categoryLabel: string }>(create(providerBody({ category: "electrical" })))
    expect(data.category).toBe("electrical")
    expect(data.categoryLabel).toBe("Electrical")
  })
})

describe("mock parity: plan quota and rate limits", () => {
  it("the Free plan allows 3 active listings: the fixtures hold 2, so one more fits and the next is plan_limit_reached", () => {
    expect(statusOf(create(providerBody()))).toBe(201)
    const fourth = create(providerBody({ name: "Imran Electrical Two" }))
    expect(statusOf(fourth)).toBe(403)
    expect(errorOf(fourth).code).toBe("plan_limit_reached")
  })

  it("Premium is unlimited", () => {
    for (let i = 0; i < 6; i += 1) expect(statusOf(create(providerBody({ name: `Premium listing ${i}` }), premium))).toBe(201)
  })

  it("archiving frees a Free slot", () => {
    const first = dataOf<{ id: string; revision: number }>(create(providerBody()))
    expect(statusOf(create(providerBody({ name: "Over the limit" })))).toBe(403)
    expect(statusOf(routeWrite("POST", `/listings/${first.id}/archive`, { revision: first.revision }, owner))).toBe(200)
    expect(statusOf(create(providerBody({ name: "After archiving" })))).toBe(201)
  })

  it("resubmitting a REJECTED listing needs a free slot, and a refused resubmission changes nothing", () => {
    const rejectedId = writeState().listings.find((l) => l.status === "rejected")!.id
    expect(statusOf(create(providerBody()))).toBe(201) // now 3 active
    const before = JSON.stringify(writeState().listings.find((l) => l.id === rejectedId))
    const reply = routeWrite("PATCH", `/listings/${rejectedId}`, { revision: 1, description: "A new description that is long enough to be a real change." }, owner)
    expect(statusOf(reply)).toBe(403)
    expect(errorOf(reply).code).toBe("plan_limit_reached")
    expect(JSON.stringify(writeState().listings.find((l) => l.id === rejectedId))).toBe(before)
  })

  it("listing creation is limited to 10 per user per hour (429 rate_limited), and a refused request uses no slot", () => {
    for (let i = 0; i < 10; i += 1) expect(statusOf(create(providerBody({ name: `Rapid ${i}` }), premium))).toBe(201)
    const eleventh = create(providerBody({ name: "Rapid 11" }), premium)
    expect(statusOf(eleventh)).toBe(429)
    expect(errorOf(eleventh).code).toBe("rate_limited")
    expect(statusOf(create(providerBody({ name: "Other person" }), { ...premium, email: "other@example.com" }))).toBe(201)
  })
})

describe("mock parity: service requests", () => {
  const approvedProviderId = () => writeState().listings.find((l) => l.status === "approved" && l.kind === "provider")!.id
  const day = (offset: number) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const requestBody = (over: Record<string, unknown> = {}) => ({
    providerListingId: approvedProviderId(),
    service: "Plumbing",
    details: "A tap is leaking in the kitchen sink.",
    area: "B-17, Block C",
    preferredDate: day(2),
    preferredContactChannel: "phone",
    ...over,
  })
  const send = (body: Record<string, unknown>, me = requester) => routeWrite("POST", "/requests", body, me)

  it("a verified resident can send a request", () => {
    expect(statusOf(send(requestBody()))).toBe(201)
  })

  it("an unverified e-mail is refused with email_not_verified before anything else is looked at", () => {
    const reply = send({}, { ...requester, emailVerified: false })
    expect(statusOf(reply)).toBe(403)
    expect(errorOf(reply).code).toBe("email_not_verified")
  })

  it("a date in the past (in_the_past) or beyond 365 days (too_far_ahead) is refused", () => {
    expect(detailsOf(send(requestBody({ preferredDate: day(-1) })))).toContain("preferredDate:in_the_past")
    expect(detailsOf(send(requestBody({ preferredDate: day(400) })))).toContain("preferredDate:too_far_ahead")
    expect(statusOf(send(requestBody({ preferredDate: day(0) })))).toBe(201)
  })

  it("details shorter than 10 characters are refused (string_too_short)", () => {
    expect(detailsOf(send(requestBody({ details: "leak" })))).toContain("details:string_too_short")
  })

  it("hidden characters and unknown keys are refused like the API does (invalid_characters, not_allowed)", () => {
    expect(detailsOf(send(requestBody({ details: "A tap is leaking in the kitchen." })))).toContain("details:invalid_characters")
    expect(detailsOf(send(requestBody({ status: "accepted" })))).toContain("status:not_allowed")
  })

  it("a second request to the same provider on the same day is rate_limited", () => {
    expect(statusOf(send(requestBody()))).toBe(201)
    const again = send(requestBody())
    expect(statusOf(again)).toBe(429)
    expect(errorOf(again).code).toBe("rate_limited")
  })

  it("a person can send at most 5 requests per hour (the sixth is rate_limited)", () => {
    const providers = Array.from({ length: 6 }, (_, i) => {
      const reply = routeWrite("POST", "/listings", providerBody({ name: `Provider number ${i}` }), premium)
      const listing = dataOf<{ id: string; revision: number }>(reply)
      routeWrite("POST", `/admin/listings/${listing.id}/approve`, { revision: listing.revision }, admin)
      return listing.id
    })
    for (const id of providers.slice(0, 5)) expect(statusOf(send(requestBody({ providerListingId: id })))).toBe(201)
    expect(statusOf(send(requestBody({ providerListingId: providers[5] })))).toBe(429)
  })

  it("a request to your own listing is refused as own_listing (a validation_error detail)", () => {
    const created = dataOf<{ id: string; revision: number }>(create(providerBody({ name: "My own plumbing" }), premium))
    routeWrite("POST", `/admin/listings/${created.id}/approve`, { revision: created.revision }, admin)
    const reply = send(requestBody({ providerListingId: created.id }), { ...premium, emailVerified: true })
    expect(statusOf(reply)).toBe(422)
    expect(errorOf(reply).code).toBe("validation_error")
    expect(detailsOf(reply)).toContain("providerListingId:own_listing")
  })

  it("only service providers can be requested (not_requestable)", () => {
    const business = writeState().listings.find((l) => l.status === "pending" && l.kind === "business")!
    business.status = "approved"
    expect(detailsOf(send(requestBody({ providerListingId: business.id })))).toContain("providerListingId:not_requestable")
  })
})

describe("mock parity: a takedown is marked, a plain rejection is not (S5A / B-03)", () => {
  const reason = "Reported as closed; please confirm you still trade."
  const reject = (id: string, revision: number) => routeWrite("POST", `/admin/listings/${id}/reject`, { revision, reason }, admin)
  type Owned = { status: string; takenDown?: boolean; rejectionReason?: string; revision: number }
  const stored = (id: string) => writeState().listings.find((l) => l.id === id) as unknown as Owned

  it("rejecting a pending listing is a plain rejection (no takenDown)", () => {
    const pending = writeState().listings.find((l) => l.status === "pending")!
    expect(statusOf(reject(pending.id, pending.revision))).toBe(200)
    expect(stored(pending.id).status).toBe("rejected")
    expect(stored(pending.id).takenDown).toBeUndefined()
  })

  it("rejecting an APPROVED listing is a takedown, and an owner edit clears the marker with the reason", () => {
    const live = writeState().listings.find((l) => l.status === "approved" && l.kind === "provider")!
    expect(statusOf(reject(live.id, live.revision))).toBe(200)
    expect(stored(live.id)).toMatchObject({ status: "rejected", takenDown: true, rejectionReason: reason })

    const edited = routeWrite("PATCH", `/listings/${live.id}`, { revision: live.revision, description: "Open again, with a longer description of the work." }, owner)
    expect(statusOf(edited)).toBe(200)
    expect(stored(live.id).status).toBe("pending")
    expect(stored(live.id).takenDown).toBeUndefined()
    expect(stored(live.id).rejectionReason).toBeUndefined()
  })
})
