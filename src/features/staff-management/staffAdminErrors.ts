import { NETWORK_ERROR_CODE, isApiError, ApiError } from "@/lib/api/errors"
import type { WriteNotice } from "@/hooks/useGuardedWrite"

/** What a refused staff change means, from the status and codes only; never the server's text. */

/** The check made just before sending found the person's access had changed (also the server's detail code). */
export const STAFF_CHANGED = "staff_changed"
/** The server gave no revision for this person, so a change couldn't be protected: nothing was sent. */
export const STAFF_UNVERSIONED = "staff_unversioned"
/** An appointment the server refused because the account's staff access isn't where the form assumed. */
export const STAFF_HISTORY = "staff_history"

const has = (error: ApiError, code: string) => error.details.some((detail) => detail.code === code)

/** The revision a `staff_changed` refusal reports, or `null` for any other failure. */
export function currentStaffRevision(error: unknown): number | null {
  if (!isApiError(error) || error.status !== 409) return null
  return error.details.find((detail) => detail.code === STAFF_CHANGED)?.currentRevision ?? null
}

/** The sign-in is too old for a staff change. The session itself is fine. */
export function needsRecentSignIn(error: ApiError): boolean {
  return error.status === 403 && has(error, "sensitive_reauth_required")
}

/** The person on screen is no longer as shown. */
export function isBehindStaff(error: ApiError): boolean {
  return (
    error.code === STAFF_CHANGED ||
    has(error, STAFF_CHANGED) ||
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
  if (has(error, STAFF_CHANGED)) {
    return {
      title: "This person's access changed since you opened it",
      description: "Nothing was changed, and nothing was sent again. Check their current access below, then decide again.",
    }
  }
  if (error.code === STAFF_HISTORY) {
    return {
      title: "Check this account's staff history first",
      description:
        "Nothing was changed. This account has held staff access before, or its access was just changed by someone else. Check the staff history, then tick the box and appoint again if you still mean to.",
    }
  }
  if (error.code === STAFF_UNVERSIONED) {
    return {
      title: "This server can't protect staff changes yet",
      description: "Nothing was sent. The server needs updating before staff access can be changed from here.",
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
