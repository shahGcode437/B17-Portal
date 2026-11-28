import type { ApiError, ApiErrorDetail } from "@/lib/api/errors"
import { describeDetail } from "@/lib/api/writeErrors"

export { isUnknownOutcome } from "@/lib/api/writeErrors"

/**
 * What a failed staff request means, judged on the HTTP status and the stable `code` /
 * `details[].code` — never on the server's text, which is never shown.
 */

interface Copy {
  title: string
  description: string
}

/** The order on screen is behind the server: someone (or something) moved it on. */
const STALE = new Set(["order_conflict", "invalid_state_transition", "order_already_claimed", "order_not_claimed"])

function hasDetail(error: ApiError, code: string): boolean {
  return error.details.some((detail) => detail.code === code)
}

export function isStaleOrder(error: ApiError): boolean {
  return STALE.has(error.code)
}

/** The staff side refuses a person their own order, a Super Admin included. */
export function isOwnOrder(error: ApiError): boolean {
  return error.status === 403 && hasDetail(error, "own_order")
}

export function needsSuperAdmin(error: ApiError): boolean {
  return error.status === 403 && hasDetail(error, "super_admin_required")
}

/** The account no longer has (this) staff authority. Not a CSRF refusal, and not the two above. */
export function isLostAccess(error: ApiError): boolean {
  if (error.status !== 403) return false
  return error.code === "email_not_verified" || (error.code === "forbidden" && !isOwnOrder(error) && !needsSuperAdmin(error))
}

export { mustForgetRead as mustForget } from "@/lib/api/errors"

const AMOUNT_FIELD: Record<string, string> = {
  itemsSubtotalPaisa: "The items amount",
  serviceFeePaisa: "The service fee",
  deliveryFeePaisa: "The delivery fee",
  agreedTotalPaisa: "The agreed total",
  finalAmountPaisa: "The new amount",
  amountCollectedPaisa: "The cash collected",
}

const TEXT_FIELD: Record<string, string> = {
  consentNote: "The note on what the customer agreed to",
  pricingNote: "The pricing note",
  reason: "The reason",
  note: "The note",
}

const RULES: Record<string, string> = {
  total_mismatch: "The agreed total doesn't equal the items plus the fees.",
  exceeds_order_limit: "The total is above the largest order allowed. Agree a smaller order with the customer.",
  not_a_reduction: "The new amount must be less than the amount now due.",
  amount_mismatch: "The cash must equal the amount due. Part payment can't be recorded.",
  substitution_note_required: "Write which substitutes the customer agreed to.",
  agreement_required: "Confirm that the customer agreed before recording it.",
  acknowledgement_required: "Confirm that goods may already have been bought.",
  system_only: "That kind of issue is recorded by the system. Choose another.",
}

function describeStaffDetail(detail: ApiErrorDetail): string | null {
  if (detail.code && RULES[detail.code]) return RULES[detail.code]
  const field = detail.field ?? ""
  const noun = AMOUNT_FIELD[field] ?? TEXT_FIELD[field]
  if (!noun) return describeDetail(detail)
  if (AMOUNT_FIELD[field]) return `${noun} isn't an amount the server accepts.`
  if (detail.code === "string_too_long") return `${noun} is too long.`
  if (detail.code === "missing" || detail.code === "string_too_short" || detail.code === "string_type") return `${noun} is required.`
  return `${noun} can't be accepted as written.`
}

/** For a DEFINITE refusal: every sentence here says, or follows from, "nothing was saved". */
export function staffRefusalCopy(error: ApiError): Copy {
  if (isOwnOrder(error)) {
    return { title: "This is your own order", description: "Nothing was saved. Another staff member must handle it." }
  }
  if (needsSuperAdmin(error)) {
    return {
      title: "Only a Super Admin can do this now",
      description: "Nothing was saved. Preparation has started: record an issue so a Super Admin can decide.",
    }
  }
  switch (error.code) {
    case "order_already_claimed":
      return { title: "Someone else claimed this order first", description: "Nothing changed for you. The latest version is shown below." }
    case "order_not_claimed":
      return { title: "You don't hold this order", description: "Nothing was saved. Check below who has it now." }
    case "invalid_state_transition":
      return { title: "This order has moved on", description: "Nothing was saved. Check its current status below." }
    case "order_conflict":
      return { title: "This order changed since you opened it", description: "Nothing was saved. Check the latest version below, then decide again." }
    case "csrf_failed":
      return {
        title: "Your secure session had to be renewed",
        description: "Nothing was saved, and nothing was sent again. Check who you're signed in as, then try again.",
      }
    case "forbidden":
    case "email_not_verified":
      return { title: "You no longer have access to do this", description: "Nothing was saved." }
    case "rate_limited":
      return { title: "Too many staff changes in a short time", description: "Nothing was saved. Wait a few minutes, then try again." }
    case "grocery_unavailable":
      return { title: "The grocery settings aren't available", description: "Nothing was saved. A Super Admin needs to check them." }
    case "not_found":
      return { title: "Order not found", description: "Nothing was saved." }
    case "validation_error": {
      const description = error.details.map(describeStaffDetail).find(Boolean)
      return { title: "Nothing was saved", description: description ?? "Some details need a change. Check the form and try again." }
    }
    default:
      return { title: "Nothing was saved", description: "The server refused the request. Reload the order and try again." }
  }
}
