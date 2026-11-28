import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useMutation } from "@/hooks/useMutation"
import { ApiError } from "@/lib/api/errors"
import { noteIdentity } from "@/lib/api/session"

/**
 * An operation overtaken by an account change must SETTLE (so nothing stays held), tell its caller
 * only that it was abandoned, and never claim the request was cancelled.
 */
function held<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** What the caller was told, or "still pending" if it was never told anything. */
function settlement(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error })
    ),
    new Promise((done) => setTimeout(() => done("still pending"), 200)),
  ])
}

beforeEach(() => {
  noteIdentity(null)
  noteIdentity("account-a")
})

describe("useMutation: the account changed while it was under way", () => {
  const endings: [string, (gate: ReturnType<typeof held<string>>) => void][] = [
    ["a success", (gate) => gate.resolve("saved")],
    ["a refusal", (gate) => gate.reject(new ApiError({ status: 409, code: "listing_conflict", message: "x" }))],
    ["an unknown outcome", (gate) => gate.reject(new TypeError("Failed to fetch"))],
  ]

  it.each(endings)("%s settles as abandoned and releases everything", async (_what, finish) => {
    const gate = held<string>()
    const run = vi.fn(() => gate.promise)
    const { result } = renderHook(() => useMutation(run))
    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.mutate(undefined)
      pending.catch(() => undefined)
    })

    noteIdentity("account-b")
    let told: unknown
    await act(async () => {
      finish(gate)
      told = await settlement(pending)
    })

    expect(told).toMatchObject({ rejected: { name: "OperationAbandoned" } })
    // It says nothing about whether the server carried the request out.
    expect(String((told as { rejected: Error }).rejected.message)).not.toMatch(/cancel/i)
    expect(result.current.pending).toBe(false)
    expect(result.current.status).toBe("idle")

    // Nothing is left holding the control: the next call is a new request.
    run.mockImplementationOnce(async () => "again")
    await act(async () => expect(await result.current.mutate(undefined)).toBe("again"))
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("two callers of one abandoned operation are both told", async () => {
    const gate = held<string>()
    const { result } = renderHook(() => useMutation(() => gate.promise))
    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.mutate(undefined)
      second = result.current.mutate(undefined)
      first.catch(() => undefined)
      second.catch(() => undefined)
    })

    noteIdentity(null) // the session ended
    await act(async () => gate.resolve("saved"))

    for (const caller of [first, second]) {
      expect(await settlement(caller)).toMatchObject({ rejected: { name: "OperationAbandoned" } })
    }
  })

  it("with the same account, a success and a refusal arrive as usual", async () => {
    const { result } = renderHook(() => useMutation(async (fail: boolean) => {
      if (fail) throw new ApiError({ status: 403, code: "csrf_failed", message: "x" })
      return "saved"
    }))
    await act(async () => expect(await result.current.mutate(false)).toBe("saved"))
    await act(async () => expect(result.current.mutate(true)).rejects.toMatchObject({ code: "csrf_failed" }))
  })
})
