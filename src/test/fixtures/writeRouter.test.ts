import { beforeEach, describe, expect, it } from "vitest"
import { PROVIDERS } from "./apiFixtures"
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
// A Service / Professional (`provider`) listing is portal-managed and has no owner (RBAC-D): the owner API refuses
// it for everyone (see the refusal test below). The Tutor is the closest OWNED analogue — a name, one category,
// area-only by default — so it is the generic fixture of these field-rule tests.
const tutorBody = (over: Record<string, unknown> = {}) => ({
  kind: "tutor",
  name: "Imran Physics Tutor",
  category: "physics",
  grade: "Matric / A-Levels",
  description: "Physics lessons for matric and A-level students across B-17.",
  area: "B-17",
  tags: ["physics", "lessons"],
  // Listing Contact v1: a new owner listing must say how customers reach it.
  contactPhone: "03001234567",
  location,
  ...over,
})
const providerBody = (over: Record<string, unknown> = {}) => ({ ...tutorBody(), kind: "provider", ...over })
// Every owned kind is quota-countable (a Provider is not owned by anyone, so it never occupies a slot).
const businessBody = (over: Record<string, unknown> = {}) => ({
  kind: "business",
  vertical: "general",
  name: "Capital Stationers",
  category: "stationery",
  description: "Books, printing and school supplies for B-17 homes.",
  area: "B-17",
  tags: ["books", "copies"],
  contactPhone: "03001234567",
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
    const reply = create(tutorBody())
    expect(statusOf(reply)).toBe(201)
    expect(dataOf<{ area: string }>(reply).area).toBe("B-17")
  })

  it.each(["Islamabad", "B-17 Block C", "B-17, Block C", "F-7"])("refuses area %j as unknown_locality", (area) => {
    const reply = create(tutorBody({ area }))
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toContain("area:unknown_locality")
  })

  it("an EMPTY area never reaches the locality check: the request model refuses it first (string_too_short)", () => {
    const reply = create(tutorBody({ area: "" }))
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toEqual(["area:string_too_short"])
  })

  it("matches the locality like the API does: case-insensitively, whitespace collapsed, stored as B-17", () => {
    const reply = create(tutorBody({ area: "  b-17 " }))
    expect(statusOf(reply)).toBe(201)
    expect(dataOf<{ area: string }>(reply).area).toBe("B-17")
  })

  it("refuses more than 20 tags (too_long) and a tag over 40 characters (string_too_long)", () => {
    const many = create(tutorBody({ tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }))
    expect(detailsOf(many)).toContain("tags:too_long")
    const long = create(tutorBody({ tags: ["x".repeat(41)] }))
    expect(detailsOf(long)).toContain("tags.0:string_too_long")
    expect(statusOf(create(tutorBody({ tags: Array.from({ length: 20 }, (_, i) => `tag${i}`) })))).toBe(201)
  })

  it("refuses a block outside the allowed characters (invalid_format) or over 40 characters (string_too_long)", () => {
    expect(detailsOf(create(tutorBody({ location: { visibility: "area_only", block: "C <b>" } })))).toContain("location.block:invalid_format")
    expect(detailsOf(create(tutorBody({ location: { visibility: "area_only", block: "C".repeat(41) } })))).toContain("location.block:string_too_long")
    expect(statusOf(create(tutorBody({ location: { visibility: "area_only", block: "Block C-2/1." } })))).toBe(201)
  })

  it("refuses a short name or description, and a missing description, all in one aggregated answer", () => {
    const reply = create(tutorBody({ name: "X", description: "too short" }))
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toEqual(expect.arrayContaining(["name:string_too_short", "description:string_too_short"]))
    const { description: _omitted, ...withoutDescription } = tutorBody()
    expect(detailsOf(create(withoutDescription))).toContain("description:missing")
  })

  it("refuses an image that is not an https address or a site path (uploads do not exist yet)", () => {
    expect(detailsOf(create(tutorBody({ image: "blob:http://localhost/abc" })))).toContain("image:invalid_media_reference")
    expect(detailsOf(create(tutorBody({ image: "data:image/png;base64,AAAA" })))).toContain("image:invalid_media_reference")
    expect(statusOf(create(tutorBody({ image: "https://cdn.example.com/a.jpg" })))).toBe(201)
  })

  it("a property cannot be area_only (not_allowed), as on the real API", () => {
    const reply = create({ kind: "property", title: "Corner house", listingType: "rent", propertyType: "house", price: "PKR 1", description: "A bright, well-kept home in a quiet block.", area: "B-17", location })
    expect(detailsOf(reply)).toContain("location.visibility:not_allowed")
  })

  it("a PATCH is held to the same rules, and a refused PATCH changes nothing", () => {
    const id = dataOf<{ id: string }>(create(tutorBody())).id
    const before = JSON.stringify(writeState().listings.find((l) => l.id === id))
    const reply = routeWrite("PATCH", `/listings/${id}`, { revision: 1, area: "Islamabad" }, owner)
    expect(statusOf(reply)).toBe(422)
    expect(detailsOf(reply)).toContain("area:unknown_locality")
    expect(JSON.stringify(writeState().listings.find((l) => l.id === id))).toBe(before)
  })

  it("a PATCH may clear ONLY image, bedrooms and furnished; any other null is not_nullable (the General-business `food: null` bug)", () => {
    const id = (dataOf<{ id: string }>(create(tutorBody())))!.id
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
    const data = dataOf<{ category: string; categoryLabel: string }>(create(tutorBody({ category: "physics" })))
    expect(data.category).toBe("physics")
    expect(data.categoryLabel).toBe("Physics")
  })
})

