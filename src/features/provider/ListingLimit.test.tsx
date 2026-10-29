import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProfessionalListingsPage } from "@/features/provider/ProfessionalListingsPage"
import { ListingFormPage } from "@/features/provider/ListingFormPage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { fail, installFetchMock, meBody, okPage, type MockCall, type MockReply } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { OWNER_LISTINGS } from "@/test/fixtures/apiFixtures"
import { testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * Phase 12S Step A: a Free owner at the active-listing limit is told so BEFORE they fill in a form, with no upgrade
 * action (there is no billing). The count is the browser's best knowledge: it only warns, the server still decides
 * (`plan_limit_reached`), and a count that is missing or stale removes nothing.
 */
const FREE = () => testUser({ professional: { planCode: "free" } })
const PREMIUM = () => testUser({ professional: { planCode: "premium" } })

/** `GET /users/me/listings` with these per-status counts (the rows are the standard fixtures; the counts are what the quota reads). */
const ownerListings = (counts: { pending: number; approved: number; rejected: number; archived: number }): MockReply =>
  okPage(OWNER_LISTINGS, { counts })
const FULL = ownerListings({ pending: 2, approved: 1, rejected: 1, archived: 1 }) // 3 active
const ROOM = ownerListings({ pending: 1, approved: 1, rejected: 1, archived: 1 }) // 2 active

function backend(owner: MockReply, onWrite?: (call: MockCall) => MockReply | undefined) {
  const base = fakeBackend({ me: meBody({ roles: ["professional"] }), overrides: { "/users/me/listings": owner } })
  return installFetchMock((call) => onWrite?.(call) ?? base(call))
}
const isCreate = (call: MockCall) => call.method === "POST" && call.path === "/listings"

beforeEach(() => resetCategoryCache())
afterEach(() => vi.unstubAllGlobals())

const dashboard = (user = FREE()) => renderPage(<ProfessionalListingsPage />, { url: "/provider/listings", user })
const createPage = (user = FREE()) => renderPage(<ListingFormPage />, { url: "/provider/listings/new", user })

describe("the owner dashboard at the limit", () => {
  it("a Free owner with 3 of 3 active listings is told so next to 'New listing', and nothing offers an upgrade", async () => {
    backend(FULL)
    dashboard()
    expect(await screen.findByRole("heading", { name: "Active listing limit reached" })).toBeInTheDocument()
    const region = screen.getByText(/You have 3 of 3 active listings/).closest("[role=status]") as HTMLElement
    expect(region).toHaveTextContent("Archive an active listing before creating another.")
    // What counts is explained once, in the usage card under the notice (not repeated inside it).
    expect(region).not.toHaveTextContent("rejected and archived ones don't")
    expect(screen.getByText("3 of 3 active listings used")).toBeInTheDocument()
    expect(screen.getByText(/Only pending and approved listings count/)).toBeInTheDocument()

    // The primary action is still a working link (the count can be stale; the server decides) and it points at the notice.
    const create = screen.getByRole("link", { name: "New listing" })
    expect(create).toHaveAttribute("href", "/provider/listings/new")
    expect(create).toHaveAttribute("aria-describedby", region.id)

    // No upgrade or purchase action anywhere, and the notice does not mention Premium at all.
    expect(screen.queryByRole("link", { name: /upgrade|premium|subscribe|buy/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /upgrade|premium|subscribe|buy/i })).not.toBeInTheDocument()
    expect(region.textContent).not.toMatch(/upgrade|premium/i)
  })

  it("the way to manage the listings is on the page: the active rows offer Archive", async () => {
    backend(FULL)
    dashboard()
    await screen.findByRole("heading", { name: "Active listing limit reached" })
    expect(await screen.findByText("Pending Stationers")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Archive" }).length).toBeGreaterThan(0)
  })

  it("with room left (2 of 3) there is no warning, and 'New listing' is not described by one", async () => {
    backend(ROOM)
    dashboard()
    expect(await screen.findByText("2 of 3 active listings used")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Active listing limit reached" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New listing" })).not.toHaveAttribute("aria-describedby")
  })

  it("a Premium owner has no limit: no warning and no usage bar", async () => {
    backend(ownerListings({ pending: 20, approved: 20, rejected: 0, archived: 0 }))
    dashboard(PREMIUM())
    await screen.findByText("Pending Stationers")
    expect(screen.queryByRole("heading", { name: "Active listing limit reached" })).not.toBeInTheDocument()
    expect(screen.queryByText(/active listings used/)).not.toBeInTheDocument()
  })

  it("when the listings cannot be read the page shows the error and claims no limit", async () => {
    backend(fail(500, "internal_error"))
    dashboard()
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Active listing limit reached" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New listing" })).not.toHaveAttribute("aria-describedby")
  })
})

