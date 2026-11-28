import { apiRequest } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { segment } from "@/lib/api/query"
import type { StaffMemberDto } from "@/lib/api/dto/staffAdmin"
import type { StaffScope } from "@/types/auth"

/**
 * The five staff-management changes (`docs/backend/AUTH_RBAC.md` §30). Each needs a recent sign-in
 * and is sent ONCE (the client never sends any request twice). None takes a reason or a version.
 */
async function change(method: "POST" | "PUT", path: string, signal: AbortSignal | undefined, body?: object): Promise<StaffMemberDto> {
  const member = await apiRequest<StaffMemberDto>(method, `/admin/staff/moderators${path}`, {
    session: true,
    ...(body ? { body } : {}),
    signal,
  })
  if (typeof member?.userId !== "string" || !Array.isArray(member.scopes)) {
    throw new ApiError({ status: 200, code: "invalid_response", message: "The server returned an unexpected response." })
  }
  return member
}

export const appointModerator = (email: string, scopes: StaffScope[], signal?: AbortSignal) =>
  change("POST", "", signal, { email, scopes })

/** The Moderator ends with exactly these scopes. */
export const replaceModeratorScopes = (userId: string, scopes: StaffScope[], signal?: AbortSignal) =>
  change("PUT", `/${segment(userId)}/scopes`, signal, { scopes })

export const pauseModerator = (userId: string, signal?: AbortSignal) => change("POST", `/${segment(userId)}/pause`, signal)

export const resumeModerator = (userId: string, scopes: StaffScope[], signal?: AbortSignal) =>
  change("POST", `/${segment(userId)}/resume`, signal, { scopes })

/** Removes the moderator role (`204`). The account itself stays. */
export function removeModerator(userId: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>("DELETE", `/admin/staff/moderators/${segment(userId)}`, {
    session: true,
    signal,
  })
}
