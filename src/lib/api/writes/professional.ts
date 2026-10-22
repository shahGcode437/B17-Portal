import { apiRequest } from "@/lib/api/client"
import type { AuthUser } from "@/types/auth"

/**
 * `PUT /users/me/professional-profile` (Phase 12D, API_CONTRACT §10.2) — idempotent. The body is
 * empty: the plan is server-owned and no field is accepted. On success the server has rotated the
 * session's CSRF token and the `professional.planCode` is in the next `/auth/me`.
 */
export function createProfessionalProfile(): Promise<AuthUser> {
  return apiRequest<AuthUser>("PUT", "/users/me/professional-profile", { session: true, body: {} })
}
