/**
 * Staff management, Super Admin only, exactly as the backend serves it
 * (`docs/backend/AUTH_RBAC.md` §30; `backend/app/schemas/staff.py`). It carries staff e-mail
 * addresses: only the staff-management screens and this API layer import it.
 */
import type { AuthRole, StaffScope } from "@/types/auth"

export interface StaffMemberDto {
  userId: string
  displayName: string
  email: string
  /** `admin` is a Super Admin: read-only here. */
  role: AuthRole
  /** A Moderator's assigned scopes; always empty for a Super Admin. */
  scopes: StaffScope[]
  /** A Moderator with no scopes: keeps the role, has no staff authority. */
  paused: boolean
  accountStatus: "active" | "suspended" | "deleted"
  emailVerified: boolean
  grantedAt: string
  /** Absent when no granting person is recorded (a command-line grant, for example). */
  grantedBy?: { userId: string; displayName: string }
  /**
   * The account's staff revision: stated with every change to it (`AUTH_RBAC.md` §39). Absent only
   * from an older server, to which the app sends no change to an existing member.
   */
  revision?: number
}

export type StaffAuditActionDto =
  | "moderator_appointed"
  | "moderator_paused"
  | "moderator_removed"
  | "scope_granted"
  | "scope_revoked"
  | "super_admin_promoted"
  | "super_admin_demoted"
  | "moderation_self_override"
  | "provider_created"
  | "provider_updated"
  | "provider_archived"
  | "taxonomy_created"
  | "taxonomy_updated"
  | "taxonomy_reordered"

/** `displayName` is absent when the account no longer exists. */
export interface StaffAuditPersonDto {
  userId: string
  displayName?: string
}

export interface StaffAuditEntryDto {
  id: string
  occurredAt: string
  source: "web" | "cli"
  action: StaffAuditActionDto
  /** Absent for an operator command-line action. */
  actor?: StaffAuditPersonDto
  target?: StaffAuditPersonDto
  resourceType?: "listing" | "category"
  resourceId?: string
  /** Allow-listed state, as stored. Only the keys the screens understand are shown. */
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  /** Recorded for command-line changes. The web staff changes take no reason. */
  reason?: string
  requestId?: string
}
