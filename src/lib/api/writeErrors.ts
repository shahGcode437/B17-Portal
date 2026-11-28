import { mailMode, type MailMode } from "@/config/devMail"
import { ApiError, NETWORK_ERROR_CODE, isApiError, type ApiErrorDetail } from "@/lib/api/errors"
import { LOCALITIES } from "@/config/localities"
import { PHONE_EXAMPLE } from "@/lib/phone"
import { MAX_BLOCK_LENGTH, MAX_TAGS, MAX_TAG_LENGTH } from "@/config/listingLimits"

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
  | "grocery-submit"
  | "grocery-cancel"

interface Copy {
  title: string
  description: string
}

/**
 * "Title. What to do." as one string, for a toast: a toast shows a single line, and the title alone says what failed
 * but not what to do next. Used with `{ tone: "error" }` (a failed action must never look like a success).
 */
export function copyAsSentence(copy: { title: string; description?: string }): string {
  const title = copy.title.replace(/[.!?]+$/, "")
  return copy.description ? `${title}. ${copy.description}` : copy.title
}

const PROFESSIONAL_REQUIRED: Copy = {
  title: "A professional profile is needed",
  description: "Create a professional profile from your workspace, then try again.",
}
const VERIFY_IN_DEVELOPMENT =
  "In development no e-mail is sent: your Profile page shows the command that prints your verification link. Open it, then try again."
const HOW_TO_VERIFY: Record<MailMode, string> = {
  inbox:
    "Check your inbox and spam folder for the verification email, or request a new one from your Profile page. Open its link, then try again.",
  console: VERIFY_IN_DEVELOPMENT,
  off: VERIFY_IN_DEVELOPMENT,
  neutral: "Verify your email address from your Profile page, then try again.",
}
const emailNotVerified = (): Copy => ({
  title: "Please verify your email first",
  description: HOW_TO_VERIFY[mailMode()],
})
const SESSION_EXPIRED: Copy = {
  title: "Your session has expired",
  description: "Sign in again to continue.",
}
/**
 * `403 csrf_failed`: the session's CSRF token did not match. Since the app talks to its own origin (Phase 12S S1) the
 * usual cause is a stale tab (somebody signed in again elsewhere in this browser). The client has already re-read the
 * session and never re-sends by itself, so trying again is the person's own step. It is not guaranteed to work (a
 * blocked cookie or a proxy in the way would not be fixed), so the copy never promises it.
 */
const CSRF_FAILED: Copy = {
  title: "Your secure session could not be verified",
  description:
    "This request was refused and was not sent again. Check which account you're signed in to, then try again. If it keeps happening, reload the page, or log out and log in again.",
}
const NETWORK: Copy = {
  title: "The server could not be reached",
  description: "Check your connection and try again.",
}
const SERVER_ERROR: Copy = {
  title: "The server had a problem",
  description: "Please try again in a moment.",
}
const RATE_LIMITED: Copy = {
  title: "Too many attempts",
  description: "Wait a moment, then try again.",
}

function rateLimitedCopy(op: WriteOperation): Copy {
  if (op === "grocery-submit") {
    return { title: "You've sent several grocery orders recently", description: "Your list is still here. Please wait a while before sending it." }
  }
  if (op === "create-request") {
    return {
      title: "You've sent too many requests",
      description: "Please wait a while before sending another. You can send one request to the same provider per day.",
    }
  }
  if (op === "create-listing") {
    return { title: "You've submitted several listings recently", description: "Please wait a while before submitting another." }
  }
  return RATE_LIMITED
}

/**
 * `403 plan_limit_reached`: the account already has the most ACTIVE (pending + approved) listings its plan allows. Today the
 * only thing a person can do about it is archive one - there is no billing, so the copy never points at an upgrade.
 * Resubmitting a REJECTED listing needs a free slot too (it becomes pending again), which arrives as a failed edit.
 */
function planLimitCopy(op: WriteOperation): Copy {
  const title = "Active listing limit reached"
  const reached = "You've reached the active listing limit for your current plan."
  if (op === "patch-listing") {
    return { title, description: `${reached} Archive an active listing before resubmitting this one.` }
  }
  return { title, description: `${reached} Archive an active listing before creating another.` }
}

