/**
 * The Super Admin settings and staff-management API as an in-memory object (test helper only;
 * nothing here ships). It follows `backend/app/services/grocery_settings.py`,
 * `staff_authority.py`, `staff_reads.py` and their routes: the order of refusal (401 / 403 →
 * recent sign-in → 429 → 422 body → state), replace-set scopes, an identical set changing nothing,
 * pause / resume rules, sessions ended on every real change, Super Admin targets refused, one
 * answer for every ineligible address, a version check on settings, the staff revision every
 * staff change states (`409 conflict` / `staff_changed`, §39), and the audit rows the server
 * writes. It does not model locking or the session age itself (a test sets
 * `recentSignIn`). CSRF is the transport's job.
 */
import type { GrocerySettingsDto } from "../../lib/api/dto/grocerySettings"
import type { StaffAuditActionDto, StaffAuditEntryDto, StaffMemberDto } from "../../lib/api/dto/staffAdmin"
import type { StaffScope } from "../../types/auth"
import type { GroceryReply } from "./groceryBackend"

export interface DirectoryAccount {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  status: "active" | "suspended" | "deleted"
  roles: string[]
  scopes: StaffScope[]
}

/** The accounts the staff routes act on (the Vitest harness and the browser mock each provide one). */
export interface Directory {
  all(): DirectoryAccount[]
  /** Sets the account's staff role and scopes and ends its sessions; returns how many ended. */
  setStaff(id: string, role: "moderator" | null, scopes: StaffScope[]): number
}

export interface AdminViewer {
  id: string
  displayName: string
  superAdmin: boolean
  emailVerified: boolean
}

type Problem = { field: string; code: string; currentRevision?: number }

const ok = (data: unknown, status = 200): GroceryReply => ({ status, body: { data: JSON.parse(JSON.stringify(data)) } })
const page = (rows: unknown[], limit: number, offset: number): GroceryReply => ({
  status: 200,
  body: { data: JSON.parse(JSON.stringify(rows.slice(offset, offset + limit))), meta: { total: rows.length, limit, offset } },
})
const fail = (status: number, code: string, details: Problem[] = []): GroceryReply => ({
  status,
  body: {
    error: {
      code,
      message: `server text for ${code}`,
      ...(details.length ? { details: details.map((d) => ({ ...d, message: d.code })) } : {}),
      requestId: "req-admin",
    },
  },
})
const invalid = (field: string, code: string) => fail(422, "validation_error", [{ field, code }])

const ASSIGNABLE: StaffScope[] = ["services", "directory", "food", "education", "property", "grocery"]
const ALL_SCOPES: StaffScope[] = [...ASSIGNABLE, "news"]

/** The settings row migrations `0011` / `0012` create: switched off, no serviceable block. */
export function defaultSettings(): GrocerySettingsDto {
  return {
    revision: 1,
    enabled: false,
    serviceableBlocks: [],
    operatingDays: [1, 2, 3, 4, 5, 6, 7],
    opensAt: "10:00",
    closesAt: "20:00",
    timezone: "Asia/Karachi",
    dailyCapacity: 10,
    maxOrderValuePaisa: 2_000_000,
    maxActiveOrdersPerCustomer: 2,
    maxItemsPerOrder: 50,
    paymentMethods: ["cash_on_delivery"],
    coversAllB17: false,
    updatedAt: "2026-11-20T05:00:00Z",
  }
}

const SETTING_KEYS = [
  "enabled", "serviceableBlocks", "operatingDays", "opensAt", "closesAt", "timezone", "dailyCapacity",
  "maxOrderValuePaisa", "maxActiveOrdersPerCustomer", "maxItemsPerOrder", "paymentMethods", "coversAllB17",
]
const METHODS = ["cash_on_delivery", "card", "bank_transfer", "easypaisa", "jazzcash"]

