import { describe, expect, it } from "vitest"
import { isBehindStaff, needsRecentSignIn, staffAdminRefusal, STAFF_CHANGED } from "@/features/staff-management/staffAdminErrors"
import {
  ASSIGNABLE_SCOPES,
  SCOPE_INFO,
  accessSummary,
  auditActor,
  auditState,
  auditTitle,
  endedSessions,
  sameAccess,
} from "@/features/staff-management/staffLabels"
import { ApiError } from "@/lib/api/errors"
import type { StaffAuditEntryDto, StaffMemberDto } from "@/lib/api/dto/staffAdmin"

const member = (change: Partial<StaffMemberDto> = {}): StaffMemberDto => ({
  userId: "u1",
  displayName: "Sana",
  email: "sana@example.org",
  role: "moderator",
  scopes: ["grocery"],
  paused: false,
  accountStatus: "active",
  emailVerified: true,
  grantedAt: "2026-11-20T06:00:00Z",
  ...change,
})

const error = (status: number, code: string, detail?: string) =>
  new ApiError({ status, code, message: "RAW SERVER TEXT", details: detail ? [{ field: "x", code: detail }] : [] })

describe("scopes", () => {
  it("offers exactly the six assignable ones; news is reserved and never offered", () => {
    expect(ASSIGNABLE_SCOPES).toEqual(["grocery", "services", "directory", "food", "education", "property"])
    expect(ASSIGNABLE_SCOPES).not.toContain("news")
    expect(SCOPE_INFO.news.covers).toMatch(/grants nothing/)
  })

  it("only grocery has a moderator screen, and says it grants nothing about listings", () => {
    expect(ASSIGNABLE_SCOPES.filter((scope) => SCOPE_INFO[scope].hasScreen)).toEqual(["grocery"])
    expect(SCOPE_INFO.grocery.covers).toMatch(/Nothing about listings/)
  })
})

describe("effective access is not the same as an assigned scope", () => {
  it.each([
    [member(), "Moderator for: Grocery orders."],
    [member({ scopes: [], paused: true }), "Paused: no staff access."],
    [member({ accountStatus: "suspended" }), "Account suspended: no staff access."],
    [member({ emailVerified: false }), "Email not verified: no staff access."],
    [member({ role: "admin", scopes: [] }), "Full staff access as Super Admin."],
    [member({ role: "admin", scopes: [], accountStatus: "deleted" }), "Account deleted: no staff access."],
  ])("%o", (who, summary) => {
    expect(accessSummary(who)).toBe(summary)
  })

  it("a change of role, scopes, pause or account state is a change of access; a name is not", () => {
    const shown = member({ scopes: ["food", "grocery"] })
    expect(sameAccess(shown, member({ scopes: ["grocery", "food"], displayName: "Other" }))).toBe(true)
    for (const change of [{ scopes: ["food"] }, { paused: true }, { role: "admin" }, { accountStatus: "suspended" }, { emailVerified: false }]) {
      expect(sameAccess(shown, member({ scopes: ["food", "grocery"], ...(change as Partial<StaffMemberDto>) }))).toBe(false)
    }
  })
})

describe("staff refusals", () => {
  it("separates a stale sign-in from lost access, an expired session and a bad request", () => {
    expect(needsRecentSignIn(error(403, "forbidden", "sensitive_reauth_required"))).toBe(true)
    for (const other of [error(403, "forbidden"), error(401, "session_expired"), error(403, "csrf_failed"), error(422, "validation_error", "target_not_eligible")]) {
      expect(needsRecentSignIn(other)).toBe(false)
    }
  })

  it("knows when the person on screen is behind", () => {
    for (const code of ["moderator_paused", "moderator_not_paused", "moderator_already_paused", "moderator_not_found"]) {
      expect(isBehindStaff(error(409, "conflict", code))).toBe(true)
    }
    expect(isBehindStaff(error(409, STAFF_CHANGED))).toBe(true)
    expect(isBehindStaff(error(409, "conflict", "already_moderator"))).toBe(false)
  })

  it.each([
    [error(422, "validation_error", "target_not_eligible"), /doesn't say which/],
    [error(409, "conflict", "already_moderator"), /already a moderator/],
    [error(403, "forbidden", "super_admin_target_forbidden"), /command line/],
    [error(422, "validation_error", "invalid_staff_scope"), /pause the moderator/],
    [error(409, "conflict", "moderator_not_paused"), /isn't paused/],
    [error(404, "not_found", "moderator_not_found"), /no longer a moderator/],
    [error(429, "rate_limited"), /Refused attempts count too/],
    [error(403, "csrf_failed"), /nothing was sent again/],
    [error(0, "network_error"), /Nothing was sent/],
    [error(409, STAFF_CHANGED), /Nothing was sent/],
    [error(418, "unheard_of"), /refused the change/],
  ])("explains %o from its codes only", (refusal, expected) => {
    const copy = staffAdminRefusal(refusal)
    expect(`${copy.title} ${copy.description}`).toMatch(expected)
    expect(`${copy.title} ${copy.description}`).not.toContain("RAW SERVER TEXT")
  })
})

describe("the audit, as recorded", () => {
  const entry = (change: Partial<StaffAuditEntryDto>): StaffAuditEntryDto => ({
    id: "a",
    occurredAt: "2026-11-27T08:00:00Z",
    source: "web",
    action: "scope_granted",
    ...change,
  })

  it("never infers an actor", () => {
    expect(auditActor(entry({ actor: { userId: "1", displayName: "Omar" } }))).toBe("Omar")
    expect(auditActor(entry({ actor: { userId: "1" } }))).toBe("An account whose name is no longer available")
    expect(auditActor(entry({ source: "cli" }))).toBe("Server operator (command line)")
    expect(auditActor(entry({ source: "web" }))).toBe("Not recorded")
  })

  it("calls scopes given to a paused moderator a resume", () => {
    expect(auditTitle(entry({ before: { paused: true }, after: { paused: false } }))).toBe("Moderator resumed")
    expect(auditTitle(entry({ before: { paused: false }, after: { paused: false } }))).toBe("Scopes given")
  })

  it("shows only the state keys it understands, never a dump of the payload", () => {
    expect(auditState({ role: "moderator", scopes: ["food"], paused: false, request_id: "x", internal: "y" })).toBe("Moderator, scopes: Food")
    expect(auditState({ role: "moderator", scopes: [], paused: true })).toBe("Moderator, scopes: None, paused")
    expect(auditState({ role: null, scopes: [] })).toBe("No staff role")
    expect(auditState({ revision: 3 })).toBeNull()
    expect(endedSessions({ sessions_revoked: 2 })).toBe("2 sessions ended.")
    expect(endedSessions({})).toBeNull()
  })
})
