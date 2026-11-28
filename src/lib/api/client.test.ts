import { describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/lib/api/client"
import { ApiError, fieldErrors, isApiError } from "@/lib/api/errors"
import { clearCsrfToken, getCsrfToken, setCsrfToken, setSessionHandlers } from "@/lib/api/session"
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

  it("adds X-CSRF-Token to authenticated requests only: reads name the session, changes prove it", async () => {
    setCsrfToken("csrf-abc")
    const { calls } = installFetchMock(() => ok({}))

    await apiRequest("POST", "/a", { session: true, body: {} })
    await apiRequest("DELETE", "/b", { session: true })
    await apiRequest("GET", "/c", { session: true })
    await apiRequest("POST", "/login", { body: {} }) // pre-session: no CSRF header

    expect(calls.map((c) => c.headers.get("X-CSRF-Token"))).toEqual(["csrf-abc", "csrf-abc", "csrf-abc", null])
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
    setSessionHandlers({ refreshSession: refresh, observeSession: async () => ({ kind: "session", token: getCsrfToken() ?? "" }), onSessionLost, onSessionMismatch: async () => {} })
    return { onSessionLost }
  }

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s: re-reads the session once and NEVER sends the request again, even with a new token",
    async (method) => {
      setCsrfToken("old")
      const refresh = vi.fn(async () => {
        setCsrfToken("possibly-someone-elses")
        return true
      })
      const { onSessionLost } = wire(refresh)
      // A second attempt would succeed: that is exactly what must not be tried.
      let attempts = 0
      const { calls } = installFetchMock(() => (++attempts === 1 ? fail(403, "csrf_failed") : noContent()))

      await expect(
        apiRequest(method, "/x", { session: true, headers: { "Idempotency-Key": "key-0001" } })
      ).rejects.toMatchObject({ status: 403, code: "csrf_failed" })

      expect(refresh).toHaveBeenCalledTimes(1)
      expect(calls.map((c) => [c.headers.get("X-CSRF-Token"), c.headers.get("Idempotency-Key")])).toEqual([
        ["old", "key-0001"],
      ])
      expect(onSessionLost).not.toHaveBeenCalled()
    }
  )

  it("finishes re-reading the session before the caller hears of the refusal", async () => {
    setCsrfToken("old")
    const order: string[] = []
    wire(async () => {
      await Promise.resolve()
      setCsrfToken("new")
      order.push("session re-read")
      return true
    })
    let attempts = 0
    const { calls } = installFetchMock(() => (++attempts === 1 ? fail(403, "csrf_failed") : noContent()))

    await apiRequest("POST", "/x", { session: true }).catch(() => order.push("caller told"))
    await apiRequest("POST", "/x", { session: true }) // the person's own second try

    expect(order).toEqual(["session re-read", "caller told"])
    expect(calls.map((c) => c.headers.get("X-CSRF-Token"))).toEqual(["old", "new"])
  })

  it("is refused the same way when the re-read says the session is gone", async () => {
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

describe("a read refused because the sign-in changed (§38)", () => {
  function wire() {
    const onSessionMismatch = vi.fn(async () => {})
    const onSessionLost = vi.fn()
    setSessionHandlers({
      refreshSession: async () => true,
      observeSession: async () => ({ kind: "session", token: getCsrfToken() ?? "" }),
      onSessionLost,
      onSessionMismatch,
    })
    return { onSessionMismatch, onSessionLost }
  }

  it("asks who is signed in, once, hands over nothing and does not ask again", async () => {
    setCsrfToken("mine")
    const { onSessionMismatch, onSessionLost } = wire()
    const { calls } = installFetchMock(() => fail(403, "session_mismatch"))

    await expect(apiRequest("GET", "/saved", { session: true })).rejects.toMatchObject({ code: "session_changed" })

    expect(calls.map((c) => [c.path, c.headers.get("X-CSRF-Token")])).toEqual([["/saved", "mine"]])
    expect(onSessionMismatch).toHaveBeenCalledTimes(1)
    expect(onSessionLost).not.toHaveBeenCalled() // the other session is not this tab's to end
  })

  it("an answer about a sign-in this tab has already left starts nothing", async () => {
    setCsrfToken("mine")
    const { onSessionMismatch } = wire()
    installFetchMock(() => {
      clearCsrfToken()
      return fail(403, "session_mismatch")
    })

    await expect(apiRequest("GET", "/saved", { session: true })).rejects.toBeInstanceOf(ApiError)

    expect(onSessionMismatch).not.toHaveBeenCalled()
  })

  it("a public read names nobody, signed in or not", async () => {
    setCsrfToken("mine")
    const { calls } = installFetchMock(() => ok({}))

    await apiRequest("GET", "/categories")

    expect(calls[0].headers.get("X-CSRF-Token")).toBeNull()
  })
})

describe("session loss", () => {
  it.each([
    ["unauthenticated", 401],
    ["session_expired", 401],
    ["account_disabled", 403],
  ])("an authenticated request answered %s ends the local session", async (code, status) => {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: async () => true, observeSession: async () => ({ kind: "session", token: getCsrfToken() ?? "" }), onSessionLost, onSessionMismatch: async () => {} })
    installFetchMock(() => fail(status, code))

    await expect(apiRequest("POST", "/x", { session: true })).rejects.toMatchObject({ code })

    expect(onSessionLost).toHaveBeenCalledTimes(1)
    expect(onSessionLost).toHaveBeenCalledWith(code)
  })

  it("does not end the session for a pre-session 401 (e.g. wrong password)", async () => {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: async () => true, observeSession: async () => ({ kind: "session", token: getCsrfToken() ?? "" }), onSessionLost, onSessionMismatch: async () => {} })
    installFetchMock(() => fail(401, "invalid_credentials"))

    await expect(apiRequest("POST", "/auth/login", { body: {} })).rejects.toMatchObject({ code: "invalid_credentials" })

    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it("does not treat an unrelated 401 code on an authenticated request as session loss", async () => {
    const onSessionLost = vi.fn()
    setSessionHandlers({ refreshSession: async () => true, observeSession: async () => ({ kind: "session", token: getCsrfToken() ?? "" }), onSessionLost, onSessionMismatch: async () => {} })
    installFetchMock(() => fail(401, "invalid_credentials"))

    await expect(apiRequest("POST", "/auth/change-password", { session: true, body: {} })).rejects.toBeInstanceOf(ApiError)

    expect(onSessionLost).not.toHaveBeenCalled()
  })
})
