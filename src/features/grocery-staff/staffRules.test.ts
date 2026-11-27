import { describe, expect, it } from "vitest"
import { MAX_FIELD_PAISA, amountProblem, paisaToInput, parsePkr } from "@/features/grocery-staff/money"
import {
  DEFAULT_FILTERS,
  filterSearch,
  queueParams,
  readFilters,
  referenceProblem,
} from "@/features/grocery-staff/queueFilters"
import { isLostAccess, isOwnOrder, isStaleOrder, isUnknownOutcome, needsSuperAdmin, staffRefusalCopy } from "@/features/grocery-staff/staffErrors"
import { actionNotes, assignmentLabel, memberName } from "@/features/grocery-staff/staffLabels"
import { canWorkGroceryOrders } from "@/lib/staffAccess"
import { ApiError } from "@/lib/api/errors"
import type { GroceryStaffOrderDetailDto } from "@/lib/api/dto/groceryStaff"

const error = (status: number, code: string, details: { field?: string; code?: string }[] = []) =>
  new ApiError({ status, code, message: "RAW SERVER TEXT", details })

describe("rupees typed by staff become whole paisa on the digits alone", () => {
  it.each([
    ["1850", 185_000],
    ["1,850", 185_000],
    ["1850.5", 185_050],
    ["1850.05", 185_005],
    ["0.29", 29],
    ["0.57", 57],
    ["1.15", 115],
    ["4.35", 435],
    ["19999.99", 1_999_999],
    ["  20,000 ", 2_000_000],
    ["007", 700],
    ["0", 0],
    ["1,000,000", MAX_FIELD_PAISA],
  ])("%s is %i paisa", (text, paisa) => {
    expect(parsePkr(text)).toEqual({ ok: true, paisa })
  })

  it("every amount up to Rs 100 with paisa converts exactly, and back", () => {
    for (let paisa = 0; paisa <= 10_000; paisa += 1) {
      expect(parsePkr(paisaToInput(paisa))).toEqual({ ok: true, paisa })
    }
  })

  it.each(["1,5", "1,85", "18,50.00", "-1", "+1", "1.234", "1.", ".5", "1e3", "Rs 5", "1 850", "NaN", "Infinity", "١٢"])(
    "%s is refused, not guessed at",
    (text) => {
      expect(parsePkr(text)).toEqual({ ok: false, problem: "format" })
    }
  )

  it("refuses more than the API's field bound", () => {
    expect(parsePkr("1000000.01")).toEqual({ ok: false, problem: "too_large" })
    expect(parsePkr("99999999999999999999")).toEqual({ ok: false, problem: "too_large" })
  })

  it("only a fee may be zero", () => {
    expect(amountProblem("0", { allowZero: true })).toBeNull()
    expect(amountProblem("0", { allowZero: false })).toMatch(/more than 0/)
    expect(amountProblem("", { allowZero: false })).toBe("Enter an amount.")
    expect(amountProblem("", { allowZero: true })).toMatch(/or 0 if there is none/)
  })
})

