import { describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/lib/api/client"
import { ApiError, fieldErrors, isApiError } from "@/lib/api/errors"
import { clearCsrfToken, setCsrfToken, setSessionHandlers } from "@/lib/api/session"
import { fail, installFetchMock, noContent, ok } from "@/test/apiMock"

describe("apiRequest", () => {
  it("sends cookies (credentials: include), JSON headers, and unwraps the data envelope", async () => {
    const { calls } = installFetchMock(() => ok({ hello: "world" }))

    const result = await apiRequest<{ hello: string }>("POST", "/things", { body: { a: 1 } })

    expect(result).toEqual({ hello: "world" })
    expect(calls[0].credentials).toBe("include")
    expect(calls[0].headers.get("Content-Type")).toBe("application/json")
    expect(calls[0].headers.get("Accept")).toBe("application/json")
    expect(calls[0].url.endsWith("/things")).toBe(true)
    expect(calls[0].body).toEqual({ a: 1 })
  })

  it("sends no Content-Type for a bodiless request and returns undefined for 204", async () => {
    const { calls } = installFetchMock(() => noContent())

    await expect(apiRequest("POST", "/auth/logout", { session: true })).resolves.toBeUndefined()

    expect(calls[0].headers.has("Content-Type")).toBe(false)
  })

  it("never uses an Authorization header (cookie auth only)", async () => {
    setCsrfToken("t")
    const { calls } = installFetchMock(() => ok({}))

    await apiRequest("POST", "/x", { session: true, body: {} })

    expect(calls[0].headers.has("Authorization")).toBe(false)
  })

  it("adds X-CSRF-Token to authenticated unsafe requests only", async () => {
    setCsrfToken("csrf-abc")
    const { calls } = installFetchMock(() => ok({}))

    await apiRequest("POST", "/a", { session: true, body: {} })
    await apiRequest("DELETE", "/b", { session: true })
    await apiRequest("GET", "/c", { session: true })
    await apiRequest("POST", "/login", { body: {} }) // pre-session: no CSRF header

    expect(calls.map((c) => c.headers.get("X-CSRF-Token"))).toEqual(["csrf-abc", "csrf-abc", null, null])
  })

  it("turns the error envelope into a typed ApiError with the request id", async () => {
    installFetchMock(() => fail(422, "validation_error", [{ field: "email", code: "invalid_email", message: "Enter a valid email address." }]))

    const error = await apiRequest("POST", "/auth/register", { body: {} }).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    const apiError = error as ApiError
    expect([apiError.status, apiError.code, apiError.requestId]).toEqual([422, "validation_error", "req-test"])
    expect(fieldErrors(apiError)).toEqual({ email: "Enter a valid email address." })
  })

  it("maps a response that is not the envelope to a generic http_ code", async () => {
    installFetchMock(() => ({ status: 502, body: "<html>bad gateway</html>" }))

    const error = (await apiRequest("GET", "/x").catch((e: unknown) => e)) as ApiError

    expect([error.status, error.code]).toEqual([502, "http_502"])
  })

  it("reports a request that never reached the server as a network error (status 0)", async () => {
    installFetchMock(() => "network-error")

    const error = (await apiRequest("GET", "/x").catch((e: unknown) => e)) as ApiError

    expect([error.status, error.code, error.isNetwork]).toEqual([0, "network_error", true])
  })

  it("passes an aborted request through untouched", async () => {
    const controller = new AbortController()
    vi.stubGlobal("fetch", () => Promise.reject(new DOMException("aborted", "AbortError")))

    controller.abort()

    await expect(apiRequest("GET", "/x", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("csrf_failed recovery (authenticated unsafe requests)", () => {
  function wire(refresh: () => Promise<boolean>) {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: refresh, onSessionLost })
    return { onSessionLost }
  }

  it("refreshes the session once, then retries ONCE with the new token", async () => {
    setCsrfToken("old")
    const refresh = vi.fn(async () => {
      setCsrfToken("new")
      return true
    })
    wire(refresh)
    let attempts = 0
    const { calls } = installFetchMock(() => (++attempts === 1 ? fail(403, "csrf_failed") : noContent()))

    await apiRequest("POST", "/auth/resend-verification", { session: true })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(calls.map((c) => c.headers.get("X-CSRF-Token"))).toEqual(["old", "new"])
  })

  it("surfaces the second csrf_failed instead of looping", async () => {
    setCsrfToken("t")
    const refresh = vi.fn(async () => true)
    wire(refresh)
    const { calls } = installFetchMock(() => fail(403, "csrf_failed"))

    const error = (await apiRequest("POST", "/x", { session: true }).catch((e: unknown) => e)) as ApiError

    expect(error.code).toBe("csrf_failed")
    expect(calls).toHaveLength(2) // the original + exactly one retry
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not retry when the refresh says the session is gone", async () => {
    setCsrfToken("t")
    wire(async () => false)
    const { calls } = installFetchMock(() => fail(403, "csrf_failed"))

    await expect(apiRequest("POST", "/x", { session: true })).rejects.toMatchObject({ code: "csrf_failed" })

    expect(calls).toHaveLength(1)
  })

  it.each([
    ["a 403 that is not csrf_failed", fail(403, "email_not_verified")],
    ["a 409 conflict", fail(409, "listing_conflict")],
    ["a 422 validation failure", fail(422, "validation_error")],
    ["a 429 rate limit", fail(429, "rate_limited")],
  ])("never retries %s", async (_label, reply) => {
    setCsrfToken("t")
    const refresh = vi.fn(async () => true)
    wire(refresh)
    const { calls } = installFetchMock(() => reply)

    await expect(apiRequest("POST", "/x", { session: true })).rejects.toBeInstanceOf(ApiError)

    expect(calls).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("never retries a network failure", async () => {
    const refresh = vi.fn(async () => true)
    wire(refresh)
    const { calls } = installFetchMock(() => "network-error")

    await expect(apiRequest("POST", "/x", { session: true })).rejects.toMatchObject({ isNetwork: true })

    expect(calls).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("never applies the csrf retry to a pre-session POST such as login", async () => {
    clearCsrfToken()
    const refresh = vi.fn(async () => true)
    wire(refresh)
    const { calls } = installFetchMock(() => fail(403, "csrf_failed"))

    await expect(apiRequest("POST", "/auth/login", { body: {} })).rejects.toMatchObject({ code: "csrf_failed" })

    expect(calls).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("session loss", () => {
  it.each([
    ["unauthenticated", 401],
    ["session_expired", 401],
    ["account_disabled", 403],
  ])("an authenticated request answered %s ends the local session", async (code, status) => {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: async () => true, onSessionLost })
    installFetchMock(() => fail(status, code))

    await expect(apiRequest("POST", "/x", { session: true })).rejects.toMatchObject({ code })

    expect(onSessionLost).toHaveBeenCalledTimes(1)
    expect(onSessionLost).toHaveBeenCalledWith(code)
  })

  it("does not end the session for a pre-session 401 (e.g. wrong password)", async () => {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: async () => true, onSessionLost })
    installFetchMock(() => fail(401, "invalid_credentials"))

    await expect(apiRequest("POST", "/auth/login", { body: {} })).rejects.toMatchObject({ code: "invalid_credentials" })

    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it("does not treat an unrelated 401 code on an authenticated request as session loss", async () => {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: async () => true, onSessionLost })
    installFetchMock(() => fail(401, "invalid_credentials"))

    await expect(apiRequest("POST", "/auth/change-password", { session: true, body: {} })).rejects.toBeInstanceOf(ApiError)

    expect(onSessionLost).not.toHaveBeenCalled()
  })
})
