import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SearchPage } from "@/features/search/SearchPage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { fail, installFetchMock, okPage, type MockCall, type MockReply } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { BUSINESSES } from "@/test/fixtures/apiFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * (Merged into main from the parallel S4 worktree; adapted to main's markup: `aria-busy` is present only while
 * refreshing, and the status line says "Updating results…".)
 *
 * Changing the query or a filter keeps the rows already on screen (dimmed, the grid marked busy) until the
 * new answer arrives, instead of collapsing the list into a skeleton and losing the reader's place. An answer
 * for an older query can never replace a newer one, and a failed refresh shows the failure, not the old rows.
 */
beforeEach(() => {
  resetCategoryCache()
  installFetchMock(fakeBackend())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const paramsOf = (call: MockCall) => Object.fromEntries(new URL(call.url, "http://x").searchParams)
const isResults = (call: MockCall, q: string) => call.path === "/search" && paramsOf(call).q === q && paramsOf(call).limit === "12"

/** Holds every results request for these queries until the test answers it. */
function holdQueries(...queries: string[]) {
  const gates = new Map<string, (reply: MockReply) => void>()
  const { calls, fetchMock } = installFetchMock((call) => {
    const q = paramsOf(call).q
    if (call.path === "/search" && paramsOf(call).limit === "12" && queries.includes(q)) {
      return new Promise<MockReply>((resolve) => gates.set(q, resolve))
    }
    return fakeBackend()(call)
  })
  const release = async (q: string, reply: MockReply) => {
    await act(async () => {
      gates.get(q)!(reply)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return { calls, fetchMock, gates, release }
}

function commit(query: string) {
  const input = screen.getByRole("combobox")
  fireEvent.change(input, { target: { value: query } })
  fireEvent.submit(input.closest("form") as HTMLFormElement)
}

/** The results container while the page is refreshing (`aria-busy="true"`); null otherwise. */
const busyGrid = () => document.querySelector<HTMLElement>('[aria-busy="true"]')
const skeletons = () => document.querySelectorAll('[aria-hidden="true"].overflow-hidden')

describe("SearchPage keeps its results while a new query loads", () => {
  it("shows the previous rows, dimmed and marked busy, with 'Updating results…' - not a skeleton - until the new answer arrives", async () => {
    const { calls, release } = holdQueries("glow")
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect(busyGrid()).toBeNull() // settled: nothing is marked busy

    commit("glow")
    await waitFor(() => expect(calls.some((c) => isResults(c, "glow"))).toBe(true))

    expect(screen.getByText("Sunrise Solar Solutions")).toBeInTheDocument() // the reader's place is kept
    expect(busyGrid()).not.toBeNull()
    expect(busyGrid()).toHaveTextContent("Sunrise Solar Solutions") // the busy container IS the one holding the kept rows
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Updating results…")).toBe(true)
    expect(skeletons()).toHaveLength(0)
    // The previous rows are not offered more: there is no Load more for a query that is no longer the current one.
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument()

    await release("glow", okPage([{ kind: "business", item: BUSINESSES[0] }], { total: 1, limit: 12, offset: 0 }))
    expect((await screen.findAllByText(BUSINESSES[0].name)).length).toBeGreaterThan(0)
    expect(screen.queryByText("Sunrise Solar Solutions")).not.toBeInTheDocument()
    await waitFor(() => expect(busyGrid()).toBeNull())
  })

  it("the very first load still shows a skeleton (there is nothing to keep)", async () => {
    holdQueries("solar")
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    await waitFor(() => expect(skeletons().length).toBeGreaterThan(0))
    expect(screen.queryByText("Sunrise Solar Solutions")).not.toBeInTheDocument()
  })

  it("an answer for an older query never replaces a newer one, even though the older rows are the ones on screen", async () => {
    const { calls, fetchMock, release } = holdQueries("glow", "bakers")
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()

    commit("glow")
    await waitFor(() => expect(calls.some((c) => isResults(c, "glow"))).toBe(true))
    commit("bakers")
    await waitFor(() => expect(calls.some((c) => isResults(c, "bakers"))).toBe(true))

    // The superseded request was aborted by the page...
    const glowIndex = calls.findIndex((c) => isResults(c, "glow"))
    expect((fetchMock.mock.calls[glowIndex][1] as RequestInit).signal?.aborted).toBe(true)

    // ...the newest answers first, then the old one limps in. The newest wins and stays.
    await release("bakers", okPage([{ kind: "business", item: { ...BUSINESSES[0], name: "Newest Result" } }], { total: 1, limit: 12, offset: 0 }))
    expect((await screen.findAllByText("Newest Result")).length).toBeGreaterThan(0)
    await release("glow", okPage([{ kind: "business", item: { ...BUSINESSES[0], name: "STALE RESULT" } }], { total: 1, limit: 12, offset: 0 }))
    for (let turn = 0; turn < 3; turn++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(screen.queryByText("STALE RESULT")).not.toBeInTheDocument()
    expect(screen.getAllByText("Newest Result").length).toBeGreaterThan(0)
  })

  it("a stale answer cannot stand in for the new one while the new one is still loading", async () => {
    const { calls, release } = holdQueries("glow", "bakers")
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    commit("glow")
    await waitFor(() => expect(calls.some((c) => isResults(c, "glow"))).toBe(true))
    commit("bakers")
    await waitFor(() => expect(calls.some((c) => isResults(c, "bakers"))).toBe(true))

    await release("glow", okPage([{ kind: "business", item: { ...BUSINESSES[0], name: "STALE RESULT" } }], { total: 1, limit: 12, offset: 0 }))
    expect(screen.queryByText("STALE RESULT")).not.toBeInTheDocument()
    expect(screen.getByText("Sunrise Solar Solutions")).toBeInTheDocument() // still the kept rows
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Updating results…")).toBe(true) // and still updating
  })

  it("a failed refresh shows the failure - never the old rows as if they were the answer", async () => {
    const { calls, release } = holdQueries("glow")
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    commit("glow")
    await waitFor(() => expect(calls.some((c) => isResults(c, "glow"))).toBe(true))

    await release("glow", fail(500, "internal_error"))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Search unavailable")).toBeInTheDocument()
    expect(screen.queryByText("Sunrise Solar Solutions")).not.toBeInTheDocument()
  })

  it("an empty answer is shown as the empty state for the NEW query, not kept from the old one", async () => {
    const { calls, release } = holdQueries("zzzznothing")
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    commit("zzzznothing")
    await waitFor(() => expect(calls.some((c) => isResults(c, "zzzznothing"))).toBe(true))
    await release("zzzznothing", okPage([], { total: 0, limit: 12, offset: 0 }))
    expect(await screen.findByText("No results for “zzzznothing”")).toBeInTheDocument()
    expect(screen.queryByText("Sunrise Solar Solutions")).not.toBeInTheDocument()
  })
})