describe("creating a listing at the limit", () => {
  it("warns on the first screen - before a kind is chosen or a field is touched - and links to the listings", async () => {
    backend(FULL)
    createPage()
    expect(await screen.findByRole("heading", { name: "Active listing limit reached" })).toBeInTheDocument()
    const region = screen.getByText(/You have 3 of 3 active listings/).closest("[role=status]") as HTMLElement
    expect(region).toHaveTextContent("Archive an active listing before creating another.")
    expect(region).toHaveTextContent("rejected and archived ones don't") // there is no usage card here, so the notice says what counts
    expect(within(region).getByRole("link", { name: "Manage my listings" })).toHaveAttribute("href", "/provider/listings")
    // The kind choices are still there (the warning blocks nothing).
    expect(screen.getByRole("button", { name: /Service \/ Professional/ })).toBeEnabled()
    expect(region.textContent).not.toMatch(/upgrade|premium/i)
    expect(screen.queryByRole("link", { name: /upgrade|premium/i })).not.toBeInTheDocument()
  })

  it("keeps warning on the form step, and the server stays the authority: submitting anyway is refused in plain words and nothing typed is lost", async () => {
    const { calls } = backend(FULL, (call) => (isCreate(call) ? fail(403, "plan_limit_reached") : undefined))
    const user = userEvent.setup()
    createPage()
    await screen.findByRole("heading", { name: "Active listing limit reached" })
    await user.click(screen.getByRole("button", { name: /Service \/ Professional/ }))
    expect(screen.getByRole("heading", { name: "Active listing limit reached" })).toBeInTheDocument()

    await user.click(screen.getByLabelText("Name"))
    await user.paste("Sunrise Solar Co")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Service Category" }), "solar")
    await user.click(screen.getByLabelText("Description"))
    await user.paste("Rooftop solar panels and net metering for homes.")
    await user.click(screen.getByLabelText(/Services offered/))
    await user.paste("solar, panels")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    // The request WAS sent (the form was not blocked) and the server's refusal is what the person reads.
    const alert = await screen.findByRole("alert")
    expect(calls.some(isCreate)).toBe(true)
    expect(alert).toHaveTextContent("Active listing limit reached")
    expect(alert).toHaveTextContent("You've reached the active listing limit for your current plan. Archive an active listing before creating another.")
    expect(alert.textContent).not.toMatch(/upgrade|premium|plan_limit_reached|server text/i)
    expect(screen.getByLabelText("Name")).toHaveValue("Sunrise Solar Co")
  })

  it("with room left there is no warning", async () => {
    backend(ROOM)
    createPage()
    await screen.findByRole("heading", { name: "List Your Business / Service / Property" })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(screen.queryByRole("heading", { name: "Active listing limit reached" })).not.toBeInTheDocument()
  })

  it("a Premium owner is never warned", async () => {
    backend(ownerListings({ pending: 20, approved: 20, rejected: 0, archived: 0 }))
    createPage(PREMIUM())
    await screen.findByRole("heading", { name: "List Your Business / Service / Property" })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(screen.queryByRole("heading", { name: "Active listing limit reached" })).not.toBeInTheDocument()
  })

  it("missing counts (the read failed) show no warning and do not stop a submit; a refusal is still explained", async () => {
    const { calls } = backend(fail(500, "internal_error"), (call) => (isCreate(call) ? fail(403, "plan_limit_reached") : undefined))
    const user = userEvent.setup()
    createPage()
    await screen.findByRole("heading", { name: "List Your Business / Service / Property" })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(screen.queryByRole("heading", { name: "Active listing limit reached" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Service \/ Professional/ }))
    await user.click(screen.getByLabelText("Name"))
    await user.paste("Sunrise Solar Co")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Service Category" }), "solar")
    await user.click(screen.getByLabelText("Description"))
    await user.paste("Rooftop solar panels and net metering for homes.")
    await user.click(screen.getByLabelText(/Services offered/))
    await user.paste("solar, panels")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText(/Archive an active listing before creating another/)).toBeInTheDocument()
    expect(calls.some(isCreate)).toBe(true)
  })

  it("stale counts (they say there is room) do not hide the server's refusal either", async () => {
    backend(ROOM, (call) => (isCreate(call) ? fail(403, "plan_limit_reached") : undefined))
    const user = userEvent.setup()
    createPage()
    await user.click(await screen.findByRole("button", { name: /Service \/ Professional/ }))
    await user.click(screen.getByLabelText("Name"))
    await user.paste("Sunrise Solar Co")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Service Category" }), "solar")
    await user.click(screen.getByLabelText("Description"))
    await user.paste("Rooftop solar panels and net metering for homes.")
    await user.click(screen.getByLabelText(/Services offered/))
    await user.paste("solar, panels")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Active listing limit reached")
  })
})
