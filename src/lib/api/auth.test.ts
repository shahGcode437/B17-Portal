import { describe, expect, it } from "vitest"
import { fetchMe, login, normalizeStaffScopes, register } from "@/lib/api/auth"
import { installFetchMock, meBody, ok } from "@/test/apiMock"

/**
 * RBAC-A: `/auth/me` gained an additive `staffScopes` field (docs/backend/AUTH_RBAC.md §27.12). The
 * UI treats it as a UX hint only, so the API layer normalizes it defensively: a missing, malformed
 * or forged value can never put a surprise in front of a screen.
 */
describe("normalizeStaffScopes", () => {
  it("keeps canonical scopes, de-duplicated, in canonical order", () => {
    expect(normalizeStaffScopes(["food", "directory", "food"])).toEqual(["directory", "food"])
    expect(normalizeStaffScopes(["news", "services", "property", "education"])).toEqual([
      "services",
      "education",
      "property",
      "news",
    ])
  })

  it("keeps `grocery`, alone or beside listing scopes (GROCERY-1a)", () => {
    expect(normalizeStaffScopes(["grocery"])).toEqual(["grocery"])
    expect(normalizeStaffScopes(["grocery", "food", "services", "grocery"])).toEqual(["services", "food", "grocery"])
  })

  it("accepts only the exact `grocery` value", () => {
    expect(normalizeStaffScopes(["Grocery", "GROCERY", " grocery", "groceries", "grocery_staff"])).toEqual([])
  })

  it("drops anything that is not a canonical scope — including a role name or junk", () => {
    expect(normalizeStaffScopes(["admin", "moderator", "tutor", "*", "", 3, null, {}, "food"])).toEqual(["food"])
  })

  it.each([undefined, null, "food", 3, {}, true])("treats a non-array (%s) as no scopes", (value) => {
    expect(normalizeStaffScopes(value)).toEqual([])
  })
})

describe("the auth API normalizes staffScopes on every user-bearing response", () => {
  it("fetchMe: an older backend or a mock without the field yields []", async () => {
    const { staffScopes: _omitted, ...withoutScopes } = meBody()
    installFetchMock(() => ok(withoutScopes))

    const me = await fetchMe()

    expect(me.staffScopes).toEqual([])
    expect(me.email).toBe("ayesha@example.org") // everything else passes through untouched
  })

  it("fetchMe: a Moderator's scopes arrive sorted and canonical; a forged value is dropped", async () => {
    installFetchMock(() => ok(meBody({ roles: ["moderator"], staffScopes: ["food", "admin", "directory"] })))

    const me = await fetchMe()

    expect(me.roles).toEqual(["moderator"])
    expect(me.staffScopes).toEqual(["directory", "food"])
  })

  it("fetchMe: a Grocery-only Moderator's scope is reported, with no role added to it", async () => {
    installFetchMock(() => ok(meBody({ roles: ["moderator"], staffScopes: ["grocery"] })))

    const me = await fetchMe()

    expect(me.roles).toEqual(["moderator"])
    expect(me.staffScopes).toEqual(["grocery"])
  })

  it("fetchMe: a Super Admin has no scopes — authority is the role", async () => {
    installFetchMock(() => ok(meBody({ roles: ["admin"], staffScopes: [] })))

    const me = await fetchMe()

    expect(me.roles).toEqual(["admin"])
    expect(me.staffScopes).toEqual([])
  })

  it("login and register normalize too", async () => {
    installFetchMock(() => ok(meBody({ staffScopes: ["property", "bogus"] })))

    expect((await login("a@example.org", "pw-long-enough-1")).staffScopes).toEqual(["property"])
    expect(
      (await register({ email: "a@example.org", password: "pw-long-enough-1", displayName: "Aye" })).staffScopes
    ).toEqual(["property"])
  })

  it("register sends only the three allowed fields — never a role or a scope", async () => {
    const { calls } = installFetchMock(() => ok(meBody()))

    await register({ email: "a@example.org", password: "pw-long-enough-1", displayName: "Aye" })

    expect(Object.keys(calls[0].body as object).sort()).toEqual(["displayName", "email", "password"])
  })
})
