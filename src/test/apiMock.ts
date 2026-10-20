import { afterEach, vi } from "vitest"
import { clearCsrfToken, setSessionHandlers } from "@/lib/api/session"

/**
 * A deterministic stand-in for the backend, installed over `fetch` (test helper only — nothing here
 * ships). Handlers receive the parsed request and return `ok(...)` / `fail(...)`; every call is
 * recorded so tests can assert URLs, headers, credentials and bodies.
 */

export interface MockCall {
  method: string
  path: string
  url: string
  headers: Headers
  credentials: RequestCredentials | undefined
  body: unknown
}

export interface MockReply {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type MockHandler = (call: MockCall) => MockReply | Promise<MockReply> | "network-error"

export const ok = (data?: unknown, status = 200): MockReply => ({
  status: data === undefined && status === 200 ? 204 : status,
  body: data === undefined ? undefined : { data },
})

/** A list endpoint's reply: `{ data: [...], meta: { total, limit, offset, ...extra } }`. */
export const okPage = (
  items: unknown[],
  meta: { total?: number; limit?: number; offset?: number } & Record<string, unknown> = {}
): MockReply => ({
  status: 200,
  body: { data: items, meta: { total: items.length, limit: 50, offset: 0, ...meta } },
})

export const noContent = (): MockReply => ({ status: 204 })

export const fail = (
  status: number,
  code: string,
  details: { field?: string; code?: string; message?: string }[] = []
): MockReply => ({
  status,
  body: { error: { code, message: `server text for ${code}`, details, requestId: "req-test" } },
})

export function meBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Ayesha Khan",
    email: "ayesha@example.org",
    emailVerified: true,
    roles: [],
    authMethods: { password: true, providers: [] },
    session: { expiresAt: "2030-01-01T00:00:00Z" },
    csrfToken: "csrf-1",
    ...overrides,
  }
}

export function installFetchMock(handler: MockHandler) {
  const calls: MockCall[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const call: MockCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      path: new URL(url, "http://test.invalid").pathname.replace(/^.*\/api\/v1/, ""),
      url,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const reply = await handler(call)
    if (reply === "network-error") throw new TypeError("Failed to fetch")
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json", ...reply.headers },
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { calls, fetchMock }
}

/** A promise you resolve by hand: lets a test hold a request open to exercise races. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearCsrfToken()
  setSessionHandlers(null)
})