const RANGES: Record<string, [number, number]> = {
  dailyCapacity: [1, 200],
  maxOrderValuePaisa: [100, 100_000_000],
  maxActiveOrdersPerCustomer: [1, 10],
  maxItemsPerOrder: [1, 100],
}

function settingsProblems(body: Record<string, unknown>): Problem[] {
  const problems: Problem[] = []
  if (!Number.isInteger(body.revision) || (body.revision as number) < 1) problems.push({ field: "revision", code: "int_type" })
  for (const [field, value] of Object.entries(body)) {
    if (field === "revision") continue
    if (!SETTING_KEYS.includes(field)) problems.push({ field, code: "not_allowed" })
    else if (value === null) problems.push({ field, code: "not_nullable" })
    else if (field in RANGES) {
      const [min, max] = RANGES[field]
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) problems.push({ field, code: "out_of_range" })
    } else if (field === "enabled" && typeof value !== "boolean") problems.push({ field, code: "bool_type" })
    else if (field === "serviceableBlocks") {
      const blocks = value as string[]
      if (blocks.length > 100 || !blocks.every((b) => b.trim().length > 0 && b.length <= 40 && /^[\p{L}\p{N}][\p{L}\p{N} \-/.]*$/u.test(b))) {
        problems.push({ field, code: "invalid_block" })
      } else if (new Set(blocks.map((b) => b.toLowerCase())).size !== blocks.length) problems.push({ field, code: "duplicate_block" })
    } else if (field === "operatingDays") {
      const days = value as number[]
      if (!days.length || days.some((d) => d < 1 || d > 7) || new Set(days).size !== days.length) problems.push({ field, code: "invalid_days" })
    } else if ((field === "opensAt" || field === "closesAt") && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
      problems.push({ field, code: "invalid_time" })
    } else if (field === "timezone" && value !== "Asia/Karachi") problems.push({ field, code: "unsupported_timezone" })
    else if (field === "coversAllB17" && typeof value !== "boolean") problems.push({ field, code: "bool_type" })
    else if (field === "paymentMethods") {
      const methods = value as string[]
      if (methods.some((m) => !METHODS.includes(m))) problems.push({ field, code: "enum" })
      else if (new Set(methods).size !== methods.length) problems.push({ field, code: "duplicate_method" })
      else if (!methods.includes("cash_on_delivery")) problems.push({ field, code: "cash_required" })
    }
  }
  return problems
}

export class AdminBackend {
  settings: GrocerySettingsDto = defaultSettings()
  /** Newest first. */
  readonly audit: StaffAuditEntryDto[] = []
  /** Whether the acting session was created within the sensitive window. */
  recentSignIn = true
  settingsRateLimited = false
  staffRateLimited = false
  /** Called with every new settings version, so another fake can follow it. */
  onSettings: ((settings: GrocerySettingsDto) => void) | null = null
  private readonly grants = new Map<string, { at: string; by?: { userId: string; displayName: string } }>()
  /** Each account's staff revision. Kept through removal, so an old decision stays old. */
  private readonly revisions = new Map<string, number>()
  /** `false`: the server from before §39, which gives no revision and ignores one. */
  versionsStaff = true
  private serial = 0
  private time = Date.parse("2026-11-27T08:00:00Z")

  private readonly directory: Directory

  constructor(directory: Directory) {
    this.directory = directory
  }

  private tick(): string {
    this.time += 60_000
    return new Date(this.time).toISOString()
  }

  /** Another Super Admin saves a change (a new version, as the server would store it). */
  saveElsewhere(change: Partial<GrocerySettingsDto>, by = "Another Superadmin"): void {
    this.store({ ...this.settings, ...change }, { userId: "44444444-4444-4444-8444-000000000001", displayName: by })
  }

  private store(next: GrocerySettingsDto, by: { userId: string; displayName: string }): void {
    this.settings = { ...next, revision: this.settings.revision + 1, updatedAt: this.tick(), updatedBy: by }
    this.onSettings?.(this.settings)
  }

