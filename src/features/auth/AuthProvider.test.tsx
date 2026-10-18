import { act, render, screen, waitFor } from "@testing-library/react"
import { StrictMode, useLayoutEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { useAuth, type AuthContextValue } from "@/hooks/useAuth"
import { resendVerification } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/errors"
import { getCsrfToken } from "@/lib/api/session"
import { usePlanStore } from "@/state/planStore"
import { useResidentStore } from "@/state/residentStore"
import { deferred, fail, installFetchMock, meBody, noContent, ok } from "@/test/apiMock"

/**
 * Renders the real provider and exposes its context to the test.
 *
 * The probe publishes the context in a LAYOUT effect on purpose: it runs synchronously inside the
 * commit that updates the DOM, so whenever `state()` shows a status, `auth()` already holds that
 * same render's value. With a passive `useEffect` the DOM can be observed one tick before the effect
 * runs, and a read such as `auth().bootstrapError` right after `waitFor(state())` intermittently saw
 * the previous render (~1 in 60 runs) — a test race, not a provider bug.
 */
function setup() {
  const latest: { current: AuthContextValue | null } = { current: null }
  function Probe() {
    const auth = useAuth()
    useLayoutEffect(() => {
      latest.current = auth
    })
    return (
      <p data-testid="state">
        {auth.status}|{auth.user?.displayName ?? "-"}|{auth.notice ?? "-"}
      </p>
    )
  }
  render(
    <StrictMode>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </StrictMode>
  )
  const state = () => screen.getByTestId("state").textContent
  return { auth: () => latest.current as AuthContextValue, state }
}

describe("AuthProvider — bootstrap", () => {
  it("starts in loading and never claims anonymous before /auth/me answers", async () => {
    const gate = deferred<ReturnType<typeof ok>>()
    installFetchMock(() => gate.promise)
    const { state } = setup()

    expect(state()).toBe("loading|-|-")
    await act(async () => {}) // let effects run: the request is still open
    expect(state()).toBe("loading|-|-")

    await act(async () => gate.resolve(ok(meBody())))
    await waitFor(() => expect(state()).toBe("authenticated|Ayesha Khan|-"))
  })

  it("becomes authenticated on 200 and keeps the CSRF token OUT of the user object", async () => {
    const { calls } = installFetchMock(() => ok(meBody({ csrfToken: "csrf-from-me" })))
    const { auth, state } = setup()

    await waitFor(() => expect(state()).toContain("authenticated"))

    expect(getCsrfToken()).toBe("csrf-from-me")
    expect(auth().user).not.toBeNull() // (so the next line is not vacuously true)
    expect(JSON.stringify(auth().user)).not.toContain("csrf")
    expect(calls[0].path).toBe("/auth/me")
    expect(calls[0].credentials).toBe("include")
  })

  it("makes exactly one /auth/me request even under StrictMode's double effects", async () => {
    const { calls } = installFetchMock(() => ok(meBody()))
    const { state } = setup()

    await waitFor(() => expect(state()).toContain("authenticated"))

    expect(calls.filter((c) => c.path === "/auth/me")).toHaveLength(1)
  })

  it("becomes anonymous on 401 unauthenticated, without a notice", async () => {
    installFetchMock(() => fail(401, "unauthenticated"))
    const { state } = setup()

    await waitFor(() => expect(state()).toBe("anonymous|-|-"))
    expect(getCsrfToken()).toBeNull()
  })

  it("shows the 'session ended' notice when the cookie existed but the session is dead", async () => {
    installFetchMock(() => fail(401, "session_expired"))
    const { state } = setup()

    await waitFor(() => expect(state()).toBe("anonymous|-|expired"))
  })

  it("treats a network failure as UNAVAILABLE (recoverable), never as logged out", async () => {
    let online = false
    installFetchMock(() => (online ? ok(meBody()) : "network-error"))
    const { auth, state } = setup()

    await waitFor(() => expect(state()).toContain("unavailable"))
    expect(auth().bootstrapError?.isNetwork).toBe(true)

    online = true
    act(() => auth().retryBootstrap())
    await waitFor(() => expect(state()).toContain("authenticated"))
  })

  it("treats a 5xx as unavailable too", async () => {
    installFetchMock(() => fail(503, "service_unavailable"))
    const { state } = setup()

    await waitFor(() => expect(state()).toContain("unavailable"))
  })
})

describe("AuthProvider — login, register, logout", () => {
  function anonymousBackend(extra: Parameters<typeof installFetchMock>[0] = () => fail(404, "not_found")) {
    return installFetchMock((call) => {
      if (call.path === "/auth/me") return fail(401, "unauthenticated")
      return extra(call)
    })
  }

  it("login: posts the exact fields, becomes authenticated, stores the CSRF token in memory", async () => {
    const { calls } = anonymousBackend((call) =>
      call.path === "/auth/login" ? ok(meBody({ csrfToken: "csrf-login" })) : fail(404, "not_found")
    )
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("anonymous"))

    await act(async () => {
      await auth().login("ayesha@example.org", "correct horse battery")
    })

    expect(state()).toBe("authenticated|Ayesha Khan|-")
    expect(getCsrfToken()).toBe("csrf-login")
    const login = calls.find((c) => c.path === "/auth/login")!
    expect(login.body).toEqual({ email: "ayesha@example.org", password: "correct horse battery" })
    expect(login.headers.has("X-CSRF-Token")).toBe(false) // pre-session
  })

  it("login failure leaves the user anonymous and surfaces the typed error", async () => {
    anonymousBackend((call) => (call.path === "/auth/login" ? fail(401, "invalid_credentials") : fail(404, "x")))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("anonymous"))

    const failure = await act(async () => auth().login("a@b.co", "wrong").catch((e: unknown) => e))

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).code).toBe("invalid_credentials")
    expect(state()).toBe("anonymous|-|-")
    expect(getCsrfToken()).toBeNull()
  })

  it("register: sends only email, password and displayName, then is authenticated", async () => {
    const { calls } = anonymousBackend((call) =>
      call.path === "/auth/register" ? ok(meBody({ emailVerified: false, csrfToken: "csrf-reg" }), 201) : fail(404, "x")
    )
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("anonymous"))

    await act(async () => {
      await auth().register({ email: "new@example.org", password: "a long passphrase", displayName: "New Person" })
    })

    expect(state()).toContain("authenticated")
    expect(auth().user?.emailVerified).toBe(false)
    expect(Object.keys(calls.find((c) => c.path === "/auth/register")!.body as object).sort()).toEqual([
      "displayName",
      "email",
      "password",
    ])
  })

  it("logout: revokes on the server (with the CSRF token), then clears user, token and demo data", async () => {
    const { calls } = installFetchMock((call) => (call.path === "/auth/logout" ? noContent() : ok(meBody({ csrfToken: "csrf-9" }))))
    useResidentStore.setState({ savedItems: [{ kind: "business", id: "b1", savedAt: "2026-01-01" }], requests: [] })
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await auth().logout()
    })

    expect(state()).toBe("anonymous|-|-")
    expect(getCsrfToken()).toBeNull()
    expect(calls.find((c) => c.path === "/auth/logout")!.headers.get("X-CSRF-Token")).toBe("csrf-9")
    expect(useResidentStore.getState().savedItems).toEqual([])
  })

  it("logout when the server session already expired still ends locally", async () => {
    installFetchMock((call) => (call.path === "/auth/logout" ? fail(401, "session_expired") : ok(meBody())))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await auth().logout()
    })

    expect(state()).toContain("anonymous")
  })

  it("logout while the server is unreachable keeps the user signed in and reports the failure", async () => {
    installFetchMock((call) => (call.path === "/auth/logout" ? "network-error" : ok(meBody())))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    const failure = await act(async () => auth().logout().catch((e: unknown) => e))

    expect((failure as ApiError).isNetwork).toBe(true)
    expect(state()).toContain("authenticated") // the server session is still alive: don't pretend otherwise
  })
})

