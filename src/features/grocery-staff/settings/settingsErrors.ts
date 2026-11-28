import type { ApiError, ApiErrorDetail } from "@/lib/api/errors"
import { FIELD_LABEL } from "@/features/grocery-staff/settings/settingsForm"
import type { WriteNotice } from "@/hooks/useGuardedWrite"
import type { GrocerySettingsField } from "@/lib/api/dto/grocerySettings"

/** What a refused settings change means, from the status and codes only; never the server's text. */

const RULES: Record<string, string> = {
  invalid_block: "A block name isn't accepted. Check the list.",
  duplicate_block: "A block is listed more than once.",
  invalid_days: "Choose each operating day once.",
  invalid_time: "Enter times as hours and minutes.",
  closes_before_opens: "The closing time must be after the opening time.",
  no_changes: "There is nothing to change.",
  unsupported_timezone: "That time zone isn't supported.",
}

function describe(detail: ApiErrorDetail): string {
  if (detail.code && RULES[detail.code]) return RULES[detail.code]
  const label = FIELD_LABEL[(detail.field ?? "").split(".")[0] as GrocerySettingsField]
  return label ? `"${label}" has a value the server doesn't accept.` : "A value isn't accepted. Check the form."
}

/** The saved version moved on: someone else changed the settings. */
export function isStaleSettings(error: ApiError): boolean {
  return error.status === 409 && error.details.some((detail) => detail.code === "stale_revision")
}

export function settingsRefusal(error: ApiError): WriteNotice {
  if (isStaleSettings(error)) {
    return {
      title: "Someone else changed the settings",
      description: "Nothing of yours was saved. Check the latest version below, then decide what to do with your edits.",
    }
  }
  switch (error.code) {
    case "csrf_failed":
      return {
        title: "Your secure session had to be renewed",
        description: "Nothing was saved, and nothing was sent again. Check who you're signed in as, then try again.",
      }
    case "forbidden":
    case "email_not_verified":
      return { title: "You no longer have access to do this", description: "Nothing was saved." }
    case "rate_limited":
      return { title: "Too many settings changes in a short time", description: "Nothing was saved. Wait a few minutes, then try again." }
    case "grocery_unavailable":
      return { title: "The grocery settings aren't available", description: "Nothing was saved." }
    case "validation_error":
      return {
        title: "Nothing was saved",
        description: error.details[0] ? describe(error.details[0]) : "Check the form and try again.",
      }
    default:
      return { title: "Nothing was saved", description: "The server refused the change. Reload the settings and try again." }
  }
}
