import { apiRequest } from "@/lib/api/client"
import type { AuthUser } from "@/types/auth"

/**
 * `PUT /users/me/professional-profile` (Phase 12D, API_CONTRACT §10.2) — idempotent. The body is
 * empty: the plan is server-owned and no field is accepted. On success `professional.planCode` is in
 * the answer and in the next `/auth/me`; the session and its CSRF token are unchanged.
 */
export function createProfessionalProfile(): Promise<AuthUser> {
  return apiRequest<AuthUser>("PUT", "/users/me/professional-profile", { session: true, body: {} })
}