describe("mock parity: plan quota and rate limits", () => {
  it("the Free plan allows 3 active listings: the fixtures hold 2, so one more fits and the next is plan_limit_reached", () => {
    // Fixture state: 1 pending business + 1 approved tutor (both the owner's, both active) + 1 rejected
    // property + 1 archived tutor (neither active). A Service / Professional is portal-managed and has no
    // owner (RBAC-D), so it can never be one of these — every owned kind counts. One more fits, the next
    // is refused as plan_limit_reached.
    expect(statusOf(create(businessBody({ name: "Pending Stationers Two" })))).toBe(201)
    const fourth = create(businessBody({ name: "Pending Stationers Three" }))
    expect(statusOf(fourth)).toBe(403)
    expect(errorOf(fourth).code).toBe("plan_limit_reached")
  })

  it("a Service / Professional listing is refused for EVERYONE (RBAC-D): portal-managed, no owner, authored by staff", () => {
    // The owner API never creates a Provider — an admin included. The real answer is 403 forbidden with the detail code
    // `provider_admin_only`, and nothing is written and no slot or rate-limit allowance is used.
    const before = writeState().listings.length
    for (const me of [owner, premium, { ...owner, roles: ["admin", "professional"] }]) {
      const reply = create(providerBody({ name: "Portal Service" }), me)
      expect(statusOf(reply)).toBe(403)
      expect(errorOf(reply).code).toBe("forbidden")
      expect(detailsOf(reply)).toContain("kind:provider_admin_only")
    }
    expect(writeState().listings).toHaveLength(before)
    // ...and the refusals used no slot: the Free plan's one remaining slot is still there, the next is refused.
    expect(statusOf(create(businessBody({ name: "Pending Stationers Two" })))).toBe(201)
    expect(errorOf(create(businessBody({ name: "Pending Stationers Three" }))).code).toBe("plan_limit_reached")
  })

  it("Premium is unlimited", () => {
    for (let i = 0; i < 6; i += 1) expect(statusOf(create(tutorBody({ name: `Premium listing ${i}` }), premium))).toBe(201)
  })

  it("archiving frees a Free slot", () => {
    // Fixtures hold 2 active listings; one more business reaches the Free plan's 3-slot limit,
    // the next is refused, and archiving it frees the slot again.
    const first = dataOf<{ id: string; revision: number }>(create(businessBody({ name: "Second Shop" })))
    expect(statusOf(create(businessBody({ name: "Over the limit" })))).toBe(403)
    expect(statusOf(routeWrite("POST", `/listings/${first.id}/archive`, { revision: first.revision }, owner))).toBe(200)
    expect(statusOf(create(businessBody({ name: "After archiving" })))).toBe(201)
  })

  it("resubmitting a REJECTED listing needs a free slot, and a refused resubmission changes nothing", () => {
    // The rejected fixture is a property. Reach the Free plan's 3-slot limit with one extra business
    // (the fixtures hold 2 active listings already), then PATCH the rejected property — the
    // resubmission re-enters the quota and is refused with plan_limit_reached; the row is untouched.
    const rejectedId = writeState().listings.find((l) => l.status === "rejected")!.id
    expect(statusOf(create(businessBody({ name: "Pending Stationers Two" })))).toBe(201)
    const before = JSON.stringify(writeState().listings.find((l) => l.id === rejectedId))
    const reply = routeWrite("PATCH", `/listings/${rejectedId}`, { revision: 1, description: "A new description that is long enough to be a real change." }, owner)
    expect(statusOf(reply)).toBe(403)
    expect(errorOf(reply).code).toBe("plan_limit_reached")
    expect(JSON.stringify(writeState().listings.find((l) => l.id === rejectedId))).toBe(before)
  })

  it("listing creation is limited to 10 per user per hour (429 rate_limited), and a refused request uses no slot", () => {
    for (let i = 0; i < 10; i += 1) expect(statusOf(create(tutorBody({ name: `Rapid ${i}` }), premium))).toBe(201)
    const eleventh = create(tutorBody({ name: "Rapid 11" }), premium)
    expect(statusOf(eleventh)).toBe(429)
    expect(errorOf(eleventh).code).toBe("rate_limited")
    expect(statusOf(create(tutorBody({ name: "Other person" }), { ...premium, email: "other@example.com" }))).toBe(201)
  })
})

