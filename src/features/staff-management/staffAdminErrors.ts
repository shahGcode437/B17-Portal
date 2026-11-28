import type { ApiError } from "@/lib/api/errors"
import { NETWORK_ERROR_CODE } from "@/lib/api/errors"
import type { WriteNotice } from "@/hooks/useGuardedWrite"

/** What a refused staff change means, from the status and codes only; never the server's text. */

/** Our own code: the check made just before sending found the person's access had changed. */
export const STAFF_CHANGED = "staff_changed"

const has = (error: ApiError, code: string) => error.details.some((detail) => detail.code === code)

/** The sign-in is too old for a staff change. The session itself is fine. */
export function needsRecentSignIn(error: ApiError): boolean {
  return error.status === 403 && has(error, "sensitive_reauth_required")
}

/** The person on screen is no longer as shown. */
export function isBehindStaff(error: ApiError): boolean {
  return (
    error.code === STAFF_CHANGED ||
    ["moderator_paused", "moderator_not_paused", "moderator_already_paused", "moderator_not_found"].some((code) =>
      has(error, code)
    )
  )
}

const BY_DETAIL: Record<string, WriteNotice> = {
  target_not_eligible: {
    title: "That account can't be made a moderator",
    description:
      "Nothing was changed. Check the address, and that the person has an active account with a verified email. The server doesn't say which of these it was.",
  },
  already_moderator: {
    title: "That account is already a moderator",
    description: "Nothing was changed. Find them in the staff list to change their access.",
  },
  super_admin_target_forbidden: {
    title: "A Super Admin can't be changed here",
    description: "Nothing was changed. Super Admins are managed only from the server's command line.",
  },
  invalid_staff_scope: {
    title: "Those scopes can't be assigned",
    description: "Nothing was changed. Choose at least one available scope; to remove every scope, pause the moderator.",
  },
  moderator_paused: { title: "This moderator is paused", description: "Nothing was changed. Resume them with scopes instead." },
  moderator_not_paused: { title: "This moderator isn't paused", description: "Nothing was changed. Check their current access." },
  moderator_already_paused: { title: "This moderator is already paused", description: "Nothing was changed." },
  moderator_not_found: { title: "This person is no longer a moderator", description: "Nothing was changed." },
}

export function staffAdminRefusal(error: ApiError): WriteNotice {
  if (error.code === STAFF_CHANGED) {
    return {
      title: "This person's access changed since you opened it",
      description: "Nothing was sent. Check their current access below, then decide again.",
    }
  }
  // An unknown outcome is never explained here, so no answer means the check before sending failed.
  if (error.code === NETWORK_ERROR_CODE) {
    return { title: "Couldn't check this person's current access", description: "Nothing was sent. Check your connection and try again." }
  }
  for (const detail of error.details) {
    if (detail.code && BY_DETAIL[detail.code]) return BY_DETAIL[detail.code]
  }
  switch (error.code) {
    case "csrf_failed":
      return {
        title: "Your secure session had to be renewed",
        description: "Nothing was changed, and nothing was sent again. Check who you're signed in as, then try again.",
      }
    case "forbidden":
    case "email_not_verified":
      return { title: "You no longer have access to do this", description: "Nothing was changed." }
    case "rate_limited":
      return {
        title: "Too many staff changes in a short time",
        description: "Nothing was changed. Refused attempts count too. Wait up to 15 minutes, then try again.",
      }
    case "validation_error":
      return { title: "Nothing was changed", description: "The server didn't accept those details. Check them and try again." }
    default:
      return { title: "Nothing was changed", description: "The server refused the change. Reload the staff list and try again." }
  }
}
