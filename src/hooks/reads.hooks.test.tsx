import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useRead } from "@/hooks/useRead"
import { usePagedRead } from "@/hooks/usePagedRead"
import { useSearchResults, SEARCH_PAGE_SIZE } from "@/hooks/useSearchResults"
import { useSearchSuggestions } from "@/hooks/useSearchSuggestions"
import { ApiError } from "@/lib/api/errors"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("useRead", () => {
  it("goes loading -> success", async () => {
    const { result } = renderHook(() => useRead("k", async () => 42))
    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current).toMatchObject({ status: "success", data: 42 })
  })

  it("reports an ApiError, and any other thrown value as a network error", async () => {
    const { result, rerender } = renderHook(({ k, boom }) => useRead(k, async () => { throw boom }), {
      initialProps: { k: "a", boom: new ApiError({ status: 404, code: "not_found", message: "x" }) as unknown },
    })
    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current).toMatchObject({ status: "error", error: { status: 404, code: "not_found" } })
    rerender({ k: "b", boom: new TypeError("raw") })
    await waitFor(() => expect(result.current).toMatchObject({ status: "error", error: { status: 0 } }))
  })

  it("never applies a stale answer: a slow response to an old key cannot overwrite a newer one", async () => {
    const slow = deferred<string>()
    const loads: Record<string, () => Promise<string>> = { old: () => slow.promise, fresh: async () => "fresh" }
    const { result, rerender } = renderHook(({ k }) => useRead(k, () => loads[k]()), { initialProps: { k: "old" } })
    rerender({ k: "fresh" })
    await waitFor(() => expect(result.current).toMatchObject({ status: "success", data: "fresh" }))
    await act(async () => {
      slow.resolve("old")
      await slow.promise
    })
    expect(result.current).toMatchObject({ status: "success", data: "fresh" })
  })

  it("shows loading (not the previous key's data) the moment the key changes", async () => {
    const next = deferred<string>()
    const { result, rerender } = renderHook(({ k }) => useRead(k, () => (k === "a" ? Promise.resolve("A") : next.promise)), {
      initialProps: { k: "a" },
    })
    await waitFor(() => expect(result.current.status).toBe("success"))
    rerender({ k: "b" })
    expect(result.current.status).toBe("loading")
    await act(async () => {
      next.resolve("B")
      await next.promise
    })
    await waitFor(() => expect(result.current).toMatchObject({ status: "success", data: "B" }))
  })

  it("aborts the previous request's signal when the key changes and on unmount", async () => {
    const signals: AbortSignal[] = []
    const { rerender, unmount } = renderHook(({ k }) => useRead(k, (signal) => { signals.push(signal); return new Promise<string>(() => {}) }), {
      initialProps: { k: "a" },
    })
    rerender({ k: "b" })
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    unmount()
    expect(signals[1].aborted).toBe(true)
  })

  it("does not send anything while disabled, and sends once enabled", async () => {
    const load = vi.fn(async () => "x")
    const { result, rerender } = renderHook(({ enabled }) => useRead("k", load, { enabled }), { initialProps: { enabled: false } })
    expect(result.current.status).toBe("loading")
    expect(load).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("retry asks again after a failure", async () => {
    let attempts = 0
    const { result } = renderHook(() =>
      useRead("k", async () => {
        attempts += 1
        if (attempts === 1) throw new ApiError({ status: 500, code: "internal_error", message: "x" })
        return "ok"
      })
    )
    await waitFor(() => expect(result.current.status).toBe("error"))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current).toMatchObject({ status: "success", data: "ok" }))
    expect(attempts).toBe(2)
  })
})