/** What a 404 means depends on what was being written: say which thing is gone. */
function notFoundCopy(op: WriteOperation): Copy {
  switch (op) {
    case "save-listing":
    case "unsave-listing":
      return { title: "This listing is not available", description: "It may have been removed or is no longer approved." }
    case "create-request":
      return { title: "This provider isn't available", description: "The listing may have been removed or is no longer approved." }
    case "request-action":
      return { title: "Request not found", description: "It may have been removed. Reload your requests to see what is current." }
    case "patch-listing":
    case "archive-listing":
      return { title: "Listing not found", description: "This listing is no longer in your account." }
    case "grocery-cancel":
      return { title: "Order not found", description: "It may belong to another account. Check My Grocery Orders." }
    case "admin-approve":
    case "admin-reject":
      return { title: "Listing not found", description: "It may have been removed. Reload the queue to see what is current." }
    case "category-patch":
    case "category-reorder":
      return { title: "Category not found", description: "It may have been removed. Reload the list to see what is current." }
    default:
      return { title: "Not found", description: "This item no longer exists or you cannot see it." }
  }
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
  if (op === "grocery-cancel") {
    return { title: "This order can no longer be cancelled", description: "It has moved on. Check its latest status below." }
  }
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

/** A short noun for the field a `422` names, so "too short" says WHAT is too short. */
const FIELD_NOUN: Record<string, string> = {
  name: "The name",
  title: "The title",
  description: "The description",
  details: "The details",
  notes: "The notes",
  service: "The service",
  area: "The area",
  tags: "The tags",
  grade: "The grade",
  price: "The price",
  bedrooms: "The number of bedrooms",
  contactPhone: "The contact number",
  whatsappPhone: "The WhatsApp number",
  reason: "The reason",
  "location.block": "The block",
  "location.address": "The address",
  "location.landmark": "The landmark",
  "delivery.contactName": "The contact name",
  "delivery.contactPhone": "The phone number",
  "delivery.block": "The block",
  "delivery.addressLine": "The address",
  "delivery.landmark": "The landmark",
}

function nounFor(field: string | undefined): string {
  if (!field) return "That field"
  const key = field.replace(/\.\d+$/, "") // `tags.3` is still "the tags"
  const known = FIELD_NOUN[field] ?? FIELD_NOUN[key]
  if (known) return known
  const last = key.split(".").pop() ?? key
  return `The ${last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`
}

/**
 * One backend `details[]` entry as a sentence a person can act on, or `null` when this code has no mapping.
 * Keyed on the stable `code` (and the field it names), NEVER on the server's text: Pydantic's own messages
 * ("List should have at most 20 items after validation, not 21") are not copy, and the reason for a refused
 * write lives in `details[].code` rather than the top-level code (API_CONTRACT §10.10).
 */
export function describeDetail(detail: ApiErrorDetail): string | null {
  const field = detail.field ?? ""
  // A grocery list line: say WHICH line, counting from one as the list on screen does.
  const line = /^items\.(\d+)\./.exec(field)
  if (line) {
    const text = describeDetail({ ...detail, field: field.slice(line[0].length) })
    return text ? `Item ${Number(line[1]) + 1}: ${text}` : null
  }
  const noun = nounFor(field)
  switch (detail.code) {
    case "unknown_locality":
      return `Choose ${LOCALITIES.join(" or ")} as the area. Put your block or street in the Block field.`
    case "too_long":
    case "too_many":
      return field === "tags" ? `You can add up to ${MAX_TAGS} tags.` : `${noun} has too many entries.`
    case "string_too_long":
      if (field === "location.block") return `The block can be up to ${MAX_BLOCK_LENGTH} characters.`
      if (field.startsWith("tags")) return `Each tag can be up to ${MAX_TAG_LENGTH} characters.`
      return `${noun} is too long.`
    case "invalid_format":
      return field === "location.block"
        ? `Use letters, numbers, spaces, "-", "/" or "." for the block (up to ${MAX_BLOCK_LENGTH} characters).`
        : `${noun} isn't in a format we can use.`
    case "string_too_short":
    case "too_short":
      return `${noun} is too short.`
    case "missing":
    case "required":
      return `${noun} is required.`
    case "not_nullable":
      return `${noun} can't be left empty.`
    case "unknown_category":
      return "Choose a category from the list."
    case "invalid_quantity":
    case "quantity_too_small":
    case "quantity_too_large":
    case "quantity_precision":
      return "The quantity isn't allowed for that unit. Edit the item and check it."
    case "not_serviceable":
      return "Grocery delivery isn't available in that block. Choose a block from the list."
    case "too_many_items":
      return "Your list has more items than one order allows. Remove some and try again."
    case "invalid_block":
      return "Choose a block from the list."
    case "invalid_media_reference":
      return "Images can't be uploaded yet. Remove the image and try again."
    case "not_allowed":
      return field === "location.visibility"
        ? "A property needs a map pin. Choose exact or approximate."
        : `${noun} can't be set here.`
    case "duplicate":
      return `${noun} repeats a choice. Each can be chosen once.`
    case "invalid_characters":
      return `${noun} contains characters that aren't allowed.`
    // Listing Contact v1: the API could not read the number. The form checks the same rule before a submit,
    // so this is the belt-and-braces message for a value that reached the server anyway.
    case "invalid_phone":
      return `${noun} isn't a number we can use. Try ${PHONE_EXAMPLE} or +92${PHONE_EXAMPLE.slice(1)}.`
    case "out_of_range":
      return "Choose a point on the map, or enter valid coordinates."
    case "in_the_past":
      return "Choose today or a later date."
    case "too_far_ahead":
      return "Choose a date within the next 365 days."
    case "no_changes":
      return "Change at least one field before resubmitting."
    default:
      return null
  }
}

/** Per-field sentences for the fields a form shows inline, from the same mapping (never the server's raw text). */
export function friendlyFieldErrors(error: ApiError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const detail of error.details) {
    if (!detail.field || detail.field in result) continue
    const text = describeDetail(detail)
    if (text) result[detail.field] = text
  }
  return result
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
  const title = op === "create-request" ? "The request can't be sent as-is" : "Please check the form"
  // The first problem that has a mapping.
  for (const detail of error.details) {
    const description = describeDetail(detail)
    if (description) return { title, description }
  }
  // Last resort: a code nobody mapped yet. The server's own sentence is Pydantic's ("String should have at least 2
  // characters"), which is a diagnostic, not copy, so it is never shown; neither is a bare code. S5A / B-07.
  return {
    title,
    description:
      op === "create-request"
        ? "Some details need a change. Check them and try again."
        : "Some fields need a change. Check the form and try again.",
  }
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
    case "grocery_unavailable":
      return { title: "Grocery ordering isn't available right now", description: "No order was placed. Your list is still here." }
    case "grocery_closed":
      return { title: "Grocery ordering is closed right now", description: "No order was placed. Send it during opening hours." }
    case "grocery_capacity_reached":
      return { title: "Today's grocery order places are full", description: "No order was placed. Try again tomorrow during opening hours." }
    case "grocery_active_order_limit":
      return { title: "You have the most open grocery orders allowed", description: "Wait until one is delivered or cancelled. See My Grocery Orders." }
    case "idempotency_key_reused":
      return { title: "This order couldn't be matched safely", description: "Check My Grocery Orders before sending it again." }
    case "order_conflict":
      return { title: "This order changed since you opened it", description: "Check the latest version below, then decide again." }
    case "email_not_verified":
      return emailNotVerified()
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
      return planLimitCopy(op)
    case "rate_limited":
      return rateLimitedCopy(op)
    case "not_found":
      return notFoundCopy(op)
    case "forbidden":
      // The provider (Service / Professional) kind is portal-managed: a non-admin who tries to
      // create, edit or archive one gets this specific message so they know what to switch to.
      if (error.details.some((detail) => detail.code === "provider_admin_only")) {
        return {
          title: "Service listings are managed by portal staff",
          description: "Please list a Business, Food, Tutor or Property listing instead.",
        }
      }
      return { title: "You cannot do that", description: "Your account does not have permission for this action." }
    case "validation_error":
      return validationCopy(error, op)
    default:
      // A server-side failure (5xx / service_unavailable) is not "something went wrong with your input".
      return error.status >= 500 ? SERVER_ERROR : { title: "Something went wrong", description: "Please try again." }
  }
}

/**
 * We cannot know whether a change was saved: no answer, a timeout, an unreadable answer or a server
 * failure. `503 grocery_unavailable` is a definite refusal.
 */
export function isUnknownOutcome(error: unknown): boolean {
  if (!isApiError(error)) return true
  if (error.status === 0 || error.code === "invalid_response") return true
  return error.status >= 500 && error.code !== "grocery_unavailable"
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