describe("mock parity: service requests", () => {
  // The Providers are portal-managed (RBAC-D): they have no owner, so they are not in anyone's own listings — they are
  // the public fixtures every signed-in resident can request.
  const approvedProviderId = () => PROVIDERS[0].id
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
    // Six approved Providers (portal-managed, so seeded straight into the mock state rather than created by an owner).
    const template = writeState().listings.find((l) => l.status === "approved")!
    const providers = Array.from({ length: 6 }, (_, i) => {
      const id = `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`
      writeState().listings.push({ ...template, id, kind: "provider", name: `Provider number ${i}`, status: "approved" } as never)
      return id
    })
    for (const id of providers.slice(0, 5)) expect(statusOf(send(requestBody({ providerListingId: id })))).toBe(201)
    expect(statusOf(send(requestBody({ providerListingId: providers[5] })))).toBe(429)
  })

  it("there is no \"own listing\" refusal any more: nobody owns a Provider, a request is addressed to the portal", () => {
    // Whoever the caller is — an owner of other listings, a Premium professional — the request is created.
    expect(statusOf(send(requestBody(), { ...premium, emailVerified: true }))).toBe(201)
    expect(statusOf(send(requestBody({ providerListingId: PROVIDERS[1].id }), owner))).toBe(201)
  })

  // -- Authority and lifecycle parity (RBAC-D): the requester API is requester-only ------------------------------------
  // `/requests/{id}/{action}` is the REQUESTER's API. accept / start / complete are provider-side transitions that, for
  // a portal-managed Provider, only portal staff (a Super Admin, or a Moderator with the live `services` scope) perform
  // through `/admin/requests`. The mock has no staff session and invents none inside an ordinary session.
  //
  // The REAL requester-cancel rule (`request_rules.SOURCES`, API_CONTRACT §13):
  //   submitted | accepted -> cancelled   (requester)      in-progress, completed, cancelled -> 409 invalid_state_transition
  // (only staff may cancel an in-progress request). The mock copies it exactly.
  describe("an ordinary requester cannot execute provider / staff transitions, and cancels only where the real API lets them", () => {
    const transition = (id: string, action: string, me = requester) => routeWrite("POST", `/requests/${id}/${action}`, {}, me)
    const sentId = () => dataOf<{ id: string }>(send(requestBody())).id
    /** A request that staff have (outside the mock) advanced to `status`: the mirror of what the real API would hold. */
    const requestAt = (status: string) => {
      const id = sentId()
      for (const list of [writeState().myRequests, writeState().leads]) {
        const row = list.find((r) => r.id === id)
        if (row) row.status = status as typeof row.status
      }
      return id
    }
    const statusOfRequest = (id: string) => writeState().myRequests.find((r) => r.id === id)!.status
    const snapshot = (id: string) => JSON.stringify([writeState().myRequests, writeState().leads, writeState().history[id]])

    it.each(["accept", "start", "complete"])("%s is 403 forbidden, and nothing changes", (action) => {
      const id = sentId()
      const before = snapshot(id)
      const reply = transition(id, action)
      expect(statusOf(reply)).toBe(403)
      expect(errorOf(reply).code).toBe("forbidden")
      expect(statusOfRequest(id)).toBe("submitted")
      expect(snapshot(id)).toBe(before)
    })

    it.each(["submitted", "accepted", "in-progress", "completed", "cancelled"])(
      "accept / start / complete are 403 for a requester whatever the status (%s): authority is checked before any state",
      (status) => {
        const id = requestAt(status)
        const before = snapshot(id)
        for (const action of ["accept", "start", "complete"]) {
          const reply = transition(id, action)
          expect(statusOf(reply), `${status} ${action}`).toBe(403)
          expect(errorOf(reply).code).toBe("forbidden")
        }
        expect(snapshot(id)).toBe(before)
      },
    )

    it("an unknown id is 404 for every action (not found comes before forbidden)", () => {
      for (const action of ["accept", "start", "complete", "cancel"]) {
        expect(statusOf(transition("00000000-0000-4000-8000-0000000000aa", action)), action).toBe(404)
      }
    })

    it.each([
      ["submitted", 200],
      ["accepted", 200],
      ["in-progress", 409],
      ["completed", 409],
      ["cancelled", 409],
    ])("a requester's cancel from %s is %i (the real lifecycle: only submitted and accepted)", (status, expected) => {
      const id = requestAt(status)
      const reply = transition(id, "cancel")
      expect(statusOf(reply)).toBe(expected)
      if (expected === 200) {
        expect(dataOf<{ status: string; viewerRole: string }>(reply)).toMatchObject({ status: "cancelled", viewerRole: "requester" })
        expect(statusOfRequest(id)).toBe("cancelled")
        expect(writeState().history[id]!.at(-1)).toMatchObject({ fromStatus: status, toStatus: "cancelled", actorRole: "requester" })
      } else {
        expect(errorOf(reply).code).toBe("invalid_state_transition")
      }
    })

    it.each(["in-progress", "completed", "cancelled"])("a refused cancel from %s changes nothing: no status, history or lead mutation", (status) => {
      const id = requestAt(status)
      const before = snapshot(id)
      const reply = transition(id, "cancel")
      expect(statusOf(reply)).toBe(409)
      expect(errorOf(reply).code).toBe("invalid_state_transition")
      expect(statusOfRequest(id)).toBe(status)
      expect(writeState().leads.find((r) => r.id === id)?.status).toBe(status)
      expect(snapshot(id)).toBe(before)
    })

    it("the second cancel of the same request follows the real API: 409 invalid_state_transition, one history entry only", () => {
      const id = sentId()
      expect(statusOf(transition(id, "cancel"))).toBe(200)
      const afterFirst = snapshot(id)
      const second = transition(id, "cancel")
      expect(statusOf(second)).toBe(409)
      expect(errorOf(second).code).toBe("invalid_state_transition")
      expect(snapshot(id)).toBe(afterFirst)
      expect(writeState().history[id]!.filter((h) => h.toStatus === "cancelled")).toHaveLength(1)
    })

    it("create and read are unchanged: a created request is submitted, listed for its requester, and cancels from there", () => {
      const id = sentId()
      expect(statusOfRequest(id)).toBe("submitted")
      expect(writeState().history[id]).toEqual([expect.objectContaining({ toStatus: "submitted", actorRole: "requester" })])
      expect(statusOf(transition(id, "cancel"))).toBe(200)
    })
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
    const live = writeState().listings.find((l) => l.status === "approved")!
    expect(statusOf(reject(live.id, live.revision))).toBe(200)
    expect(stored(live.id)).toMatchObject({ status: "rejected", takenDown: true, rejectionReason: reason })

    const edited = routeWrite("PATCH", `/listings/${live.id}`, { revision: live.revision, description: "Open again, with a longer description of the work." }, owner)
    expect(statusOf(edited)).toBe(200)
    expect(stored(live.id).status).toBe("pending")
    expect(stored(live.id).takenDown).toBeUndefined()
    expect(stored(live.id).rejectionReason).toBeUndefined()
  })
})
