import { API_BASE_URL } from "@/config/api"
import { ApiError, NETWORK_ERROR_CODE, errorFromBody } from "@/lib/api/errors"
import { getCsrfToken, getSessionHandlers } from "@/lib/api/session"

/**
 * The one place the SPA talks to the backend (Phase 12C).
 *
 *  - Cookie auth: every call uses `credentials: "include"`; the HttpOnly session cookie is attached
 *    by the browser and is never readable here. There is no bearer-token code anywhere.
 *  - `session: true` marks an AUTHENTICATED call: unsafe ones carry `X-CSRF-Token`, a
 *    `403 csrf_failed` triggers ONE `/auth/me` refresh and ONE retry (never a loop, never for
 *    other 403s, 409s, 422s, 401s or network failures), and a `401 unauthenticated|session_expired`
 *    (or `account_disabled`) ends the local session. Pre-session calls (login, register,
 *    forgot/reset password, verify-email, `/auth/me` itself) leave `session` off.
 *  - Failures become typed `ApiError`s from the backend's error envelope.
 */

export interface RequestOptions {
  body?: unknown
  signal?: AbortSignal
  /** An authenticated call: CSRF header, one csrf_failed retry, session-loss handling. */
  session?: boolean
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError"
}

function endsTheSession(error: ApiError): boolean {
  return (
    (error.status === 401 && (error.code === "unauthenticated" || error.code === "session_expired")) ||
    error.code === "account_disabled"
  )
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** What a successful call returns before it is narrowed: the envelope's `data` and (list endpoints) `meta`. */
interface Envelope<T> {
  data: T
  meta: unknown
}

async function execute<T>(method: string, path: string, options: RequestOptions, retried: boolean): Promise<Envelope<T>> {
  const unsafe = UNSAFE_METHODS.has(method)
  const headers = new Headers({ Accept: "application/json" })
  if (options.body !== undefined) headers.set("Content-Type", "application/json")
  if (options.session && unsafe) {
    const token = getCsrfToken()
    if (token) headers.set("X-CSRF-Token", token)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (isAbort(cause)) throw cause
    throw new ApiError({
      status: 0,
      code: NETWORK_ERROR_CODE,
      message: "The server could not be reached.",
    })
  }

  const parsed = await readJson(response)
  if (response.ok) {
    if (parsed !== null && typeof parsed === "object" && "data" in parsed) {
      const envelope = parsed as { data: T; meta?: unknown }
      return { data: envelope.data, meta: envelope.meta }
    }
    return { data: undefined as T, meta: undefined }
  }

  const error = errorFromBody(response.status, parsed, response.headers.get("X-Request-ID"))
  if (options.session) {
    if (unsafe && error.status === 403 && error.code === "csrf_failed" && !retried) {
      // The token we held went stale (e.g. the session was rotated elsewhere): re-read it ONCE.
      const handlers = getSessionHandlers()
      if (handlers && (await handlers.refreshSession())) return execute<T>(method, path, options, true)
    }
    if (endsTheSession(error)) getSessionHandlers()?.onSessionLost(error.code)
  }
  throw error
}

export async function apiRequest<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  return (await execute<T>(method.toUpperCase(), path, options, false)).data
}

/** Pagination metadata of a list endpoint (`API_CONTRACT.md` §4): the TRUE total, never the page length. */
export interface PageMeta {
  total: number
  limit: number
  offset: number
}

export interface Page<T> {
  items: T[]
  meta: PageMeta
  /** Extra list metadata an endpoint adds next to the page numbers (e.g. status `counts`), untouched. */
  extra: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * A list endpoint: `{ data: T[], meta: { total, limit, offset, … } }`. A response without a valid
 * `meta` is treated as a protocol failure rather than guessed at (no faked totals).
 */
export async function apiRequestPage<T>(method: string, path: string, options: RequestOptions = {}): Promise<Page<T>> {
  const { data, meta } = await execute<T[]>(method.toUpperCase(), path, options, false)
  if (
    !Array.isArray(data) ||
    !isRecord(meta) ||
    typeof meta.total !== "number" ||
    typeof meta.limit !== "number" ||
    typeof meta.offset !== "number"
  ) {
    throw new ApiError({ status: 200, code: "invalid_response", message: "The server returned an unexpected response." })
  }
  const { total, limit, offset, ...extra } = meta
  return { items: data, meta: { total, limit, offset }, extra }
}