describe("AuthProvider — sessions, CSRF and races", () => {
  it("a 401 on an authenticated request clears the user and token and shows the notice", async () => {
    installFetchMock((call) => (call.path === "/auth/resend-verification" ? fail(401, "session_expired") : ok(meBody())))
    const { state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await resendVerification().catch(() => undefined)
    })

    expect(state()).toBe("anonymous|-|expired")
    expect(getCsrfToken()).toBeNull()
  })

  it("account_disabled on an authenticated request ends the session with the 'disabled' notice", async () => {
    installFetchMock((call) => (call.path === "/auth/resend-verification" ? fail(403, "account_disabled") : ok(meBody())))
    const { state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await resendVerification().catch(() => undefined)
    })

    expect(state()).toBe("anonymous|-|disabled")
  })

  it("csrf_failed → /auth/me → retry once with the REPLACED token", async () => {
    let meCalls = 0
    let resend = 0
    const { calls } = installFetchMock((call) => {
      if (call.path === "/auth/me") return ok(meBody({ csrfToken: ++meCalls === 1 ? "csrf-old" : "csrf-new" }))
      return ++resend === 1 ? fail(403, "csrf_failed") : noContent()
    })
    const { state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await resendVerification()
    })

    const attempts = calls.filter((c) => c.path === "/auth/resend-verification")
    expect(attempts.map((c) => c.headers.get("X-CSRF-Token"))).toEqual(["csrf-old", "csrf-new"])
    expect(getCsrfToken()).toBe("csrf-new")
    expect(calls.filter((c) => c.path === "/auth/me")).toHaveLength(2)
  })

  it("a second csrf_failed is surfaced (no endless retry) and the user stays signed in", async () => {
    const { calls } = installFetchMock((call) => (call.path === "/auth/resend-verification" ? fail(403, "csrf_failed") : ok(meBody())))
    const { state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    const failure = await act(async () => resendVerification().catch((e: unknown) => e))

    expect((failure as ApiError).code).toBe("csrf_failed")
    expect(calls.filter((c) => c.path === "/auth/resend-verification")).toHaveLength(2)
    expect(state()).toContain("authenticated")
  })

  it("concurrent refreshMe() calls share one /auth/me request", async () => {
    const gate = deferred<ReturnType<typeof ok>>()
    let meCalls = 0
    installFetchMock((call) => {
      if (call.path !== "/auth/me") return fail(404, "x")
      return ++meCalls === 1 ? ok(meBody()) : gate.promise
    })
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    let results: boolean[] = []
    await act(async () => {
      const all = Promise.all([auth().refreshMe(), auth().refreshMe(), auth().refreshMe()])
      gate.resolve(ok(meBody()))
      results = await all
    })

    expect(results).toEqual([true, true, true])
    expect(meCalls).toBe(2) // the bootstrap + ONE shared refresh
  })

  it("a stale /auth/me answer cannot overwrite a login that happened meanwhile", async () => {
    const stale = deferred<ReturnType<typeof fail>>()
    let meCalls = 0
    installFetchMock((call) => {
      if (call.path === "/auth/me") return ++meCalls === 1 ? stale.promise : fail(401, "unauthenticated")
      if (call.path === "/auth/login") return ok(meBody({ displayName: "Fresh Login", csrfToken: "csrf-fresh" }))
      return fail(404, "x")
    })
    const { auth, state } = setup()
    await act(async () => {}) // bootstrap request is in flight (and will answer "anonymous" late)

    await act(async () => {
      await auth().login("a@b.co", "pw-long-enough")
    })
    await act(async () => stale.resolve(fail(401, "unauthenticated")))

    expect(state()).toBe("authenticated|Fresh Login|-")
    expect(getCsrfToken()).toBe("csrf-fresh")
  })

  it("a stale authenticated answer cannot resurrect a user who logged out meanwhile", async () => {
    const stale = deferred<ReturnType<typeof ok>>()
    let meCalls = 0
    installFetchMock((call) => {
      if (call.path === "/auth/me") return ++meCalls === 1 ? ok(meBody()) : stale.promise
      if (call.path === "/auth/logout") return noContent()
      return fail(404, "x")
    })
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = auth().refreshMe()
    })
    await act(async () => {
      await auth().logout()
    })
    await act(async () => {
      stale.resolve(ok(meBody()))
      await pending
    })

    expect(state()).toBe("anonymous|-|-")
    expect(getCsrfToken()).toBeNull()
  })

  it("never writes to localStorage or sessionStorage across the whole auth lifecycle", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    installFetchMock((call) => {
      if (call.path === "/auth/me") return fail(401, "unauthenticated")
      if (call.path === "/auth/logout") return noContent()
      return ok(meBody({ csrfToken: "csrf-secret-value" }))
    })
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("anonymous"))
    await act(async () => {
      await auth().login("a@b.co", "super-secret-password")
    })
    await act(async () => {
      await auth().logout()
    })

    // The only writes are the demo stores clearing THEIR OWN non-auth data on logout (resident / plan,
    // until their Phase 12 slices); nothing session-, CSRF- or password-related is ever stored.
    const written = setItem.mock.calls.map(([key, value]) => ({ key, value }))
    expect(written.map((entry) => entry.key).filter((key) => !["b17-resident-store", "b17-plan-store"].includes(key))).toEqual([])
    expect(JSON.stringify(written)).not.toMatch(/csrf|password|secret|session|token/i)
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toMatch(/csrf|password|secret|session|token/i)
  })
})

