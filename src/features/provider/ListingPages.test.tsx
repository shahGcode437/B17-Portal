import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ListingFormPage } from "@/features/provider/ListingFormPage"
import { EditListingPage } from "@/features/provider/EditListingPage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { fail, installFetchMock, meBody, type MockCall, type MockReply } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS, OWNER_LISTINGS } from "@/test/fixtures/apiFixtures"
import { testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * The create and edit pages end to end against the fake backend (merged into main from the parallel S4 worktree, in
 * main's wording): what the submit button says, that the area is B-17 whatever the old data held, that an invalid
 * value is stopped ON THE PAGE in plain words before anything is sent, and that a server refusal is explained in plain
 * words (never pydantic's) next to the form.
 */
const NBSP = " "

beforeEach(() => {
  resetCategoryCache()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const fill = async (user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) => {
  await user.click(field)
  await user.paste(text)
}

/** The fake backend (signed in as a professional), with the listing writes handed to `onWrite` (a reply, or undefined to fall through). */
function backend(onWrite: (call: MockCall) => MockReply | undefined) {
  const base = fakeBackend({ me: meBody({ roles: ["professional"] }) })
  return installFetchMock((call) => onWrite(call) ?? base(call))
}
const created = (data: unknown): MockReply => ({ status: 201, body: { data } })
const isCreate = (call: MockCall) => call.method === "POST" && call.path === "/listings"

const createPage = () => renderPage(<ListingFormPage />, { url: "/provider/listings/new", user: testUser() })
const editPage = (id: string) => renderPage(<EditListingPage />, { url: `/provider/listings/${id}/edit`, path: "/provider/listings/:id/edit", user: testUser() })

async function fillProvider(user: ReturnType<typeof userEvent.setup>, tags = "solar, panels") {
  await user.click(screen.getByRole("button", { name: /Service \/ Professional/ }))
  await fill(user, screen.getByLabelText("Name"), "Sunrise Solar Co")
  await user.selectOptions(await screen.findByRole("combobox", { name: "Service Category" }), "solar")
  await fill(user, screen.getByLabelText("Description"), "Rooftop solar panels and net metering for homes.")
  await fill(user, screen.getByLabelText(/Services offered/), tags)
}

describe("create a listing", () => {
  it("submits for review: the button says so, the area is B-17, tags are the cleaned list, no picture key is sent", async () => {
    const { calls } = backend((call) => (isCreate(call) ? created(OWNER_LISTINGS[1]) : undefined))
    const user = userEvent.setup()
    const { show } = createPage()
    await fillProvider(user, "Solar, panels, SOLAR")
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveValue("B-17")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    await waitFor(() => expect(calls.some(isCreate)).toBe(true))
    const post = calls.find(isCreate)!
    expect(post.body).toMatchObject({ kind: "provider", name: "Sunrise Solar Co", category: "solar", area: "B-17", tags: ["solar", "panels"], location: { visibility: "area_only" } })
    expect(post.body).not.toHaveProperty("image")
    await waitFor(() => expect(show).toHaveBeenCalledWith("Listing submitted for review"))
    expect(screen.getByTestId("location")).toHaveTextContent("/provider/listings")
  })

  it("stops a 21st tag on the page, in plain words, and sends nothing", async () => {
    const { calls } = backend(() => undefined)
    const user = userEvent.setup()
    createPage()
    await fillProvider(user, Array.from({ length: 21 }, (_, i) => `t${i}`).join(", "))
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect((await screen.findAllByText("You can add up to 20 tags. Remove 1 to continue.")).length).toBeGreaterThan(0)
    expect(calls.some(isCreate)).toBe(false)
  })

  it("stops a hidden character (a pasted non-breaking space) in the name, in plain words, and sends nothing", async () => {
    const { calls } = backend(() => undefined)
    const user = userEvent.setup()
    createPage()
    await user.click(screen.getByRole("button", { name: /Service \/ Professional/ }))
    await fill(user, screen.getByLabelText("Name"), `Sunrise${NBSP}Solar Co`)
    await user.selectOptions(await screen.findByRole("combobox", { name: "Service Category" }), "solar")
    await fill(user, screen.getByLabelText("Description"), "Rooftop solar panels and net metering for homes.")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText(/Please use plain text only/)).toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true")
    expect(calls.some(isCreate)).toBe(false)
  })

  it("stops an address with a line break (the API's address is one line) before anything is sent", async () => {
    const { calls } = backend(() => undefined)
    const user = userEvent.setup()
    createPage()
    await fillProvider(user)
    await user.selectOptions(screen.getByLabelText("Visibility"), "exact")
    await fill(user, screen.getByLabelText("Street address"), "Shop 4\nMain Market")
    expect(await screen.findByText(/keep the address on one line/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(calls.some(isCreate)).toBe(false)
  })

  it("explains a server refusal in plain words next to the form - not pydantic's text", async () => {
    backend((call) =>
      isCreate(call) ? fail(422, "validation_error", [{ field: "tags", code: "too_long", message: "List should have at most 20 items after validation, not 21" }]) : undefined
    )
    const user = userEvent.setup()
    createPage()
    await fillProvider(user)
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    const banner = await screen.findByText(/Please check the form/)
    expect(banner).toHaveTextContent("You can add up to 20 tags.")
    expect(document.body.textContent).not.toMatch(/List should have/)
    expect(banner).toHaveAttribute("role", "alert")
  })

  it("explains the Free plan limit and keeps what was typed", async () => {
    backend((call) => (isCreate(call) ? fail(403, "plan_limit_reached") : undefined))
    const user = userEvent.setup()
    createPage()
    await fillProvider(user)
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText(/Your plan's listing limit is reached/)).toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toHaveValue("Sunrise Solar Co")
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeEnabled()
  })

  it("a tutor's grade is checked on the page (1-60 characters of plain text)", async () => {
    const { calls } = backend(() => undefined)
    const user = userEvent.setup()
    createPage()
    await user.click(screen.getByRole("button", { name: /^Tutor/ }))
    await fill(user, screen.getByLabelText("Name"), "Hina Tutor")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Subject" }), "physics")
    await fill(user, screen.getByLabelText("Description"), "Physics for O-Level students, small groups.")
    await fill(user, screen.getByLabelText("Grade / level you teach"), "g".repeat(61))
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText("Please keep the grade under 60 characters.")).toBeInTheDocument()
    expect(screen.getByLabelText("Grade / level you teach")).toHaveAttribute("aria-invalid", "true")
    expect(calls.some(isCreate)).toBe(false)
  })
})

describe("edit a listing", () => {
  it("an approved listing is saved, and the page says editing it can send it back for review", async () => {
    backend(() => undefined)
    editPage(IDS.ownerApproved)
    expect(await screen.findByRole("button", { name: "Save Changes" })).toBeInTheDocument()
    expect(screen.getByText(/This listing is live\. A change to its content sends it back to review/)).toBeInTheDocument()
  })

  it("a pending listing is saved and stays in the queue", async () => {
    backend(() => undefined)
    editPage(IDS.ownerPending)
    expect(await screen.findByRole("button", { name: "Save Changes" })).toBeInTheDocument()
    expect(screen.getByText(/waiting for review\. Saving changes keeps it in the queue/)).toBeInTheDocument()
  })

  it("an older area on file is shown as B-17 and saved as B-17, with the slug the form was given", async () => {
    const legacy = { ...OWNER_LISTINGS[1], area: "B-17, Block A" }
    const { calls } = backend((call) => {
      if (call.method === "GET" && call.path === `/users/me/listings/${IDS.ownerApproved}`) return { status: 200, body: { data: legacy } }
      if (call.method === "PATCH") return { status: 200, body: { data: { ...legacy, area: "B-17", status: "pending", revision: 4 } } }
      return undefined
    })
    const user = userEvent.setup()
    editPage(IDS.ownerApproved)
    await screen.findByRole("button", { name: "Save Changes" })
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveValue("B-17")
    await screen.findByRole("option", { name: "Plumbing" })
    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true))
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ revision: 3, area: "B-17", category: "plumbing" })
  })

  it("a tutor's grade is checked on the edit page too (it used to take any text)", async () => {
    // (the fixture has no description, which the form would ask for first)
    const tutor = { ...OWNER_LISTINGS[3], status: "pending", description: "English tutoring for middle school students, in small groups." }
    const { calls } = backend((call) => (call.method === "GET" && call.path === `/users/me/listings/${IDS.ownerArchived}` ? { status: 200, body: { data: tutor } } : undefined))
    const user = userEvent.setup()
    editPage(IDS.ownerArchived)
    const grade = await screen.findByLabelText("Grade / level you teach")
    await user.clear(grade)
    await screen.findByRole("option", { name: "English" })
    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    expect(await screen.findByText("Please enter the grade you teach.")).toBeInTheDocument()
    expect(calls.some((c) => c.method === "PATCH")).toBe(false)
  })
})
