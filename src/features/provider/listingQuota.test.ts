import { describe, expect, it } from "vitest"
import { listingQuota } from "@/features/provider/listingQuota"

/**
 * ``activeQuota`` is the server-authoritative, kind-filtered "used" number (pending + approved,
 * EXCLUDING ``provider`` — which is portal-managed and never consumes an owner's slots). The
 * frontend quota math reads that one field. Tests here always pass the whole shape, including an
 * ``activeQuota`` that may differ from ``pending + approved`` so a regression (e.g. silently
 * falling back to ``pending + approved``) would show up as an "open" state where the server would
 * actually have returned "full" / "open" by its own number.
 */
const counts = (
  pending: number,
  approved: number,
  rejected = 0,
  archived = 0,
  activeQuota?: number,
) => ({ pending, approved, rejected, archived, activeQuota: activeQuota ?? pending + approved })

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

  describe("provider listings don't consume the plan quota (`AUTH_RBAC §22.6`)", () => {
    it("reads the server's ``activeQuota`` for 'used', not pending + approved", () => {
      // An admin has 2 pending providers + 3 pending non-providers on a Free plan (max 3): the
      // server's own ``count_active`` reports 3, which is exactly at the limit; pending alone is 5.
      // A regression that summed pending + approved would wrongly claim 5-of-3.
      expect(listingQuota(3, counts(5, 0, 0, 0, 3))).toEqual({ state: "full", used: 3, max: 3 })
    })

    it("stays 'open' when providers push pending + approved past the limit but ``activeQuota`` has slack", () => {
      // An admin with 6 pending providers + 1 approved business + 1 pending business on Free plan.
      // pending + approved = 8 (would be WRONG), activeQuota = 2 (correct).
      expect(listingQuota(3, counts(7, 1, 0, 0, 2))).toEqual({ state: "open", used: 2, max: 3 })
    })

    it("is full when the quota-countable slots are at the limit regardless of provider volume", () => {
      // 12 pending providers + 3 approved businesses on Free plan: activeQuota = 3 of 3.
      expect(listingQuota(3, counts(12, 3, 0, 0, 3))).toEqual({ state: "full", used: 3, max: 3 })
    })

    it("is still unlimited for Premium even with many providers active", () => {
      expect(listingQuota(null, counts(10, 10, 0, 0, 20))).toEqual({ state: "unlimited" })
    })
  })
})
