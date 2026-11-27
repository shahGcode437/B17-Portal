import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SUBMIT_TIMEOUT_MS,
  SubmissionFailed,
  SubmissionSuperseded,
  isDraftHidden,
  syncDraftWithAuth,
  useGroceryDraft,
} from "@/features/grocery/groceryDraftStore"
import { EMPTY_DELIVERY, buildOrderRequest } from "@/features/grocery/orderRequest"
import { setCsrfToken } from "@/lib/api/session"
import { deferred, installFetchMock, type MockCall, type MockReply } from "@/test/apiMock"
import { GroceryBackend, TEST_BLOCKS } from "@/test/fixtures/groceryBackend"

const VIEWER = { key: "u1", emailVerified: true }
const draft = () => useGroceryDraft.getState()

function fill() {
  draft().addItem({ name: "Rice", quantity: "2", unit: "kg", preferredBrand: "", substitution: "ask", note: "" })
  draft().setDelivery({ ...EMPTY_DELIVERY, contactName: "Ayesha", contactPhone: "03001234567", block: TEST_BLOCKS[0], addressLine: "House 17, Street 4" })
}
const request = () => buildOrderRequest(draft().items, draft().delivery)

/** The fake backend over `fetch`; `fault` replaces the answer of one submission. */
function server(backend: GroceryBackend, faults: ("lost-before" | "lost-after" | "500-after" | MockReply)[] = []) {
  const answer = (call: MockCall) =>
    backend.route(call.method, call.path, new URLSearchParams(), call.body, call.headers.get("Idempotency-Key"), VIEWER) as MockReply
  return installFetchMock((call) => {
    const fault = faults.shift()
    if (fault === "lost-before") return "network-error"
    if (fault === "lost-after") {
      answer(call)
      return "network-error"
    }
    if (fault === "500-after") {
      answer(call)
      return { status: 500, body: { error: { code: "internal_error", message: "boom" } } }
    }
    return fault ?? answer(call)
  })
}

const keys = (calls: MockCall[]) => calls.map((call) => call.headers.get("Idempotency-Key"))
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause
  )
  expect(error).toBeInstanceOf(SubmissionFailed)
  return (error as SubmissionFailed).problem
}

beforeEach(() => {
  draft().reset()
  setCsrfToken("csrf-1")
})
afterEach(() => vi.useRealTimers())

