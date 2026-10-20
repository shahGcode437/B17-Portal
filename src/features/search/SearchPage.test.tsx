import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SearchPage } from "@/features/search/SearchPage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { fail, installFetchMock, okPage, type MockCall, type MockReply } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { BUSINESSES } from "@/test/fixtures/apiFixtures"
import { renderPage } from "@/test/renderPage"

beforeEach(() => {
  resetCategoryCache()
  installFetchMock(fakeBackend())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const paramsOf = (call: MockCall) => Object.fromEntries(new URL(call.url, "http://x").searchParams)
// The page's own results requests (page size 12); the filter bar's option lookups use a bigger page.
const searchCalls = (calls: MockCall[]) => calls.filter((c) => c.path === "/search" && paramsOf(c).limit === "12")

function resultCount(): HTMLElement {
  const found = screen.getAllByRole("status").find((el) => /^(Searching…|Search unavailable|\d+ results?)/.test(el.textContent ?? ""))
  if (!found) throw new Error("result count status not found")
  return found
}

describe("SearchPage (real data)", () => {
  it("runs the URL's query against /search and shows the server's results and true total", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect(resultCount()).toHaveTextContent("1 result for “solar”")
    const first = searchCalls(calls)[0]
    expect(paramsOf(first)).toMatchObject({ q: "solar", limit: "12", offset: "0" })
    expect(paramsOf(first)).not.toHaveProperty("type")
  })

  it("shows a loading state before the first answer", async () => {
    installFetchMock((call) => (call.path === "/search" ? (new Promise(() => {}) as never) : fakeBackend()(call)))
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByText("Searching…")).toBeInTheDocument()
  })

  it("sends type and filters from the URL as the API's own parameters", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, {
      url: "/search?type=business&vertical=food&foodCategory=bakeries&service=delivery&area=B-17",
      path: "/search",
      user: null,
    })
    expect(await screen.findByText("Capital Bakers")).toBeInTheDocument()
    expect(paramsOf(searchCalls(calls)[0])).toMatchObject({
      type: "business",
      vertical: "food",
      foodCategory: "bakeries",
      service: "delivery",
      area: "B-17",
    })
    // Chips use the category's real name from the server, not the slug.
    expect(await screen.findByText("Food category: Bakeries")).toBeInTheDocument()
  })

  it("drops an unknown vertical or service from the URL instead of sending it", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, { url: "/search?type=business&vertical=mystery&service=teleport", path: "/search", user: null })
    await screen.findByText(/results?/)
    const params = paramsOf(searchCalls(calls)[0])
    expect(params).not.toHaveProperty("vertical")
    expect(params).not.toHaveProperty("service")
  })

  it("debounces typing into the URL (one replace, one request for the committed text)", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, { url: "/search", path: "/search", user: null })
    await screen.findByText(/results?/)
    const before = searchCalls(calls).length
    // Keystrokes arrive back to back (synchronously, so a slow machine cannot space them past the debounce).
    const input = screen.getByRole("combobox")
    for (const value of ["g", "gl", "glo", "glow"]) fireEvent.change(input, { target: { value } })
    // Synchronise on the observable outcomes, not on elapsed time: the committed URL, then the request for it.
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/search?q=glow"))
    await waitFor(() => expect(searchCalls(calls).some((c) => paramsOf(c).q === "glow")).toBe(true))
    expect((await screen.findAllByText("Glow Salon")).length).toBeGreaterThan(0)
    // Four keystrokes produced exactly ONE request after the baseline: the debounce collapsed them.
    const sent = searchCalls(calls).slice(before).map((c) => paramsOf(c).q)
    expect(sent).toEqual(["glow"])
  })

  it("Load more fetches the next server page and appends it; the total stays the server's", async () => {
    const total = 30
    const make = (offset: number, limit: number): MockReply =>
      okPage(
        Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
          kind: "business",
          item: { ...BUSINESSES[1], id: `00000000-0000-4000-8000-0000000009${String(offset + i).padStart(2, "0")}`, name: `Shop ${offset + i}` },
        })),
        { total, limit, offset }
      )
    const { calls } = installFetchMock((call) => {
      if (call.path !== "/search") return fakeBackend()(call)
      const q = new URL(call.url, "http://x").searchParams
      return make(Number(q.get("offset")), Number(q.get("limit")))
    })
    const user = userEvent.setup()
    renderPage(<SearchPage />, { url: "/search?type=business", path: "/search", user: null })
    expect(await screen.findByText("Shop 0")).toBeInTheDocument()
    expect(resultCount()).toHaveTextContent("30 results")
    expect(screen.queryByText("Shop 12")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Load More" }))
    expect(await screen.findByText("Shop 12")).toBeInTheDocument()
    expect(screen.getByText("Shop 0")).toBeInTheDocument()
    expect(searchCalls(calls).map((c) => paramsOf(c).offset)).toEqual(["0", "12"])
    await user.click(screen.getByRole("button", { name: "Load More" }))
    expect(await screen.findByText("Shop 29")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument()
  })

  it("an empty result is a calm empty state with a way out - not an error", async () => {
    renderPage(<SearchPage />, { url: "/search?q=zzzznothing", path: "/search", user: null })
    expect(await screen.findByText("No results for “zzzznothing”")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(resultCount()).toHaveTextContent("0 results")
  })

  it("a server failure is an error with Try again, never an empty list, and it recovers", async () => {
    let healthy = false
    installFetchMock((call) => (call.path === "/search" && !healthy ? fail(500, "internal_error") : fakeBackend()(call)))
    const user = userEvent.setup()
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Search unavailable")).toBeInTheDocument()
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument()
    healthy = true
    await user.click(screen.getByRole("button", { name: /try again|retry/i }))
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("a network failure is reported as a failure too", async () => {
    installFetchMock((call) => (call.path === "/search" ? "network-error" : fakeBackend()(call)))
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Sunrise Solar Solutions")).not.toBeInTheDocument()
  })

  it("never shows a stale answer: a slow response to the old query cannot replace the new one", async () => {
    let releaseOld: (reply: MockReply) => void = () => undefined
    const old = new Promise<MockReply>((resolve) => {
      releaseOld = resolve
    })
    const { calls, fetchMock } = installFetchMock((call) => {
      if (call.path === "/search" && new URL(call.url, "http://x").searchParams.get("q") === "solar") return old
      return fakeBackend()(call)
    })
    const isResultsCall = (c: MockCall, q: string) => c.path === "/search" && paramsOf(c).q === q && paramsOf(c).limit === "12"
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    // Wait until the OLD request is genuinely in flight (a signal, not elapsed time).
    await waitFor(() => expect(calls.some((c) => isResultsCall(c, "solar"))).toBe(true))
    // Commit a newer query. Both events are synchronous: no per-keystroke timing, no debounce to race.
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "glow" } })
    fireEvent.submit(input.closest("form") as HTMLFormElement)
    await waitFor(() => expect(calls.some((c) => isResultsCall(c, "glow"))).toBe(true))
    expect((await screen.findAllByText("Glow Salon")).length).toBeGreaterThan(0)

    // The superseded request was ABORTED by the page (asserted directly on its AbortSignal)...
    const oldIndex = calls.findIndex((c) => isResultsCall(c, "solar"))
    expect((fetchMock.mock.calls[oldIndex][1] as RequestInit).signal?.aborted).toBe(true)
    // ...and even when its answer arrives late, it cannot replace the newer result.
    releaseOld(okPage([{ kind: "provider", item: { ...BUSINESSES[0], name: "STALE RESULT" } }], { total: 1, limit: 12, offset: 0 }))
    for (let turn = 0; turn < 5; turn++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(screen.queryByText("STALE RESULT")).not.toBeInTheDocument()
    expect(screen.queryAllByText("Glow Salon").length).toBeGreaterThan(0)
  })

  it("removing a filter chip updates the URL and the request", async () => {
    const user = userEvent.setup()
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, { url: "/search?type=business&vertical=food", path: "/search", user: null })
    await screen.findByText("Capital Bakers")
    await user.click(screen.getByRole("button", { name: /Remove Food & Dining filter/ }))
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/search?type=business"))
    await waitFor(() => expect(paramsOf(searchCalls(calls).at(-1)!)).not.toHaveProperty("vertical"))
  })

  it("builds no filter options from a page of results: only the 12-hit results request is ever sent to /search", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, { url: "/search?type=tutor", path: "/search", user: null })
    await screen.findByText("Sara M.")
    expect(screen.queryByRole("combobox", { name: "Area" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Grade" })).not.toBeInTheDocument()
    const sizes = calls.filter((c) => c.path === "/search").map((c) => paramsOf(c).limit)
    expect(new Set(sizes)).toEqual(new Set(["12"]))
  })

  it("never calls a private or admin endpoint", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<SearchPage />, { url: "/search?q=solar", path: "/search", user: null })
    await screen.findByText("Sunrise Solar Solutions")
    expect(calls.every((c) => ["/search", "/search/suggestions", "/categories"].includes(c.path))).toBe(true)
  })

  it("shows suggestions for text of two or more characters", async () => {
    const user = userEvent.setup()
    renderPage(<SearchPage />, { url: "/search", path: "/search", user: null })
    await screen.findByText(/results?/)
    await user.click(screen.getByRole("combobox"))
    await user.paste("sol")
    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).getByText("Sunrise Solar Solutions")).toBeInTheDocument()
  })
})
