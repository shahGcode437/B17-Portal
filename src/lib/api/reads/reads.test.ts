import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchCategories } from "@/lib/api/reads/categories"
import { fetchSearch, fetchSuggestions } from "@/lib/api/reads/search"
import { fetchListing } from "@/lib/api/reads/listings"
import { fetchNews, fetchNewsList } from "@/lib/api/reads/news"
import { fetchSaved } from "@/lib/api/reads/saved"
import { fetchLeads, fetchMyRequests, fetchRequest } from "@/lib/api/reads/requests"
import { fetchOwnerListing, fetchOwnerListings } from "@/lib/api/reads/owner"
import { fetchAdminCategories, fetchAdminListing, fetchAdminQueue } from "@/lib/api/reads/admin"
import { parseCounts } from "@/lib/api/reads/counts"
import { queryString, segment } from "@/lib/api/query"
import { isApiError } from "@/lib/api/errors"
import { fail, installFetchMock, ok, okPage } from "@/test/apiMock"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("queryString / segment", () => {
  it("drops undefined, null and blank values and never emits `key=`", () => {
    expect(queryString({ a: undefined, b: null, c: "", d: "   ", e: "x" })).toBe("?e=x")
    expect(queryString({})).toBe("")
  })

  it("percent-encodes user text so it cannot break out of its parameter", () => {
    const built = queryString({ q: "a&b=c#d é", n: 2, flag: false })
    const parsed = new URLSearchParams(built.slice(1))
    expect(parsed.get("q")).toBe("a&b=c#d é")
    expect(parsed.get("n")).toBe("2")
    expect(parsed.get("flag")).toBe("false")
    expect(built).not.toContain("#")
    expect([...parsed.keys()].sort()).toEqual(["flag", "n", "q"])
  })

  it("encodes a path segment so an id cannot escape its route", () => {
    expect(segment("../admin/listings")).toBe("..%2Fadmin%2Flistings")
    expect(segment("a?b#c")).toBe("a%3Fb%23c")
  })
})

describe("public reads", () => {
  it("GET /categories?module= sends cookies and no body, with no CSRF header", async () => {
    const { calls } = installFetchMock(() => ok([]))
    await fetchCategories("food")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: "GET", path: "/categories", credentials: "include", body: undefined })
    expect(calls[0].url).toContain("/categories?module=food")
    expect(calls[0].headers.get("X-CSRF-Token")).toBeNull()
  })

  it("omits the module parameter when none is given", async () => {
    const { calls } = installFetchMock(() => ok([]))
    await fetchCategories()
    expect(calls[0].url.endsWith("/categories")).toBe(true)
  })

  it("GET /search sends exactly the filters given, encoded, with limit/offset", async () => {
    const { calls } = installFetchMock(() => okPage([], { total: 0, limit: 12, offset: 24 }))
    const page = await fetchSearch({ q: "solar & wind", type: "provider", area: "B-17", category: "solar", limit: 12, offset: 24 })
    const url = new URL(calls[0].url, "http://x")
    expect(url.pathname.endsWith("/search")).toBe(true)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "solar & wind",
      type: "provider",
      area: "B-17",
      category: "solar",
      limit: "12",
      offset: "24",
    })
    expect(page.meta).toEqual({ total: 0, limit: 12, offset: 24 })
  })

  it("returns the server's true total, not the page length", async () => {
    installFetchMock(() => okPage([{ a: 1 }, { a: 2 }], { total: 37, limit: 2, offset: 0 }))
    const page = await fetchSearch({ limit: 2 })
    expect(page.items).toHaveLength(2)
    expect(page.meta.total).toBe(37)
  })

  it("treats a list response without valid meta as a protocol failure (no faked totals)", async () => {
    installFetchMock(() => ({ status: 200, body: { data: [{ a: 1 }] } }))
    await expect(fetchSearch({})).rejects.toMatchObject({ code: "invalid_response" })
    installFetchMock(() => ({ status: 200, body: { data: [], meta: { total: "3", limit: 1, offset: 0 } } }))
    await expect(fetchNewsList()).rejects.toMatchObject({ code: "invalid_response" })
    installFetchMock(() => ({ status: 200, body: { data: { not: "a list" }, meta: { total: 0, limit: 1, offset: 0 } } }))
    await expect(fetchNewsList()).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("GET /search/suggestions", async () => {
    const { calls } = installFetchMock(() => ok([]))
    await fetchSuggestions({ q: "so", type: "business", limit: 8 })
    expect(new URL(calls[0].url, "http://x").searchParams.get("q")).toBe("so")
    expect(new URL(calls[0].url, "http://x").searchParams.get("limit")).toBe("8")
  })

  it("GET /listings/{id} and /news/{id} encode the id", async () => {
    const { calls } = installFetchMock(() => ok({}))
    await fetchListing("a/b")
    await fetchNews("x y")
    expect(calls[0].url).toContain("/listings/a%2Fb")
    expect(calls[1].url).toContain("/news/x%20y")
  })

  it("GET /news forwards the kind filter and paging", async () => {
    const { calls } = installFetchMock(() => okPage([]))
    await fetchNewsList({ kind: "update", limit: 5, offset: 10 })
    const params = new URL(calls[0].url, "http://x").searchParams
    expect(params.get("kind")).toBe("update")
    expect(params.get("limit")).toBe("5")
    expect(params.get("offset")).toBe("10")
  })
})

