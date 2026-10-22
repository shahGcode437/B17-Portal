import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useMutation } from "@/hooks/useMutation"
import { ApiError } from "@/lib/api/errors"

describe("useMutation", () => {
  it("goes idle → submitting → success", async () => {
    const { result } = renderHook(() => useMutation(async (n: number) => n * 2))
    expect(result.current.status).toBe("idle")
    let returned: number | undefined
    await act(async () => {
      returned = await result.current.mutate(3)
    })
    expect(returned).toBe(6)
    await waitFor(() => expect(result.current.status).toBe("success"))
    if (result.current.status === "success") expect(result.current.data).toBe(6)
  })

  it("goes idle → submitting → error, and rethrows the typed error from mutate", async () => {
    const { result } = renderHook(() =>
      useMutation(async () => {
        throw new ApiError({ status: 409, code: "listing_conflict", message: "stale" })
      })
    )
    let caught: unknown
    await act(async () => {
      caught = await result.current.mutate(undefined).catch((e: unknown) => e)
    })
    expect(caught).toMatchObject({ status: 409, code: "listing_conflict" })
    await waitFor(() => expect(result.current.status).toBe("error"))
  })

  it("duplicate calls while a request is in flight share the first in-flight promise", async () => {
    let resolveFirst: (value: string) => void = () => undefined
    const first = new Promise<string>((resolve) => (resolveFirst = resolve))
    const run = vi.fn(async () => first)
    const { result } = renderHook(() => useMutation(run))
    let doneA: string | undefined
    let doneB: string | undefined
    await act(async () => {
      const a = result.current.mutate(undefined)
      const b = result.current.mutate(undefined)
      resolveFirst("done")
      doneA = await a
      doneB = await b
    })
    expect(doneA).toBe("done")
    expect(doneB).toBe("done")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("reset() goes back to idle", async () => {
    const { result } = renderHook(() => useMutation(async () => 1))
    await act(async () => {
      await result.current.mutate(undefined)
    })
    await waitFor(() => expect(result.current.status).toBe("success"))
    act(() => result.current.reset())
    expect(result.current.status).toBe("idle")
  })

  it("a thrown non-ApiError becomes a network ApiError", async () => {
    const { result } = renderHook(() =>
      useMutation(async () => {
        throw new TypeError("Failed to fetch")
      })
    )
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.mutate(undefined).catch((e: unknown) => e)
    })
    expect(outcome).toMatchObject({ status: 0, code: "network_error" })
  })
})
