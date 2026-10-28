import { describe, expect, it } from "vitest"
import { requestDateBounds, serviceRequestSchema } from "@/features/services/serviceRequestSchema"
import { NOT_PLAIN_TEXT } from "@/features/provider/textRules"
import { validateRequestBody } from "@/test/fixtures/listingRules"

const day = (offset: number) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const valid = {
  service: "Plumbing",
  details: "A tap is leaking in the kitchen sink.",
  area: "B-17, Block C",
  preferredDate: day(2),
  preferredContactChannel: "phone" as const,
}
const messages = (input: Record<string, unknown>) => {
  const result = serviceRequestSchema.safeParse({ ...valid, ...input })
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe("serviceRequestSchema preferredDate (S4: the API's own window, checked before the round trip)", () => {
  it("today and the next 365 days are accepted", () => {
    expect(messages({ preferredDate: day(0) })).toEqual([])
    expect(messages({ preferredDate: day(365) })).toEqual([])
  })

  it("yesterday is refused in plain words, as the API's in_the_past", () => {
    expect(messages({ preferredDate: day(-1) })).toEqual(["Choose today or a later date."])
  })

  it("beyond 365 days is refused, as the API's too_far_ahead", () => {
    expect(messages({ preferredDate: day(366) })).toEqual(["Choose a date within the next 365 days."])
  })

  it("requestDateBounds is computed from the clock it is given (a tab left open overnight gets a new 'today')", () => {
    expect(requestDateBounds(new Date("2026-10-26T10:00:00Z"))).toEqual({ min: "2026-10-26", max: "2027-10-26" })
    expect(requestDateBounds(new Date("2026-10-27T00:30:00Z")).min).toBe("2026-10-27")
  })

  it("an empty date still asks for one", () => {
    expect(messages({ preferredDate: "" })).toEqual(["Please choose a preferred date."])
  })
})

describe("serviceRequestSchema: the requester's area stays free text (the contract's 2-80 characters), unlike a listing's Area", () => {
  it("accepts 'B-17, Block C' and rejects one character", () => {
    expect(messages({ area: "B-17, Block C" })).toEqual([])
    expect(messages({ area: "x" })).toEqual(["Please enter your area or location."])
  })
})

describe("the request form and the API's request model agree at every boundary", () => {
  const NBSP = " "
  /** One value through the form's schema and through the mock server's request rules (written from the backend). */
  const both = (over: Record<string, unknown>) => {
    const body = { ...valid, ...over }
    return { client: serviceRequestSchema.safeParse(body).success, server: validateRequestBody({ providerListingId: "p-1", ...body }).length === 0 }
  }
  const text = (n: number) => "x".repeat(n)

  it.each([
    ["details 10", { details: text(10) }, true],
    ["details 9", { details: text(9) }, false],
    ["details 500", { details: text(500) }, true],
    ["details 501", { details: text(501) }, false],
    ["details with a line break", { details: "A tap is leaking.\nIn the kitchen sink." }, true],
    ["details with a non-breaking space", { details: `A tap is${NBSP}leaking in the kitchen.` }, false],
    ["area 2", { area: "B7" }, true],
    ["area 1", { area: "B" }, false],
    ["area 80", { area: text(80) }, true],
    ["area 81", { area: text(81) }, false],
    ["area on two lines", { area: "B-17\nBlock C" }, false],
    ["notes 500", { notes: text(500) }, true],
    ["notes 501", { notes: text(501) }, false],
    ["notes with a non-breaking space", { notes: `Ring${NBSP}the bell` }, false],
    ["today", { preferredDate: day(0) }, true],
    ["365 days ahead", { preferredDate: day(365) }, true],
    ["366 days ahead", { preferredDate: day(366) }, false],
    ["yesterday", { preferredDate: day(-1) }, false],
  ] as const)("%s", (_, over, ok) => {
    expect(both(over as Record<string, unknown>)).toEqual({ client: ok, server: ok })
  })

  it("a hidden character gets the plain-text message in the form", () => {
    expect(messages({ details: `A tap is${NBSP}leaking in the kitchen.` })).toEqual([NOT_PLAIN_TEXT])
  })

  it("the server also refuses what the form never sends: an unknown key, a malformed time, an unknown contact preference", () => {
    const codes = (body: Record<string, unknown>) => validateRequestBody({ providerListingId: "p-1", ...valid, ...body }).map((p) => `${p.field}:${p.code}`)
    expect(codes({ status: "accepted" })).toEqual(["status:not_allowed"])
    expect(codes({ preferredTime: "9am" })).toEqual(["preferredTime:invalid_time"])
    expect(codes({ preferredTime: "09:30" })).toEqual([])
    expect(codes({ preferredContactChannel: "sms" })).toEqual(["preferredContactChannel:enum"])
    expect(codes({ preferredDate: "tomorrow" })).toEqual(["preferredDate:invalid_date"])
  })
})