describe("sending a grocery order", () => {
  it("sends one request with a key and the CSRF token, then clears the draft", async () => {
    const backend = new GroceryBackend()
    const { calls } = server(backend)
    fill()

    const id = await draft().submit(request())

    expect(calls).toHaveLength(1)
    expect(calls[0].headers.get("X-CSRF-Token")).toBe("csrf-1")
    expect(calls[0].headers.get("Idempotency-Key")).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(calls[0].credentials).toBe("include")
    expect(draft()).toMatchObject({ items: [], delivery: EMPTY_DELIVERY, phase: "idle", attempt: null, sentOrderId: id })
    expect(backend.orders).toHaveLength(1)
  })

  it("a double submit shares one request and one order", async () => {
    const backend = new GroceryBackend()
    const { calls } = server(backend)
    fill()
    const body = request()

    const [first, second] = await Promise.all([draft().submit(body), draft().submit(body)])

    expect(first).toBe(second)
    expect(calls).toHaveLength(1)
    expect(backend.orders).toHaveLength(1)
  })

  it.each(["lost-before", "lost-after", "500-after"] as const)(
    "an unknown outcome (%s) locks the draft and retries with the SAME key and body: exactly one order",
    async (fault) => {
      const backend = new GroceryBackend()
      const { calls } = server(backend, [fault])
      fill()

      const problem = await failure(draft().submit(request()))

      expect(problem.kind).toBe("unknown")
      expect(draft().phase).toBe("unconfirmed")
      const before = draft().items
      draft().addItem({ name: "Milk", quantity: "1", unit: "litre", preferredBrand: "", substitution: "ask", note: "" })
      draft().removeItem(before[0].id)
      draft().setDelivery({ ...draft().delivery, addressLine: "Somewhere else" })
      expect(draft().items).toBe(before) // locked: nothing changed
      expect(draft().delivery.addressLine).toBe("House 17, Street 4")

      const id = await draft().retry()

      expect(keys(calls)[1]).toBe(keys(calls)[0])
      expect(calls[1].body).toEqual(calls[0].body)
      expect(backend.orders.map((o) => o.detail.id)).toEqual([id])
      expect(draft().phase).toBe("idle")
    }
  )

  it("a submission that never answers times out as unknown", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      }))
    )
    fill()
    const pending = failure(draft().submit(request()))
    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS)

    expect((await pending).kind).toBe("unknown")
    expect(draft().phase).toBe("unconfirmed")
  })

  it.each([401, 403, 429])("a %s on a RETRY proves nothing about the first send, so the attempt is kept", async (status) => {
    const backend = new GroceryBackend()
    const refusal: MockReply = { status, body: { error: { code: status === 429 ? "rate_limited" : status === 401 ? "session_expired" : "email_not_verified", message: "x" } } }
    const { calls } = server(backend, ["lost-after", refusal])
    fill()
    await failure(draft().submit(request()))

    const problem = await failure(draft().retry())

    expect(problem.kind).toBe("unknown")
    expect(draft().phase).toBe("unconfirmed")
    await draft().retry()
    expect(new Set(keys(calls)).size).toBe(1)
    expect(backend.orders).toHaveLength(1)
  })

  it("a refusal stores nothing, keeps the draft editable, and the next send is a new key", async () => {
    const backend = new GroceryBackend()
    backend.closed = true
    const { calls } = server(backend)
    fill()

    const problem = await failure(draft().submit(request()))

    expect(problem).toMatchObject({ kind: "refused", error: { code: "grocery_closed" } })
    expect(draft()).toMatchObject({ phase: "idle", attempt: null })
    expect(draft().items).toHaveLength(1)
    backend.closed = false
    await draft().submit(request())
    expect(keys(calls)[1]).not.toBe(keys(calls)[0])
  })

  it("after discarding an unconfirmed attempt, the edited order gets a new key", async () => {
    const backend = new GroceryBackend()
    const { calls } = server(backend, ["lost-before"])
    fill()
    await failure(draft().submit(request()))

    draft().discardAttempt()
    draft().addItem({ name: "Milk", quantity: "1", unit: "litre", preferredBrand: "", substitution: "ask", note: "" })
    await draft().submit(request())

    expect(keys(calls)[1]).not.toBe(keys(calls)[0])
  })

  it("an answer that arrives after the draft was cleared is ignored", async () => {
    const gate = deferred<MockReply>()
    installFetchMock(() => gate.promise)
    fill()
    const sending = draft().submit(request())

    draft().reset() // signed out meanwhile
    gate.resolve({ status: 201, body: { data: { id: "late" } } })

    await expect(sending).rejects.toBeInstanceOf(SubmissionSuperseded)
    expect(draft()).toMatchObject({ items: [], phase: "idle", sentOrderId: null })
  })
})

describe("the draft belongs to an account", () => {
  it("a list written before signing in is adopted by the account that signs in", () => {
    fill()
    syncDraftWithAuth("anonymous", "authenticated", "u1", null)
    expect(draft().ownerId).toBe("u1")
    expect(draft().items).toHaveLength(1)
  })

  it("signing out clears it, details and all", () => {
    syncDraftWithAuth(null, "authenticated", "u1", null)
    fill()
    syncDraftWithAuth("authenticated", "anonymous", null, null)
    expect(draft()).toMatchObject({ ownerId: null, items: [], delivery: EMPTY_DELIVERY })
  })

  it("another account never sees it", () => {
    syncDraftWithAuth(null, "authenticated", "u1", null)
    fill()
    syncDraftWithAuth("anonymous", "authenticated", "u2", null)
    expect(draft()).toMatchObject({ ownerId: "u2", items: [] })
  })

  it("an expired session keeps it, hidden, for the same account only", () => {
    syncDraftWithAuth(null, "authenticated", "u1", null)
    fill()
    syncDraftWithAuth("authenticated", "anonymous", null, "expired")
    expect(draft().items).toHaveLength(1)
    expect(isDraftHidden(draft().ownerId, null)).toBe(true)
    expect(isDraftHidden(draft().ownerId, "u2")).toBe(true)
    expect(isDraftHidden(draft().ownerId, "u1")).toBe(false)
    syncDraftWithAuth("anonymous", "authenticated", "u1", null)
    expect(draft().items).toHaveLength(1)
  })

  it("a disabled account loses it, and loading or an unreachable server change nothing", () => {
    syncDraftWithAuth(null, "authenticated", "u1", null)
    fill()
    syncDraftWithAuth("authenticated", "loading", null, null)
    syncDraftWithAuth("authenticated", "unavailable", null, null)
    expect(draft().items).toHaveLength(1)
    syncDraftWithAuth("authenticated", "anonymous", null, "disabled")
    expect(draft().items).toEqual([])
  })

  it("keeps nothing in web storage", async () => {
    server(new GroceryBackend(), ["lost-before"])
    fill()
    await failure(draft().submit(request()))
    expect(window.localStorage).toHaveLength(0)
    expect(window.sessionStorage).toHaveLength(0)
  })
})
