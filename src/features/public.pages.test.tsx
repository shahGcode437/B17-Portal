import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewsListPage } from "@/features/news/NewsListPage"
import { NewsArticlePage } from "@/features/news/NewsArticlePage"
import { DirectoryPage } from "@/features/directory/DirectoryPage"
import { FoodPage } from "@/features/food/FoodPage"
import { EducationPage } from "@/features/education/EducationPage"
import { PropertyPage } from "@/features/property/PropertyPage"
import { ServicesPage } from "@/features/services/ServicesPage"
import { HomePage } from "@/features/home/HomePage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { fail, installFetchMock, type MockCall } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS } from "@/test/fixtures/apiFixtures"
import { renderPage } from "@/test/renderPage"

let calls: MockCall[]
beforeEach(() => {
  resetCategoryCache()
  ;({ calls } = installFetchMock(fakeBackend()))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const failing = (path: string, reply: ReturnType<typeof fail> | "network-error") =>
  installFetchMock(fakeBackend({ overrides: { [path]: reply } }))

describe("News", () => {
  it("lists published items newest first, from GET /news", async () => {
    renderPage(<NewsListPage />, { url: "/news", path: "/news", user: null })
    expect(await screen.findByText("Water Supply Schedule Update for Block D")).toBeInTheDocument()
    const newer = screen.getByText("Water Supply Schedule Update for Block D")
    const older = screen.getByText("B-17 Community Park Cleanup Drive This Weekend")
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(calls.find((c) => c.path === "/news")?.url).toContain("limit=12")
  })

  it("the kind filter is the server's parameter", async () => {
    const user = userEvent.setup()
    renderPage(<NewsListPage />, { url: "/news", path: "/news", user: null })
    await screen.findByText("Water Supply Schedule Update for Block D")
    await user.click(screen.getByRole("radio", { name: "Updates" }))
    await waitFor(() => expect(calls.some((c) => c.url.includes("kind=update"))).toBe(true))
    await waitFor(() => expect(screen.queryByText("B-17 Community Park Cleanup Drive This Weekend")).not.toBeInTheDocument())
  })

  it("an empty feed is an empty state; a failure is an error with retry", async () => {
    installFetchMock(fakeBackend({ overrides: { "/news": { status: 200, body: { data: [], meta: { total: 0, limit: 12, offset: 0 } } } } }))
    const { unmount } = renderPage(<NewsListPage />, { url: "/news", path: "/news", user: null })
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument()
    unmount()
    failing("/news", fail(500, "internal_error"))
    renderPage(<NewsListPage />, { url: "/news", path: "/news", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument()
  })

  it("an article reads GET /news/{id} and shows it", async () => {
    renderPage(<NewsArticlePage />, { url: `/news/${IDS.news}`, path: "/news/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "B-17 Community Park Cleanup Drive This Weekend" })).toBeInTheDocument()
    expect(screen.getByText(/join a local cleanup drive/)).toBeInTheDocument()
  })

  it("an unknown article is a not-found state (404), a failing server is an error", async () => {
    const { unmount } = renderPage(<NewsArticlePage />, { url: "/news/nope", path: "/news/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Content not found" })).toBeInTheDocument()
    unmount()
    failing(`/news/${IDS.news}`, fail(500, "internal_error"))
    renderPage(<NewsArticlePage />, { url: `/news/${IDS.news}`, path: "/news/:id", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Content not found")).not.toBeInTheDocument()
  })
})

describe("Landing pages read real data", () => {
  const hrefOf = async (name: string | RegExp) => (await screen.findByRole("link", { name })).getAttribute("href")

  it("Directory: server categories as links into Search (never an inactive one)", async () => {
    renderPage(<DirectoryPage />, { url: "/directory", path: "/directory", user: null })
    expect(await hrefOf(/Pharmacy/)).toBe("/search?type=business&vertical=general&category=pharmacy")
    expect(screen.getByRole("link", { name: /Hairdressing/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Food & Dining/ })).toHaveAttribute("href", "/food")
    expect(screen.queryByText("Retired Category")).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.includes("/categories?module=directory"))).toBe(true)
  })

  it("Food & Dining: Food businesses only, server Food categories", async () => {
    renderPage(<FoodPage />, { url: "/food", path: "/food", user: null })
    expect(await screen.findByText("Capital Bakers")).toBeInTheDocument()
    expect(screen.getByText("Mocha Corner Cafe")).toBeInTheDocument()
    expect(screen.queryByText("Glow Salon")).not.toBeInTheDocument()
    expect(await screen.findByText("Sweets / Desserts")).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes("vertical=food"))).toBe(true)
  })

  it("Education: server subjects as links into tutor Search", async () => {
    renderPage(<EducationPage />, { url: "/education", path: "/education", user: null })
    expect(await hrefOf(/Physics/)).toBe("/search?type=tutor&subject=physics")
    expect(screen.getByRole("link", { name: /Mathematics/ })).toBeInTheDocument()
  })

  it("Property: Sale / Rent and the server's property types", async () => {
    renderPage(<PropertyPage />, { url: "/property", path: "/property", user: null })
    expect(await screen.findByRole("link", { name: /House/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Flat/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Sale/ })).toHaveAttribute("href", "/search?type=property&listingType=sale")
  })

  it("Services: the server's service categories", async () => {
    renderPage(<ServicesPage />, { url: "/services", path: "/services", user: null })
    expect(await screen.findByRole("link", { name: /Construction/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Solar/ })).toBeInTheDocument()
  })

  it("a landing page whose categories fail shows an error with retry - never a hard-coded list", async () => {
    installFetchMock((call) => (call.path === "/categories" ? fail(500, "internal_error") : fakeBackend()(call)))
    renderPage(<DirectoryPage />, { url: "/directory", path: "/directory", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Pharmacy/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument()
  })

  it("a landing page with no categories shows its empty state, not an error", async () => {
    installFetchMock((call) => (call.path === "/categories" ? { status: 200, body: { data: [] } } : fakeBackend()(call)))
    renderPage(<EducationPage />, { url: "/education", path: "/education", user: null })
    expect(await screen.findByText("No subjects yet")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("Food with no businesses shows its empty state, not an error", async () => {
    installFetchMock((call) =>
      call.path === "/search" ? { status: 200, body: { data: [], meta: { total: 0, limit: 12, offset: 0 } } } : fakeBackend()(call)
    )
    renderPage(<FoodPage />, { url: "/food", path: "/food", user: null })
    expect(await screen.findByText("No food businesses yet")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("Home", () => {
  it("fills its previews from the API (featured providers, businesses, tutors, properties, news)", async () => {
    renderPage(<HomePage />, { url: "/", path: "/", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect(await screen.findByText("B-17 Community Park Cleanup Drive This Weekend")).toBeInTheDocument()
    expect(await screen.findByText("5 Marla House - B-17 Block C")).toBeInTheDocument()
  })

  it("one failing preview does not take the page down: it shows its own retryable error", async () => {
    installFetchMock((call) => (call.path === "/news" ? fail(500, "internal_error") : fakeBackend()(call)))
    renderPage(<HomePage />, { url: "/", path: "/", user: null })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0)
  })

  it("never asks for a private endpoint", async () => {
    renderPage(<HomePage />, { url: "/", path: "/", user: null })
    await screen.findByText("Sunrise Solar Solutions")
    expect(calls.every((c) => !c.path.startsWith("/admin") && !c.path.startsWith("/users") && c.path !== "/saved" && c.path !== "/requests")).toBe(true)
  })
})