describe("private reads", () => {
  it("are authenticated calls: cookies included, no CSRF header on a GET", async () => {
    const { calls } = installFetchMock(() => okPage([], { counts: { pending: 1 } }))
    await fetchSaved()
    await fetchMyRequests({ status: "submitted" })
    await fetchLeads()
    await fetchOwnerListings({ status: "pending" })
    await fetchAdminQueue({ status: "pending", kind: "business" })
    expect(calls.map((c) => c.path)).toEqual(["/saved", "/requests", "/users/me/leads", "/users/me/listings", "/admin/listings"])
    for (const call of calls) {
      expect(call.method).toBe("GET")
      expect(call.credentials).toBe("include")
      expect(call.headers.get("X-CSRF-Token")).toBeNull()
    }
    expect(new URL(calls[4].url, "http://x").searchParams.get("kind")).toBe("business")
  })

  it("owner and admin lists expose the per-status counts of the WHOLE set", async () => {
    installFetchMock(() => okPage([], { total: 0, counts: { pending: 3, approved: 2, rejected: 1, archived: 0 } }))
    expect((await fetchOwnerListings()).counts).toEqual({ pending: 3, approved: 2, rejected: 1, archived: 0 })
    expect((await fetchAdminQueue()).counts).toEqual({ pending: 3, approved: 2, rejected: 1, archived: 0 })
  })

  it("parses counts defensively: a bad bucket is 0, never a guess", () => {
    expect(parseCounts({ pending: 2, approved: -1, rejected: "x", archived: Number.NaN })).toEqual({
      pending: 2,
      approved: 0,
      rejected: 0,
      archived: 0,
    })
    expect(parseCounts(undefined)).toEqual({ pending: 0, approved: 0, rejected: 0, archived: 0 })
    expect(parseCounts([])).toEqual({ pending: 0, approved: 0, rejected: 0, archived: 0 })
  })

  it("detail reads hit the owner, request and admin routes", async () => {
    const { calls } = installFetchMock(() => ok({}))
    await fetchOwnerListing("o1")
    await fetchRequest("r1")
    await fetchAdminListing("a1")
    await fetchAdminCategories("food")
    expect(calls.map((c) => c.path)).toEqual(["/users/me/listings/o1", "/requests/r1", "/admin/listings/a1", "/admin/categories"])
    expect(calls[3].url).toContain("module=food")
  })
})

describe("error normalization", () => {
  it("turns the backend envelope into a typed ApiError (status, code, request id)", async () => {
    installFetchMock(() => fail(404, "not_found"))
    const error = await fetchListing("x").catch((e: unknown) => e)
    expect(isApiError(error)).toBe(true)
    expect(error).toMatchObject({ status: 404, code: "not_found" })
  })

  it("normalises a network failure to status 0, without leaking the raw error", async () => {
    installFetchMock(() => "network-error")
    const error = await fetchSearch({}).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0 })
    expect(String((error as Error).message)).not.toMatch(/Failed to fetch/)
  })

  it("normalises 401 / 403 / 500 on private reads", async () => {
    for (const [status, code] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [500, "internal_error"],
    ] as const) {
      installFetchMock(() => fail(status, code))
      await expect(fetchAdminListing("x")).rejects.toMatchObject({ status, code })
    }
  })

  it("passes an AbortSignal through so a superseded request is cancelled", async () => {
    const controller = new AbortController()
    const { fetchMock } = installFetchMock(() => ok([]))
    await fetchCategories("food", controller.signal)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
