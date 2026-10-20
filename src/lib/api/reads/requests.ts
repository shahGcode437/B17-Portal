import { apiRequest, apiRequestPage, type Page } from "@/lib/api/client"
import { queryString, segment } from "@/lib/api/query"
import type { LeadSummaryDto, RequestDetailDto, RequestStatusDto, RequestSummaryDto } from "@/lib/api/dto/private"

export interface RequestListParams {
  status?: RequestStatusDto
  limit?: number
  offset?: number
}

/** `GET /requests` — the requests I sent, newest first. READ ONLY in Phase 12G. */
export function fetchMyRequests(params: RequestListParams = {}, signal?: AbortSignal): Promise<Page<RequestSummaryDto>> {
  return apiRequestPage<RequestSummaryDto>("GET", `/requests${queryString({ ...params })}`, { signal, session: true })
}

/** `GET /requests/{id}` — readable by the requester and the owner of the target listing only. */
export function fetchRequest(id: string, signal?: AbortSignal): Promise<RequestDetailDto> {
  return apiRequest<RequestDetailDto>("GET", `/requests/${segment(id)}`, { signal, session: true })
}

/** `GET /users/me/leads` — requests sent to listings I own (a verified professional only). */
export function fetchLeads(params: RequestListParams = {}, signal?: AbortSignal): Promise<Page<LeadSummaryDto>> {
  return apiRequestPage<LeadSummaryDto>("GET", `/users/me/leads${queryString({ ...params })}`, { signal, session: true })
}
