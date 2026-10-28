import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { usePagedRead } from "@/hooks/usePagedRead"
import { ApiError } from "@/lib/api/errors"

/**
 * `keepPrevious` (Search): while a NEW query's first page loads, the last query's rows stay on screen,
 * flagged `refreshing`. They are display only - never the new answer - and an old answer can never replace
 * a newer one, even when its rows are the ones currently shown.
 */
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

const page = (items: string[], total = items.length) => ({ items, raw: items.length, total, extra: undefined })

/** A loader whose every first-page request is held until the test answers it, keyed by query. */
function controlled() {
  const pending = new Map<string, Deferred<ReturnType<typeof page>>>()
  const signals = new Map<string, AbortSignal>()
  const load = (key: string) => (_offset: number, signal: AbortSignal) => {
    const gate = deferred<ReturnType<typeof page>>()
    pending.set(key, gate)
    signals.set(key, signal)
    return gate.promise
  }
  const answer = async (key: string, value: ReturnType<typeof page>) => {
    await act(async () => {
      pending.get(key)!.resolve(value)
      await pending.get(key)!.promise
    })
  }
  return { load, answer, pending, signals }
}

function setup() {
  const c = controlled()
  const hook = renderHook(({ k }) => usePagedRead(k, c.load(k), { keepPrevious: true }), { initialProps: { k: "a" } })
  return { ...c, ...hook }
}

describe("usePagedRead keepPrevious", () => {
  it("the first load has nothing to keep: it is `loading` (a skeleton), not `refreshing`", async () => {
    const { result, answer } = setup()
    expect(result.current).toMatchObject({ loading: true, refreshing: false, items: [] })
    await answer("a", page(["a1", "a2"]))
    expect(result.current).toMatchObject({ loading: false, refreshing: false, items: ["a1", "a2"] })
  })

  it("keeps the last query's rows, flagged refreshing, while the next query loads - then swaps to its own", async () => {
    const { result, rerender, answer } = setup()
    await answer("a", page(["a1", "a2"], 9))
    rerender({ k: "b" })
    expect(result.current).toMatchObject({ loading: false, refreshing: true, items: ["a1", "a2"], total: 9 })
    await answer("b", page(["b1"], 1))
    expect(result.current).toMatchObject({ loading: false, refreshing: false, items: ["b1"], total: 1 })
  })

  it("the kept rows are display only: no Load more and no hasMore until the new first page has arrived", async () => {
    const { result, rerender, answer } = setup()
    await answer("a", page(["a1"], 5))
    expect(result.current.hasMore).toBe(true)
    rerender({ k: "b" })
    expect(result.current.refreshing).toBe(true)
    expect(result.current.hasMore).toBe(false)
    act(() => result.current.loadMore())
    // Nothing was requested for the old query: only the first page of `b` is pending.
    expect(result.current.loadingMore).toBe(false)
  })

  it("an OLD answer arriving late never replaces the newer query's rows - and the old request was aborted", async () => {
    const { result, rerender, answer, signals } = setup()
    await answer("a", page(["a1"]))
    rerender({ k: "b" })
    rerender({ k: "c" })
    expect(signals.get("b")?.aborted).toBe(true)
    await answer("c", page(["c1", "c2"]))
    // `b` answers late, after `c` is on screen.
    await answer("b", page(["STALE"]))
    expect(result.current.items).toEqual(["c1", "c2"])
    expect(result.current.refreshing).toBe(false)
  })

  it("an old answer arriving while the NEW query is still loading does not become the new answer either", async () => {
    const { result, rerender, answer, signals } = setup()
    await answer("a", page(["a1"]))
    rerender({ k: "b" })
    rerender({ k: "c" })
    // `b` (superseded, aborted) answers while `c` is still in flight: the screen still shows `a`'s rows, refreshing.
    await answer("b", page(["STALE"]))
    expect(signals.get("b")?.aborted).toBe(true)
    expect(result.current).toMatchObject({ refreshing: true, items: ["a1"] })
    await answer("c", page(["c1"]))
    expect(result.current.items).toEqual(["c1"])
  })

  it("a failed new query shows the error and NO rows - never the old ones as if they answered", async () => {
    const { result, rerender, answer, pending } = setup()
    await answer("a", page(["a1", "a2"]))
    rerender({ k: "b" })
    await act(async () => {
      pending.get("b")!.reject(new ApiError({ status: 500, code: "internal_error", message: "x" }))
      await pending.get("b")!.promise.catch(() => undefined)
    })
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 500 }))
    expect(result.current).toMatchObject({ items: [], refreshing: false, loading: false })
  })

  it("after a failure, Try again does not bring the older rows back", async () => {
    const { result, rerender, answer, pending } = setup()
    await answer("a", page(["a1"]))
    rerender({ k: "b" })
    await act(async () => {
      pending.get("b")!.reject(new ApiError({ status: 500, code: "internal_error", message: "x" }))
      await pending.get("b")!.promise.catch(() => undefined)
    })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    act(() => result.current.retry())
    expect(result.current).toMatchObject({ loading: true, refreshing: false, items: [] })
    await answer("b", page(["b1"]))
    expect(result.current.items).toEqual(["b1"])
  })

  it("keeps nothing when the last answer was empty (a stale 'no results' under a new query would be wrong)", async () => {
    const { result, rerender, answer } = setup()
    await answer("a", page([], 0))
    rerender({ k: "b" })
    expect(result.current).toMatchObject({ loading: true, refreshing: false, items: [] })
    await answer("b", page(["b1"]))
    expect(result.current.items).toEqual(["b1"])
  })

  it("matches the kept rows by the answer, not by their count: query c shows b's rows even when a and b were the same size", async () => {
    const { result, rerender, answer } = setup()
    await answer("a", page(["a1", "a2"], 2))
    rerender({ k: "b" })
    await answer("b", page(["b1", "b2"], 2))
    rerender({ k: "c" })
    expect(result.current).toMatchObject({ refreshing: true, items: ["b1", "b2"] })
  })

  it("without keepPrevious the list still empties at once (the default for every other list)", async () => {
    const c = controlled()
    const { result, rerender } = renderHook(({ k }) => usePagedRead(k, c.load(k)), { initialProps: { k: "a" } })
    await c.answer("a", page(["a1"]))
    rerender({ k: "b" })
    expect(result.current).toMatchObject({ loading: true, refreshing: false, items: [] })
  })
})
