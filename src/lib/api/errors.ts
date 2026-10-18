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
}

export const NETWORK_ERROR_CODE = "network_error"

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
        }))
      : []
  const requestId =
    envelope && typeof envelope.requestId === "string" ? envelope.requestId : (headerRequestId ?? undefined)
  return new ApiError({ status, code, message, details, requestId })
}

/** First message per field, for mapping a 422 onto form fields. */
export function fieldErrors(error: ApiError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const detail of error.details) {
    if (detail.field && detail.message && !(detail.field in result)) result[detail.field] = detail.message
  }
  return result
}
