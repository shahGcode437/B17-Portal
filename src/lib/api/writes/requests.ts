import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"
import type { ContactChannelDto, RequestDetailDto } from "@/lib/api/dto/private"

/**
 * The body for `POST /requests` — exactly the fields the backend accepts (API_CONTRACT §10.8).
 * `providerName` and status are server-owned; `providerListingId` picks the target listing (the
 * backend derives the provider from its owner).
 */
export interface CreateRequestPayload {
  providerListingId: string
  service: string
  details: string
  area: string
  /** `YYYY-MM-DD`; backend refuses dates in the past. */
  preferredDate: string
  preferredTime?: string
  notes?: string
  preferredContactChannel: ContactChannelDto
}

export function createRequest(payload: CreateRequestPayload): Promise<RequestDetailDto> {
  return apiRequest<RequestDetailDto>("POST", "/requests", { session: true, body: payload })
}

export type RequestAction = "accept" | "start" | "complete" | "cancel"

/**
 * `POST /requests/{id}/{action}` — the four lifecycle actions. The server guards role × status;
 * `409 invalid_state_transition` on a stale state. No body is sent.
 */
export function actOnRequest(id: string, action: RequestAction): Promise<RequestDetailDto> {
  return apiRequest<RequestDetailDto>("POST", `/requests/${segment(id)}/${action}`, { session: true, body: {} })
}