describe("queue filters in the address", () => {
  it("default to the waiting work: new orders, oldest first, page 1", () => {
    expect(readFilters(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS)
    expect(filterSearch(DEFAULT_FILTERS)).toBe("")
    expect(queueParams(DEFAULT_FILTERS)).toEqual({ status: "submitted", sort: "oldest", limit: 12, offset: 0 })
  })

  it("map to exactly the API's parameters", () => {
    const filters = readFilters(new URLSearchParams("status=all&ref=GRC-AB2&on=2026-11-27&by=me&sort=newest&page=3"))
    expect(queueParams(filters)).toEqual({
      reference: "GRC-AB2",
      submittedOn: "2026-11-27",
      assigned: "me",
      sort: "newest",
      limit: 12,
      offset: 24,
    })
    expect(readFilters(new URLSearchParams(filterSearch(filters)))).toEqual(filters)
  })

  it("ignores anything the API would refuse", () => {
    const filters = readFilters(new URLSearchParams("status=lost&ref=ab&on=yesterday&by=everyone&sort=random&page=-2"))
    expect(filters).toEqual(DEFAULT_FILTERS)
    expect(readFilters(new URLSearchParams("page=999999999")).page).toBe(1)
    expect(readFilters(new URLSearchParams("by=11111111-1111-4111-8111-111111111111")).assigned).toBe(
      "11111111-1111-4111-8111-111111111111"
    )
  })

  it("checks a reference the way the API does", () => {
    expect(referenceProblem("")).toBeNull()
    expect(referenceProblem("ab")).toMatch(/3 to 16/)
    expect(referenceProblem("a".repeat(17))).toMatch(/3 to 16/)
    expect(referenceProblem("my name!")).toMatch(/letters, numbers/)
    expect(referenceProblem("grc-7kq")).toBeNull()
  })
})

describe("who may work grocery orders", () => {
  it.each([
    [["admin"], [], true],
    [["moderator"], ["grocery"], true],
    [["moderator"], ["food", "grocery"], true],
    [["moderator"], ["food", "services", "directory", "education", "property", "news"], false],
    [["moderator"], [], false], // paused
    [[], ["grocery"], false], // a scope without the role is nothing
    [[], [], false],
  ] as const)("roles %j with scopes %j: %s", (roles, staffScopes, expected) => {
    expect(canWorkGroceryOrders({ roles: [...roles], staffScopes: [...staffScopes] })).toBe(expected)
  })

  it("nobody signed in cannot", () => {
    expect(canWorkGroceryOrders(null)).toBe(false)
  })
})

describe("what a failed staff request means", () => {
  it("an unknown outcome is no answer, an unreadable one, or a server failure", () => {
    expect(isUnknownOutcome(error(0, "network_error"))).toBe(true)
    expect(isUnknownOutcome(error(200, "invalid_response"))).toBe(true)
    expect(isUnknownOutcome(error(500, "internal_error"))).toBe(true)
    expect(isUnknownOutcome(error(502, "http_502"))).toBe(true)
    expect(isUnknownOutcome(new DOMException("aborted", "AbortError"))).toBe(true)
    expect(isUnknownOutcome(error(503, "grocery_unavailable"))).toBe(false)
    for (const status of [401, 403, 404, 409, 422, 429]) expect(isUnknownOutcome(error(status, "x"))).toBe(false)
  })

  it("separates the kinds of 403", () => {
    const own = error(403, "forbidden", [{ field: "order", code: "own_order" }])
    const superOnly = error(403, "forbidden", [{ field: "order", code: "super_admin_required" }])
    const lost = error(403, "forbidden")
    expect([isOwnOrder(own), isLostAccess(own)]).toEqual([true, false])
    expect([needsSuperAdmin(superOnly), isLostAccess(superOnly)]).toEqual([true, false])
    expect(isLostAccess(lost)).toBe(true)
    expect(isLostAccess(error(403, "email_not_verified"))).toBe(true)
    expect(isLostAccess(error(403, "csrf_failed"))).toBe(false)
  })

  it("knows when the order on screen is behind", () => {
    for (const code of ["order_conflict", "invalid_state_transition", "order_already_claimed", "order_not_claimed"]) {
      expect(isStaleOrder(error(409, code))).toBe(true)
    }
    expect(isStaleOrder(error(422, "validation_error"))).toBe(false)
  })

  it.each([
    [422, "validation_error", [{ field: "agreedTotalPaisa", code: "exceeds_order_limit" }], /above the largest order allowed/],
    [422, "validation_error", [{ field: "agreedTotalPaisa", code: "total_mismatch" }], /doesn't equal/],
    [422, "validation_error", [{ field: "finalAmountPaisa", code: "not_a_reduction" }], /less than the amount now due/],
    [422, "validation_error", [{ field: "amountCollectedPaisa", code: "amount_mismatch" }], /Part payment can't be recorded/],
    [422, "validation_error", [{ field: "consentNote", code: "substitution_note_required" }], /which substitutes/],
    [422, "validation_error", [{ field: "consentNote", code: "missing" }], /agreed to is required/],
    [422, "validation_error", [{ field: "reason", code: "string_too_long" }], /reason is too long/],
    [409, "order_already_claimed", [], /Nothing changed for you/],
    [429, "rate_limited", [], /Wait a few minutes/],
    [403, "csrf_failed", [], /nothing was sent again/],
    [503, "grocery_unavailable", [], /Nothing was saved/],
    [418, "never_heard_of_it", [], /refused the request/],
  ] as const)("explains %i %s from its codes, never from the server's text", (status, code, details, expected) => {
    const copy = staffRefusalCopy(error(status, code, [...details]))
    expect(`${copy.title} ${copy.description}`).toMatch(expected)
    expect(`${copy.title} ${copy.description}`).not.toContain("RAW SERVER TEXT")
  })
})

describe("assignment wording", () => {
  const me = "me-id"
  const order = (status: string, assignee?: { userId: string; displayName?: string }) =>
    ({ status, assignee }) as unknown as GroceryStaffOrderDetailDto

  it("names who holds an order", () => {
    expect(assignmentLabel(undefined, me)).toBe("Unassigned")
    expect(assignmentLabel({ userId: me, displayName: "Me" }, me)).toBe("Assigned to you")
    expect(assignmentLabel({ userId: "x", displayName: "Bilal" }, me)).toBe("Assigned to Bilal")
    expect(assignmentLabel({ userId: "x" }, me)).toBe("Assigned to another staff member")
    expect(memberName({ userId: me }, me)).toBe("You")
    expect(memberName(undefined, me)).toBe("A staff member")
  })

  it("explains the rules behind what is missing", () => {
    expect(actionNotes(order("submitted"), me, false)[0]).toMatch(/Claim this order/)
    expect(actionNotes(order("confirmed", { userId: "x", displayName: "Bilal" }), me, false)).toEqual([
      expect.stringMatching(/^Bilal has this order\. Only they or a Super Admin/),
    ])
    expect(actionNotes(order("confirmed", { userId: "x", displayName: "Bilal" }), me, true)[0]).toMatch(/As Super Admin/)
    expect(actionNotes(order("preparing", { userId: me }), me, false).join(" ")).toMatch(/Only a Super Admin can cancel/)
    expect(actionNotes(order("preparing", { userId: me }), me, true)).toEqual([])
    expect(actionNotes(order("out_for_delivery", { userId: me }), me, false).join(" ")).toMatch(/first record this delivery as failed/)
    expect(actionNotes(order("delivered"), me, false)).toEqual(["This order is finished. You can still record an issue."])
  })
})
