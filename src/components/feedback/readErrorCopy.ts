import type { ApiError } from "@/lib/api/errors"

/**
 * User-facing copy for a failed read (Phase 12G). Keyed on the stable error `code` and the HTTP
 * status, never on the server's message text: raw backend text (and raw JSON) is never shown.
 */
export interface ReadErrorCopy {
  title: string
  description: string
  /** Whether trying the same request again can plausibly help. */
  retryable: boolean
}

export function readErrorCopy(error: ApiError): ReadErrorCopy {
  if (error.isNetwork) {
    return {
      title: "We couldn't reach the server",
      description: "Check your connection and try again.",
      retryable: true,
    }
  }
  switch (error.status) {
    case 401:
      return { title: "Please sign in", description: "Sign in to see this.", retryable: false }
    case 403:
      return {
        title: error.code === "email_not_verified" ? "Verify your email first" : "You don't have access to this",
        description:
          error.code === "email_not_verified"
            ? "Confirm your email address to see this."
            : "This area is for a different kind of account.",
        retryable: false,
      }
    case 404:
      // The API's own "not found" is final; a 404 from anywhere else is an unexpected answer, which a retry can fix.
      return error.code === "not_found"
        ? { title: "Not found", description: "This doesn't exist or may no longer be available.", retryable: false }
        : { title: "We couldn't load this", description: "The service gave an unexpected answer. Please try again in a moment.", retryable: true }
    case 422:
      return {
        title: "That search isn't valid",
        description: "Clear the filters and try again.",
        retryable: false,
      }
    case 429:
      return {
        title: "Too many requests",
        description: "Please wait a moment and try again.",
        retryable: true,
      }
    default:
      return {
        title: "Something went wrong on our side",
        description: "Please try again in a moment.",
        retryable: error.status >= 500 || error.code === "invalid_response",
      }
  }
}
