import { apiRequestPage, type Page } from "@/lib/api/client"
import { queryString } from "@/lib/api/query"
import type { StaffAuditActionDto, StaffAuditEntryDto, StaffMemberDto } from "@/lib/api/dto/staffAdmin"

/** `GET /admin/staff` — the roster: Super Admins first, then Moderators. There is no one-member read. */
export function fetchStaffRoster(params: { limit?: number; offset?: number }, signal?: AbortSignal): Promise<Page<StaffMemberDto>> {
  return apiRequestPage<StaffMemberDto>("GET", `/admin/staff${queryString({ ...params })}`, { signal, session: true })
}

export interface StaffAuditParams {
  action?: StaffAuditActionDto
  /** The id of the account a change was made to. */
  target?: string
  limit?: number
  offset?: number
}

/** `GET /admin/audit` — the durable staff audit, newest first. Read-only. Settings changes are not in it. */
export function fetchStaffAudit(params: StaffAuditParams, signal?: AbortSignal): Promise<Page<StaffAuditEntryDto>> {
  return apiRequestPage<StaffAuditEntryDto>("GET", `/admin/audit${queryString({ ...params })}`, { signal, session: true })
}