  revisionOf(id: string): number {
    return this.revisions.get(id) ?? 0
  }

  /** Someone else changed this account's staff access and it may look the same again (A → B → A). */
  advanceElsewhere(id: string, by = 1): void {
    this.revisions.set(id, this.revisionOf(id) + by)
  }

  member(account: DirectoryAccount): StaffMemberDto {
    const role = account.roles.includes("admin") ? "admin" : "moderator"
    const scopes = role === "admin" ? [] : [...account.scopes].sort()
    const grant = this.grants.get(account.id)
    return {
      userId: account.id,
      displayName: account.displayName,
      email: account.email,
      role,
      scopes,
      paused: role === "moderator" && scopes.length === 0,
      accountStatus: account.status,
      emailVerified: account.emailVerified,
      grantedAt: grant?.at ?? "2026-11-20T06:00:00Z",
      ...(grant?.by ? { grantedBy: grant.by } : {}),
      ...(this.versionsStaff ? { revision: this.revisionOf(account.id) } : {}),
    }
  }

  roster(): StaffMemberDto[] {
    return this.directory
      .all()
      .filter((a) => a.roles.includes("admin") || a.roles.includes("moderator"))
      .map((a) => this.member(a))
      .sort((a, b) => Number(a.role !== "admin") - Number(b.role !== "admin") || a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()))
  }

  record(entry: Omit<StaffAuditEntryDto, "id" | "occurredAt">): void {
    this.serial += 1
    this.audit.unshift({ id: `55555555-5555-4555-8555-${String(this.serial).padStart(12, "0")}`, occurredAt: this.tick(), ...entry })
  }

  private log(action: StaffAuditActionDto, viewer: AdminViewer, target: DirectoryAccount, before: object, after: object): void {
    this.record({
      source: "web",
      action,
      actor: { userId: viewer.id, displayName: viewer.displayName },
      target: { userId: target.id, displayName: target.displayName },
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
    })
  }

  /** `null` when the path is not one of these routes. `viewer` is `null` when nobody is signed in. */
  route(method: string, path: string, query: URLSearchParams, body: unknown, viewer: AdminViewer | null): GroceryReply | null {
    const settings = path === "/admin/grocery/settings"
    const staff = path === "/admin/staff" || path === "/admin/audit" || path.startsWith("/admin/staff/")
    if (!settings && !staff) return null
    if (!viewer) return fail(401, "unauthenticated")
    if (!viewer.emailVerified) return fail(403, "email_not_verified")
    if (!viewer.superAdmin) return fail(403, "forbidden")
    const payload = (body ?? {}) as Record<string, unknown>
    if (settings) return method === "GET" ? ok(this.settings) : this.patchSettings(payload, viewer)
    const limit = Number(query.get("limit") ?? (path === "/admin/audit" ? 25 : 50))
    const offset = Number(query.get("offset") ?? 0)
    if (path === "/admin/staff" && method === "GET") return limit > 100 ? invalid("limit", "out_of_range") : page(this.roster(), limit, offset)
    if (path === "/admin/audit" && method === "GET") {
      const action = query.get("action")
      const target = query.get("target")
      const rows = this.audit.filter((e) => (!action || e.action === action) && (!target || e.target?.userId === target))
      return page(rows, limit, offset)
    }
    return this.changeStaff(method, path, query, payload, viewer)
  }

  private patchSettings(body: Record<string, unknown>, viewer: AdminViewer): GroceryReply {
    if (this.settingsRateLimited) return fail(429, "rate_limited")
    const problems = settingsProblems(body)
    if (problems.length) return fail(422, "validation_error", problems)
    if (body.revision !== this.settings.revision) return fail(409, "conflict", [{ field: "revision", code: "stale_revision" }])
    const { revision: _revision, ...change } = body
    if (Object.keys(change).length === 0) return invalid("body", "no_changes")
    const next = { ...this.settings, ...(change as Partial<GrocerySettingsDto>) }
    if ("paymentMethods" in change) {
      next.paymentMethods = METHODS.filter((m) => (next.paymentMethods as string[]).includes(m)) as typeof next.paymentMethods
    }
    // "All of B-17" is about one list: a new list drops it unless it is made again with it (§21).
    const keys = (blocks: string[]) => JSON.stringify(blocks.map((b) => b.trim().split(/\s+/).join(" ").toLowerCase()).sort())
    if (!("coversAllB17" in change)) {
      if (keys(next.serviceableBlocks) !== keys(this.settings.serviceableBlocks)) next.coversAllB17 = false
    } else if (next.coversAllB17 && next.serviceableBlocks.length === 0) {
      return invalid("coversAllB17", "needs_blocks")
    }
    // "00:00" closes at the END of the day; with a "00:00" opening that would be a whole day: refused.
    const ordered = next.closesAt === "00:00" ? next.opensAt !== "00:00" : next.opensAt < next.closesAt
    if (!ordered) return invalid("closesAt", "closes_before_opens")
    if (JSON.stringify(next) !== JSON.stringify(this.settings)) {
      this.store(next, { userId: viewer.id, displayName: viewer.displayName })
    }
    return ok(this.settings)
  }

  private changeStaff(
    method: string,
    path: string,
    query: URLSearchParams,
    body: Record<string, unknown>,
    viewer: AdminViewer,
  ): GroceryReply {
    if (!this.recentSignIn) return fail(403, "forbidden", [{ field: "session", code: "sensitive_reauth_required" }])
    if (this.staffRateLimited) return fail(429, "rate_limited")
    const match = /^\/admin\/staff\/moderators(?:\/([^/]+)(?:\/(scopes|pause|resume))?)?$/.exec(path)
    if (!match) return fail(404, "not_found")
    const [, id, operation] = match
    const appoint = !id && method === "POST"
    const takesScopes = appoint || operation === "scopes" || operation === "resume"

    const removing = !operation && !appoint && method === "DELETE"
    const stated = this.versionsStaff ? (["revision"] as const) : []
    const allowed: string[] = appoint
      ? ["email", "scopes", ...stated]
      : takesScopes
        ? ["scopes", ...stated]
        : operation === "pause"
          ? [...stated]
          : []
    const extra = Object.keys(body).filter((key) => !allowed.includes(key))
    if (extra.length) return invalid(extra[0], "not_allowed")
    const seen = removing ? (query.has("revision") ? Number(query.get("revision")) : undefined) : body.revision
    if (this.versionsStaff && !(Number.isInteger(seen) && (seen as number) >= 0)) return invalid("revision", "missing")
    let scopes: StaffScope[] = []
    if (takesScopes) {
      if (!Array.isArray(body.scopes)) return invalid("scopes", "missing")
      if (!(body.scopes as StaffScope[]).every((s) => ALL_SCOPES.includes(s))) return invalid("scopes", "enum")
      scopes = [...new Set(body.scopes as StaffScope[])].sort()
      if (!scopes.length || !scopes.every((s) => ASSIGNABLE.includes(s))) return invalid("scopes", "invalid_staff_scope")
    }
    const superTarget = () => fail(403, "forbidden", [{ field: "request", code: "super_admin_target_forbidden" }])
    const eligible = (a: DirectoryAccount) => a.status === "active" && a.emailVerified
    const state = (account: DirectoryAccount) => this.member(account)
    const stale = (userId: string): GroceryReply | null =>
      this.versionsStaff && seen !== this.revisionOf(userId)
        ? fail(409, "conflict", [{ field: "revision", code: "staff_changed", currentRevision: this.revisionOf(userId) }])
        : null

    if (appoint) {
      if (typeof body.email !== "string" || body.email.length > 320) return invalid("email", "string_type")
      const wanted = body.email.trim().toLowerCase()
      const account = this.directory.all().find((a) => a.email.toLowerCase() === wanted)
      if (!account || !eligible(account)) return invalid("email", "target_not_eligible")
      if (account.roles.includes("admin")) return superTarget()
      const behind = stale(account.id)
      if (behind) return behind
      if (account.roles.includes("moderator")) return fail(409, "conflict", [{ field: "request", code: "already_moderator" }])
      const ended = this.directory.setStaff(account.id, "moderator", scopes)
      this.advanceElsewhere(account.id)
      this.grants.set(account.id, { at: this.tick(), by: { userId: viewer.id, displayName: viewer.displayName } })
      this.log("moderator_appointed", viewer, account, { role: null, scopes: [] }, { role: "moderator", scopes, paused: false, sessions_revoked: ended })
      return ok(state(this.directory.all().find((a) => a.id === account.id)!), 201)
    }

    const target = this.directory.all().find((a) => a.id === decodeURIComponent(id ?? ""))
    const notFound = () => fail(404, "not_found", [{ field: "request", code: "moderator_not_found" }])
    if (!target) return notFound()
    if (target.roles.includes("admin")) return superTarget()
    if (!target.roles.includes("moderator")) return notFound()
    const behind = stale(target.id)
    if (behind) return behind
    const current = [...target.scopes].sort()
    const paused = current.length === 0
    const conflict = (code: string) => fail(409, "conflict", [{ field: "request", code }])
    const before = { role: "moderator", scopes: current, paused }
    const apply = (role: "moderator" | null, next: StaffScope[]) => {
      const ended = this.directory.setStaff(target.id, role, next)
      this.advanceElsewhere(target.id)
      return ended
    }
    const answer = () => ok(state(this.directory.all().find((a) => a.id === target.id)!))

    if (!operation && method === "DELETE") {
      const ended = apply(null, [])
      this.grants.delete(target.id)
      this.log("moderator_removed", viewer, target, before, { role: null, scopes: [], sessions_revoked: ended })
      return { status: 204 }
    }
    if (operation === "scopes" && method === "PUT") {
      if (paused) return conflict("moderator_paused")
      if (JSON.stringify(scopes) === JSON.stringify(current)) return answer()
      const added = scopes.some((s) => !current.includes(s))
      const removed = current.some((s) => !scopes.includes(s))
      const ended = apply("moderator", scopes)
      const after = { role: "moderator", scopes, paused: false, sessions_revoked: ended }
      if (added) this.log("scope_granted", viewer, target, before, after)
      if (removed) this.log("scope_revoked", viewer, target, before, after)
      return answer()
    }
    if (operation === "pause" && method === "POST") {
      if (paused) return conflict("moderator_already_paused")
      const ended = apply("moderator", [])
      this.log("moderator_paused", viewer, target, before, { role: "moderator", scopes: [], paused: true, sessions_revoked: ended })
      return answer()
    }
    if (operation === "resume" && method === "POST") {
      if (!paused) return conflict("moderator_not_paused")
      if (!eligible(target)) return invalid("email", "target_not_eligible")
      const ended = apply("moderator", scopes)
      this.log("scope_granted", viewer, target, before, { role: "moderator", scopes, paused: false, sessions_revoked: ended })
      return answer()
    }
    return fail(405, "method_not_allowed")
  }
}

/** A directory held in memory (the Vitest harness). `onChange` lets a test follow role changes. */
export class MemoryDirectory implements Directory {
  readonly accounts: DirectoryAccount[]
  onChange: ((account: DirectoryAccount) => void) | null = null

  constructor(accounts: DirectoryAccount[]) {
    this.accounts = accounts
  }

  all(): DirectoryAccount[] {
    return this.accounts
  }

  setStaff(id: string, role: "moderator" | null, scopes: StaffScope[]): number {
    const account = this.accounts.find((a) => a.id === id)!
    account.roles = role ? [role] : []
    account.scopes = role ? [...scopes] : []
    this.onChange?.(account)
    return 1
  }
}
