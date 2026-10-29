import { describe, expect, it } from "vitest"
import { listingQuota } from "@/features/provider/listingQuota"

const counts = (pending: number, approved: number, rejected = 0, archived = 0) => ({ pending, approved, rejected, archived })

describe("listingQuota (the browser's best knowledge of the plan limit; the server decides)", () => {
  it("is full exactly at the limit: pending and approved count, rejected and archived do not", () => {
    expect(listingQuota(3, counts(2, 1))).toEqual({ state: "full", used: 3, max: 3 })
    expect(listingQuota(3, counts(1, 1, 5, 5))).toEqual({ state: "open", used: 2, max: 3 })
    expect(listingQuota(3, counts(0, 0, 9, 9))).toEqual({ state: "open", used: 0, max: 3 })
  })

  it("still reads as full if the account somehow holds more than the limit (never 'open')", () => {
    expect(listingQuota(3, counts(3, 2))).toMatchObject({ state: "full", used: 5, max: 3 })
  })

  it("claims nothing when the counts are not known - the server decides", () => {
    expect(listingQuota(3, undefined)).toEqual({ state: "unknown" })
  })

  it("has no limit on a plan without one (Premium), whatever the counts are", () => {
    expect(listingQuota(null, counts(40, 40))).toEqual({ state: "unlimited" })
    expect(listingQuota(null, undefined)).toEqual({ state: "unlimited" })
  })
})