describe("usePagedRead", () => {
  const page = (from: number, count: number, total: number) => ({
    items: Array.from({ length: count }, (_, i) => from + i),
    raw: count,
    total,
    extra: undefined,
  })

  it("loads the next server page by raw offset and keeps the server's total", async () => {
    const offsets: number[] = []
    const { result } = renderHook(() =>
      usePagedRead("k", async (offset) => {
        offsets.push(offset)
        return page(offset, Math.min(2, 5 - offset), 5)
      })
    )
    await waitFor(() => expect(result.current.items).toEqual([0, 1]))
    expect(result.current).toMatchObject({ total: 5, hasMore: true })
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual([0, 1, 2, 3]))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual([0, 1, 2, 3, 4]))
    expect(offsets).toEqual([0, 2, 4])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.total).toBe(5)
  })

  it("drops loaded pages when the query changes", async () => {
    const { result, rerender } = renderHook(({ k }) => usePagedRead(k, async (offset) => page(k === "a" ? offset : 100 + offset, 2, 6)), {
      initialProps: { k: "a" },
    })
    await waitFor(() => expect(result.current.items).toEqual([0, 1]))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(4))
    rerender({ k: "b" })
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(result.current.items).toEqual([100, 101]))
  })

  it("keeps the loaded results and reports a Load-more failure separately", async () => {
    const { result } = renderHook(() =>
      usePagedRead("k", async (offset) => {
        if (offset > 0) throw new ApiError({ status: 0, code: "network_error", message: "x" })
        return page(0, 2, 5)
      })
    )
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.moreError).not.toBeNull())
    expect(result.current.items).toEqual([0, 1])
    expect(result.current.error).toBeNull()
    expect(result.current.hasMore).toBe(true)
  })

  it("ignores a late Load-more answer for a query that is no longer current", async () => {
    const late = deferred<ReturnType<typeof page>>()
    const { result, rerender } = renderHook(
      ({ k }) => usePagedRead(k, (offset) => (k === "a" && offset > 0 ? late.promise : Promise.resolve(page(k === "a" ? 0 : 50, 2, 6)))),
      { initialProps: { k: "a" } }
    )
    await waitFor(() => expect(result.current.items).toEqual([0, 1]))
    act(() => result.current.loadMore())
    rerender({ k: "b" })
    await waitFor(() => expect(result.current.items).toEqual([50, 51]))
    await act(async () => {
      late.resolve(page(2, 2, 6))
      await late.promise
    })
    expect(result.current.items).toEqual([50, 51])
  })

  it("surfaces a first-page failure as `error`, with no items", async () => {
    const { result } = renderHook(() =>
      usePagedRead("k", async () => {
        throw new ApiError({ status: 500, code: "internal_error", message: "x" })
      })
    )
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 500 }))
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})

describe("useSearchResults", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("requests the committed state with the page size and reports the server total", async () => {
    const { calls } = installFetchMock(fakeBackend())
    const { result } = renderHook(() => useSearchResults("solar", "provider", { area: "B-17, Block C (Demo Area)" }, "default"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const params = new URL(calls[0].url, "http://x").searchParams
    expect(Object.fromEntries(params)).toEqual({
      q: "solar",
      type: "provider",
      area: "B-17, Block C (Demo Area)",
      limit: String(SEARCH_PAGE_SIZE),
      offset: "0",
    })
    expect(result.current.results.map((hit) => hit.kind)).toEqual(["provider"])
    expect(result.current.total).toBe(1)
  })

  it("only sends `sort` when it is not the default", async () => {
    const { calls } = installFetchMock(fakeBackend())
    const { result, rerender } = renderHook(({ sort }) => useSearchResults("", "all", {}, sort), { initialProps: { sort: "default" as "default" | "newest" } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(new URL(calls[0].url, "http://x").searchParams.has("sort")).toBe(false)
    rerender({ sort: "newest" })
    await waitFor(() => expect(calls.some((c) => c.url.includes("sort=newest"))).toBe(true))
  })

  it("reports an empty result as empty, not as an error", async () => {
    installFetchMock(fakeBackend())
    const { result } = renderHook(() => useSearchResults("zzzzz-nothing", "all"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ results: [], total: 0, error: null, hasMore: false })
  })

  it("reports a network failure as an error and recovers on retry", async () => {
    let down = true
    installFetchMock((call) => (down ? "network-error" : fakeBackend()(call)))
    const { result } = renderHook(() => useSearchResults("solar", "all"))
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 0 }))
    expect(result.current.results).toEqual([])
    down = false
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.error).toBeNull()
  })
})

describe("useSearchSuggestions", () => {
  it("sends nothing for text shorter than two characters", async () => {
    vi.useFakeTimers()
    const { calls } = installFetchMock(fakeBackend())
    const { result } = renderHook(() => useSearchSuggestions("s", "all"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls).toHaveLength(0)
    expect(result.current).toEqual([])
  })

  it("debounces: rapid typing sends one request for the last text", async () => {
    vi.useFakeTimers()
    const { calls } = installFetchMock(fakeBackend())
    const { result, rerender } = renderHook(({ q }) => useSearchSuggestions(q, "all"), { initialProps: { q: "" } })
    rerender({ q: "so" })
    rerender({ q: "sol" })
    rerender({ q: "sola" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    const suggestionCalls = calls.filter((c) => c.path === "/search/suggestions")
    expect(suggestionCalls).toHaveLength(1)
    expect(new URL(suggestionCalls[0].url, "http://x").searchParams.get("q")).toBe("sola")
    expect(result.current.map((s) => s.label)).toContain("Sunrise Solar Solutions")
  })

  it("passes the selected type and hides the list at once when the box is cleared", async () => {
    vi.useFakeTimers()
    const { calls } = installFetchMock(fakeBackend())
    const { result, rerender } = renderHook(({ q }) => useSearchSuggestions(q, "business"), { initialProps: { q: "glow" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls[0].url).toContain("type=business")
    expect(result.current.length).toBeGreaterThan(0)
    rerender({ q: "" })
    expect(result.current).toEqual([])
  })

  it("shows none (never an error) when the request fails", async () => {
    vi.useFakeTimers()
    installFetchMock(() => "network-error")
    const { result } = renderHook(() => useSearchSuggestions("solar", "all"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current).toEqual([])
  })
})
