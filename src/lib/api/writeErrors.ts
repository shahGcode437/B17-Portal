import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"

/**
 * One place that turns a thrown API error from a WRITE call into user-facing copy (Phase 12H).
 *
 * Pages never render `error.message` directly — that is server text intended for diagnostics
 * (`AUTH_RBAC §22.4`). Instead they pass the `ApiError` here with the operation they attempted
 * ("archive", "save", "approve", …) and the user sees one of the codes below. An unknown code falls
 * through to a generic retryable message rather than leaking raw text.
 *
 * `userMessageFor` is the central mapping; `isConflict` / `isStaleRevision` / `isNoChanges` /
 * `isSessionLoss` / `isNetwork` are the predicates callers use to branch on behaviour (reload the
 * record, open a confirmation, redirect to login).
 */

export type WriteOperation =
  | "create-listing"
  | "patch-listing"
  | "archive-listing"
  | "save-listing"
  | "unsave-listing"
  | "create-request"
  | "request-action"
  | "admin-approve"
  | "admin-reject"
  | "category-create"
  | "category-patch"
  | "category-reorder"
  | "create-professional-profile"

interface Copy {
  title: string
  description: string
}

const PROFESSIONAL_REQUIRED: Copy = {
  title: "A professional profile is needed",
  description: "Create a professional profile from your workspace, then try again.",
}
const EMAIL_NOT_VERIFIED: Copy = {
  title: "Please verify your email first",
  description: "Open the verification link in your inbox, then try again.",
}
const SESSION_EXPIRED: Copy = {
  title: "Your session has expired",
  description: "Sign in again to continue.",
}
const CSRF_FAILED: Copy = {
  title: "Secure session issue",
  description: "Reload the page and try again.",
}
const NETWORK: Copy = {
  title: "The server could not be reached",
  description: "Check your connection and try again.",
}
const RATE_LIMITED: Copy = {
  title: "Too many attempts",
  description: "Wait a moment, then try again.",
}

function conflictCopy(op: WriteOperation): Copy {
  if (op === "admin-approve" || op === "admin-reject") {
    return {
      title: "This listing has changed since you opened it",
      description: "Reload the latest version before approving or rejecting.",
    }
  }
  return {
    title: "This listing has changed since you opened it",
    description: "Reload the latest version, re-apply your edits and try again.",
  }
}

function invalidStateCopy(op: WriteOperation): Copy {
  if (op === "request-action") {
    return {
      title: "The request has already moved on",
      description: "Reload to see its current status, then act again if you still can.",
    }
  }
  if (op === "admin-approve" || op === "admin-reject") {
    return {
      title: "This listing cannot change state right now",
      description: "Reload it to see its current status.",
    }
  }
  return {
    title: "This change is not allowed in the current state",
    description: "Reload the record to see its current status.",
  }
}

function validationCopy(error: ApiError, op: WriteOperation): Copy {
  // The request eligibility rules arrive as `422 validation_error` + `details[].code` (API_CONTRACT §10.8),
  // not as top-level codes.
  const has = (code: string) => error.details.some((detail) => detail.code === code)
  if (has("own_listing")) {
    return { title: "You cannot send a request to your own listing", description: "Requests are for other people's services." }
  }
  if (has("not_requestable")) {
    return { title: "This listing cannot receive requests", description: "Only approved service providers can be requested right now." }
  }
  // Pick the most informative detail; fall back to a generic form error.
  const first = error.details.find((detail) => detail.message || detail.code)
  if (first) {
    const text = first.message ?? first.code!
    return {
      title: op === "create-request" ? "The request can't be sent as-is" : "Please check the form",
      description: text,
    }
  }
  return { title: "Please check the form", description: "Some fields need attention." }
}

export function userMessageFor(error: unknown, op: WriteOperation): Copy {
  if (!isApiError(error)) return NETWORK
  if (error.code === NETWORK_ERROR_CODE) return NETWORK
  switch (error.code) {
    case "unauthenticated":
    case "session_expired":
    case "account_disabled":
      return SESSION_EXPIRED
    case "csrf_failed":
      return CSRF_FAILED
    case "professional_profile_required":
      return PROFESSIONAL_REQUIRED
    case "email_not_verified":
      return EMAIL_NOT_VERIFIED
    case "listing_conflict":
      return conflictCopy(op)
    case "invalid_state_transition":
      return invalidStateCopy(op)
    case "conflict":
      // e.g. a duplicate category name or slug (`details: [{ field: "name", code: "duplicate" }]`).
      if (error.details.some((detail) => detail.code === "duplicate")) {
        return { title: "That name is already in use", description: "Choose a different name." }
      }
      return { title: "This conflicts with the current state", description: "Reload the page and try again." }
    case "plan_limit_reached":
      return {
        title: "Your plan's listing limit is reached",
        description: "Archive one of your active listings, or upgrade to Premium, then try again.",
      }
    case "rate_limited":
      return RATE_LIMITED
    case "not_found":
      if (op === "save-listing")
        return { title: "This listing is not available", description: "It may have been removed or is no longer approved." }
      return { title: "Not found", description: "This item no longer exists or you cannot see it." }
    case "forbidden":
      return { title: "You cannot do that", description: "Your account does not have permission for this action." }
    case "validation_error":
      return validationCopy(error, op)
    default:
      return { title: "Something went wrong", description: "Please try again." }
  }
}

export function isConflict(error: unknown): error is ApiError {
  return isApiError(error) && error.code === "listing_conflict"
}

export function isInvalidTransition(error: unknown): error is ApiError {
  return isApiError(error) && error.code === "invalid_state_transition"
}

/** A rejected listing resubmitted unchanged: `422 validation_error` with `details: [{ code: "no_changes" }]`. */
export function isNoChanges(error: unknown): error is ApiError {
  return isApiError(error) && error.code === "validation_error" && error.details.some((detail) => detail.code === "no_changes")
}

export function isSessionLoss(error: unknown): error is ApiError {
  return isApiError(error) && (error.code === "unauthenticated" || error.code === "session_expired" || error.code === "account_disabled")
}

export function isNetworkFailure(error: unknown): boolean {
  return isApiError(error) && error.code === NETWORK_ERROR_CODE
}
