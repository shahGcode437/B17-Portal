import type { StaffAuditActionDto, StaffAuditEntryDto, StaffAuditPersonDto, StaffMemberDto } from "@/lib/api/dto/staffAdmin"
import type { StaffScope } from "@/types/auth"

/**
 * Words for staff management. A scope is PERMISSION the server enforces; whether this app has a
 * screen for it is a separate fact, and only Grocery orders has a Moderator screen today.
 */
export interface ScopeInfo {
  label: string
  /** What the server lets a Moderator with this scope do. */
  covers: string
  /** Whether this app has a screen a Moderator can use for it. */
  hasScreen: boolean
}

export const SCOPE_INFO: Record<StaffScope, ScopeInfo> = {
  grocery: { label: "Grocery orders", covers: "Handle grocery orders. Nothing about listings.", hasScreen: true },
  services: {
    label: "Service providers",
    covers: "Review service provider listings, manage providers and their service requests.",
    hasScreen: false,
  },
  directory: { label: "Business directory", covers: "Review general business listings.", hasScreen: false },
  food: { label: "Food", covers: "Review food business listings.", hasScreen: false },
  education: { label: "Education", covers: "Review tutor listings.", hasScreen: false },
  property: { label: "Property", covers: "Review property listings.", hasScreen: false },
  news: { label: "News (reserved)", covers: "Reserved. It grants nothing.", hasScreen: false },
}

/** The scopes the server lets staff management assign. `news` is reserved and never offered. */
export const ASSIGNABLE_SCOPES: StaffScope[] = ["grocery", "services", "directory", "food", "education", "property"]

export const scopeNames = (scopes: StaffScope[]) =>
  scopes.length ? scopes.map((scope) => SCOPE_INFO[scope]?.label ?? scope).join(", ") : "None"

export const roleName = (role: string) => (role === "admin" ? "Super Admin" : role === "moderator" ? "Moderator" : "No staff role")

const ACCOUNT_PROBLEM: Record<StaffMemberDto["accountStatus"], string | null> = {
  active: null,
  suspended: "Account suspended",
  deleted: "Account deleted",
}

/** Why a staff member can't act right now, whatever their role and scopes; `null` when nothing stops them. */
export function accountProblem(member: StaffMemberDto): string | null {
  return ACCOUNT_PROBLEM[member.accountStatus] ?? (member.emailVerified ? null : "Email not verified")
}

/** What this person can do as staff now, in one sentence. */
export function accessSummary(member: StaffMemberDto): string {
  const blocked = accountProblem(member)
  if (blocked) return `${blocked}: no staff access.`
  if (member.role === "admin") return "Full staff access as Super Admin."
  if (member.paused) return "Paused: no staff access."
  return `Moderator for: ${scopeNames(member.scopes)}.`
}

/** Whether two answers describe the same authority (what a change was decided on). */
export function sameAccess(a: StaffMemberDto, b: StaffMemberDto): boolean {
  // The revision too: access changed and changed back looks the same and is not (`AUTH_RBAC.md` §39).
  const shape = (m: StaffMemberDto) =>
    JSON.stringify([m.userId, m.role, [...m.scopes].sort(), m.paused, m.accountStatus, m.emailVerified, m.revision])
  return shape(a) === shape(b)
}

export const AUDIT_ACTION: Record<StaffAuditActionDto, string> = {
  moderator_appointed: "Moderator appointed",
  moderator_paused: "Moderator paused",
  moderator_removed: "Moderator removed",
  scope_granted: "Scopes given",
  scope_revoked: "Scopes taken away",
  super_admin_promoted: "Super Admin promoted",
  super_admin_demoted: "Super Admin demoted",
  moderation_self_override: "Super Admin approved their own listing",
  provider_created: "Service provider created",
  provider_updated: "Service provider updated",
  provider_archived: "Service provider archived",
  taxonomy_created: "Category created",
  taxonomy_updated: "Category updated",
  taxonomy_reordered: "Categories reordered",
}

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION) as StaffAuditActionDto[]

export function auditTitle(entry: StaffAuditEntryDto): string {
  // Resuming is recorded as scopes given to a paused Moderator.
  if (entry.action === "scope_granted" && entry.before?.paused === true && entry.after?.paused === false) {
    return "Moderator resumed"
  }
  return AUDIT_ACTION[entry.action] ?? "Staff action"
}

/** Only what the record itself says: no actor is ever inferred. */
export function auditPerson(person: StaffAuditPersonDto | undefined): string | null {
  if (!person) return null
  return person.displayName ?? "An account whose name is no longer available"
}

export function auditActor(entry: StaffAuditEntryDto): string {
  return auditPerson(entry.actor) ?? (entry.source === "cli" ? "Server operator (command line)" : "Not recorded")
}

/** The role-and-scope facts of a recorded state; keys these screens don't understand are not shown. */
export function auditState(state: Record<string, unknown> | undefined): string | null {
  if (!state) return null
  const parts: string[] = []
  if ("role" in state) parts.push(typeof state.role === "string" ? roleName(state.role) : "No staff role")
  if (Array.isArray(state.scopes) && (state.scopes.length > 0 || state.role === "moderator")) {
    parts.push(`scopes: ${scopeNames(state.scopes.filter((s): s is StaffScope => typeof s === "string"))}`)
  }
  if (state.paused === true) parts.push("paused")
  return parts.length ? parts.join(", ") : null
}

export function endedSessions(state: Record<string, unknown> | undefined): string | null {
  const count = state?.sessions_revoked
  if (typeof count !== "number") return null
  return count === 1 ? "1 session ended." : `${count} sessions ended.`
}