/**
 * User-scoped DEMO state (Saved items, request history, local plan) is persisted per browser, not
 * per account, until the 12F/12H APIs replace it. Property: it may survive an AUTHENTICATED reload,
 * but never a CONFIRMED transition to anonymous; "unavailable" (network / 5xx) proves nothing about
 * the session and must leave it alone.
 */
describe("AuthProvider — user-scoped demo state isolation", () => {
  beforeEach(() => {
    useResidentStore.setState({
      savedItems: [{ kind: "business", id: "b1", savedAt: "2026-01-01" }],
      requests: [
        {
          id: "r1",
          providerId: "p1",
          providerName: "Provider",
          service: "Wiring",
          details: "d",
          area: "B-17",
          preferredDate: "2026-02-01",
          requestedBy: "User A",
          submittedAt: "2026-01-01T00:00:00Z",
          status: "submitted",
        },
      ],
    })
    usePlanStore.setState({ plan: "premium" })
  })

  const expectCleared = () => {
    expect(useResidentStore.getState().savedItems).toEqual([])
    expect(useResidentStore.getState().requests).toEqual([])
    expect(usePlanStore.getState().plan).toBe("free")
  }
  const expectPreserved = () => {
    expect(useResidentStore.getState().savedItems).toHaveLength(1)
    expect(useResidentStore.getState().requests).toHaveLength(1)
    expect(usePlanStore.getState().plan).toBe("premium")
  }

  it("bootstrap 401 (the cookie expired while the browser was closed) clears resident data and resets the plan", async () => {
    installFetchMock(() => fail(401, "unauthenticated"))
    const { state } = setup()

    await waitFor(() => expect(state()).toBe("anonymous|-|-"))

    expectCleared()
  })

  it("bootstrap 401 session_expired clears them too", async () => {
    installFetchMock(() => fail(401, "session_expired"))
    const { state } = setup()

    await waitFor(() => expect(state()).toBe("anonymous|-|expired"))

    expectCleared()
  })

  it("session_expired on an authenticated request clears them", async () => {
    installFetchMock((call) => (call.path === "/auth/resend-verification" ? fail(401, "session_expired") : ok(meBody())))
    const { state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))
    expectPreserved() // the authenticated bootstrap itself did not touch them

    await act(async () => {
      await resendVerification().catch(() => undefined)
    })

    expect(state()).toBe("anonymous|-|expired")
    expectCleared()
  })

  it("account_disabled (on bootstrap) clears them", async () => {
    installFetchMock(() => fail(403, "account_disabled"))
    const { state } = setup()

    await waitFor(() => expect(state()).toBe("anonymous|-|disabled"))

    expectCleared()
  })

  it("account_disabled on an authenticated request clears them", async () => {
    installFetchMock((call) => (call.path === "/auth/resend-verification" ? fail(403, "account_disabled") : ok(meBody())))
    const { state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await resendVerification().catch(() => undefined)
    })

    expect(state()).toBe("anonymous|-|disabled")
    expectCleared()
  })

  it("explicit logout clears them", async () => {
    installFetchMock((call) => (call.path === "/auth/logout" ? noContent() : ok(meBody())))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await auth().logout()
    })

    expect(state()).toBe("anonymous|-|-")
    expectCleared()
  })

  it("logout when the server session had already expired (401) still clears them", async () => {
    installFetchMock((call) => (call.path === "/auth/logout" ? fail(401, "session_expired") : ok(meBody())))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await auth().logout()
    })

    expectCleared()
  })

  it("a bootstrap NETWORK failure is 'unavailable', not anonymous: nothing is cleared", async () => {
    installFetchMock(() => "network-error")
    const { state } = setup()

    await waitFor(() => expect(state()).toContain("unavailable"))

    expectPreserved()
  })

  it("a bootstrap 5xx is 'unavailable': nothing is cleared", async () => {
    installFetchMock(() => fail(503, "service_unavailable"))
    const { state } = setup()

    await waitFor(() => expect(state()).toContain("unavailable"))

    expectPreserved()
  })

  it("a bootstrap 500 is 'unavailable' too", async () => {
    installFetchMock(() => fail(500, "internal_error"))
    const { state } = setup()

    await waitFor(() => expect(state()).toContain("unavailable"))

    expectPreserved()
  })

  it("an authenticated bootstrap (an ordinary reload) preserves them", async () => {
    installFetchMock(() => ok(meBody()))
    const { state } = setup()

    await waitFor(() => expect(state()).toBe("authenticated|Ayesha Khan|-"))

    expectPreserved()
  })

  it("a logout that fails on the network keeps the session AND the data", async () => {
    installFetchMock((call) => (call.path === "/auth/logout" ? "network-error" : ok(meBody())))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("authenticated"))

    await act(async () => {
      await auth().logout().catch(() => undefined)
    })

    expect(state()).toContain("authenticated")
    expectPreserved()
  })

  it("recovering from 'unavailable' into a CONFIRMED anonymous then clears them", async () => {
    let answer: "down" | "anon" = "down"
    installFetchMock(() => (answer === "down" ? "network-error" : fail(401, "unauthenticated")))
    const { auth, state } = setup()
    await waitFor(() => expect(state()).toContain("unavailable"))
    expectPreserved()

    answer = "anon"
    act(() => auth().retryBootstrap())
    await waitFor(() => expect(state()).toContain("anonymous"))

    expectCleared()
  })
})
