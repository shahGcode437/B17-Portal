/**
 * An in-memory stand-in for the backend's READ endpoints for Vitest, on top of the shared
 * `routeRead` contract. Component tests drive real flows - search, "Load more", detail, not-found -
 * through `installFetchMock(fakeBackend(...))`. Any write is a `405`, so a test that accidentally
 * mutates fails loudly.
 */
import { fail, ok, type MockCall, type MockHandler, type MockReply } from "../apiMock"
import { routeRead } from "./readRouter"

export { ALL_LISTINGS } from "./readRouter"

export interface FakeBackendOptions {
  /** Per-path replies that win over the defaults (`METHOD path` or just `path`). */
  overrides?: Record<string, MockReply | MockHandler | "network-error">
  /** Signed-in session data for `/auth/me`; omit for a signed-out visitor (401). */
  me?: Record<string, unknown>
}

export function fakeBackend(options: FakeBackendOptions = {}): MockHandler {
  return (call: MockCall) => {
    const override = options.overrides?.[`${call.method} ${call.path}`] ?? options.overrides?.[call.path]
    if (override !== undefined) return typeof override === "function" ? override(call) : override

    if (call.path === "/auth/me") return options.me ? ok(options.me) : fail(401, "unauthenticated")
    if (call.method !== "GET") return fail(405, "method_not_allowed")
    const q = new URL(call.url, "http://test.invalid").searchParams
    const roles = (options.me?.roles as string[] | undefined) ?? []
    return routeRead(call.method, call.path, q, options.me ? { roles } : null) ?? fail(404, "not_found")
  }
}
