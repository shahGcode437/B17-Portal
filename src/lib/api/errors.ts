/**
 * The backend error envelope (docs/backend/API_CONTRACT.md §3):
 * `{ "error": { code, message, details?, requestId } }`. Every failed call becomes an `ApiError`,
 * including a request that never reached the server (`status` 0, `code` "network_error").
 */

export interface ApiErrorDetail {
  /** camelCase JSON path of the offending field, e.g. `email` or `location.latitude`. */
  field?: string
  code?: string
  message?: string
  /** Only on a `staff_changed` refusal: the revision the account is at now. */
  currentRevision?: number
}

export const NETWORK_ERROR_CODE = "network_error"

/** Not from the server: a private answer was set aside because the session behind it is not this screen's. */
export const SESSION_CHANGED_CODE = "session_changed"

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorDetail[]
  readonly requestId: string | undefined

  constructor(init: { status: number; code: string; message: string; details?: ApiErrorDetail[]; requestId?: string }) {
    super(init.message)
    this.name = "ApiError"
    this.status = init.status
    this.code = init.code
    this.details = init.details ?? []
    this.requestId = init.requestId
  }

  /** The request never produced an HTTP response (offline, DNS, refused, CORS block). */
  get isNetwork(): boolean {
    return this.status === 0
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

export function sessionChangedError(): ApiError {
  return new ApiError({ status: 0, code: SESSION_CHANGED_CODE, message: "The signed-in session changed." })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Builds an ApiError from a failed response body (which may not be the envelope at all). */
export function errorFromBody(status: number, body: unknown, headerRequestId?: string | null): ApiError {
  const envelope = isRecord(body) && isRecord(body.error) ? body.error : null
  const code = envelope && typeof envelope.code === "string" ? envelope.code : `http_${status}`
  // Never render arbitrary server text as-is elsewhere: pages map `code` to their own copy. The
  // message is kept only for diagnostics and as a last-resort fallback.
  const message = envelope && typeof envelope.message === "string" ? envelope.message : "The request failed."
  const details: ApiErrorDetail[] =
    envelope && Array.isArray(envelope.details)
      ? envelope.details.filter(isRecord).map((detail) => ({
          field: typeof detail.field === "string" ? detail.field : undefined,
          code: typeof detail.code === "string" ? detail.code : undefined,
          message: typeof detail.message === "string" ? detail.message : undefined,
          ...(Number.isInteger(detail.currentRevision) && { currentRevision: detail.currentRevision as number }),
        }))
      : []
  const requestId =
    envelope && typeof envelope.requestId === "string" ? envelope.requestId : (headerRequestId ?? undefined)
  return new ApiError({ status, code, message, details, requestId })
}

/**
 * The API said "this resource does not exist" (`404` with the envelope's `code: not_found`). Any OTHER 404 - a
 * proxy, a wrong URL, an HTML error page - says nothing about the thing being looked for, so a page must not
 * announce "Provider not found" for it (Phase 12S, S4).
 */
export function isResourceNotFound(error: ApiError): boolean {
  return error.status === 404 && error.code === "not_found"
}

/**
 * After one of these, a private record that was already read must leave the screen: the session
 * ended, the access was refused, or the record is gone.
 */
export function mustForgetRead(error: ApiError): boolean {
  return error.status === 401 || error.status === 403 || error.status === 404
}

/** First message per field, for mapping a 422 onto form fields. */
export function fieldErrors(error: ApiError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const detail of error.details) {
    if (detail.field && detail.message && !(detail.field in result)) result[detail.field] = detail.message
  }
  return result
}
