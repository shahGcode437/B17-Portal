import { API_BASE_URL } from "@/config/api"
import { ApiError, NETWORK_ERROR_CODE, errorFromBody, sessionChangedError } from "@/lib/api/errors"
import { confirmPrivateAnswer } from "@/lib/api/sessionCheck"
import { bindSession, getCsrfToken, getSessionHandlers, isStillBound } from "@/lib/api/session"

/**
 * The one place the SPA talks to the backend (Phase 12C).
 *
 *  - Cookie auth: every call uses `credentials: "include"`; the HttpOnly session cookie is attached
 *    by the browser and is never readable here. There is no bearer-token code anywhere.
 *  - `session: true` marks an AUTHENTICATED call: it carries `X-CSRF-Token` (a change proves
 *    itself with it; a read NAMES the session it means, and the server refuses any other with
 *    `403 session_mismatch`, `docs/backend/AUTH_RBAC.md` §38), and a
 *    `401 unauthenticated|session_expired` (or `account_disabled`) ends the local session, but
 *    only if the tab still holds the session the request was sent as: a late refusal of an
 *    earlier one says nothing about a newer one. Pre-session calls (login, register,
 *    forgot/reset password, verify-email, `/auth/me` itself) leave `session` off.
 *  - A PRIVATE ANSWER IS ALSO CONFIRMED BEFORE IT IS HANDED OVER, whatever the server does with
 *    the name: an older server ignores it and answers for whoever the cookie belongs to. A
 *    successful `session: true` read is returned only if an `/auth/me` sent AFTER it arrived
 *    shows the same session the tab held when it was sent (`lib/api/sessionCheck`); otherwise it
 *    is dropped (`session_changed`), or reported as unreachable if that can't be asked.
 *  - NO REQUEST IS EVER SENT TWICE. The session cookie belongs to the browser, not to this tab:
 *    another tab may have signed in as somebody else, and re-sending with the new CSRF token would
 *    carry this person's change out as them. A `403 csrf_failed` re-reads `/auth/me` once (so the
 *    tab learns who it is now) and then reaches the caller; only the person can send it again. A
 *    check of "is it still the same account?" before re-sending would not be enough: the cookie can
 *    change hands between that check and the request.
 *  - Failures become typed `ApiError`s from the backend's error envelope.
 */

export interface RequestOptions {
  body?: unknown
  signal?: AbortSignal
  /** An authenticated call: session header, confirmed answer (reads), session-loss handling. */
  session?: boolean
  /** Extra request headers an endpoint requires (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>
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

async function execute<T>(method: string, path: string, options: RequestOptions): Promise<Envelope<T>> {
  const unsafe = UNSAFE_METHODS.has(method)
  const sentAs = bindSession()
  const headers = new Headers({ ...options.headers, Accept: "application/json" })
  if (options.body !== undefined) headers.set("Content-Type", "application/json")
  if (options.session) {
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
    if (options.session && !unsafe) await confirmPrivateAnswer(sentAs, options.signal)
    if (parsed !== null && typeof parsed === "object" && "data" in parsed) {
      const envelope = parsed as { data: T; meta?: unknown }
      return { data: envelope.data, meta: envelope.meta }
    }
    return { data: undefined as T, meta: undefined }
  }

  const error = errorFromBody(response.status, parsed, response.headers.get("X-Request-ID"))
  if (options.session) {
    if (!unsafe && error.status === 403 && error.code === "session_mismatch") {
      // The server answered no data. To the screen this is an answer that couldn't be used.
      if (isStillBound(sentAs)) await getSessionHandlers()?.onSessionMismatch()
      throw sessionChangedError()
    }
    if (unsafe && error.status === 403 && error.code === "csrf_failed") {
      // The token we held is not this browser's session any more. Re-read who is signed in (and the
      // current token) BEFORE the caller hears of the refusal, then let the refusal through.
      await getSessionHandlers()?.refreshSession()
    }
    if (endsTheSession(error) && isStillBound(sentAs)) getSessionHandlers()?.onSessionLost(error.code)
  }
  throw error
}

export async function apiRequest<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  return (await execute<T>(method.toUpperCase(), path, options)).data
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
  const { data, meta } = await execute<T[]>(method.toUpperCase(), path, options)
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
