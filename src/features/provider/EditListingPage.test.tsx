import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditListingPage } from "@/features/provider/EditListingPage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { fail, installFetchMock, meBody, ok, type MockReply } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS, OWNER_LISTINGS } from "@/test/fixtures/apiFixtures"
import { testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * The edit page (Phase 12S, S4): the button and the toast say what the save DOES, the stored image is never
 * silently cleared, and the area is always the canonical locality. The PATCH answer is scripted here (the shared
 * fake backend is read-only), shaped like the real owner API.
 */
beforeEach(() => {
  resetCategoryCache()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

type Patch = Record<string, unknown>

/** A signed-in professional: the owner endpoints answer only for a session. */
const signedIn = () => fakeBackend({ me: meBody({ roles: ["professional"] }) })

function backend(answer: (patch: Patch) => MockReply, ownerRead?: (path: string) => MockReply | undefined) {
  const patches: Patch[] = []
  installFetchMock((call) => {
    if (call.method === "PATCH") {
      const patch = (typeof call.body === "string" ? JSON.parse(call.body) : call.body) as Patch
      patches.push(patch)
      return answer(patch)
    }
    return ownerRead?.(call.path) ?? signedIn()(call)
  })
  return patches
}

const owned = (id: string) => OWNER_LISTINGS.find((l) => l.id === id)!
const pendingAfterEdit = (id: string) => ok({ ...owned(id), status: "pending", revision: owned(id).revision + 1 })

function open(id: string) {
  return renderPage(<EditListingPage />, { url: `/provider/listings/${id}/edit`, path: "/provider/listings/:id/edit", user: testUser() })
}

async function changeDescription(user: ReturnType<typeof userEvent.setup>, text: string) {
  const description = await screen.findByLabelText("Description")
  await user.clear(description)
  await user.click(description)
  await user.paste(text)
}

describe("EditListingPage: the button and the message say what the save does", () => {
  it("an APPROVED listing: 'Save Changes', and the message says it went back to review", async () => {
    const user = userEvent.setup()
    const patches = backend(() => pendingAfterEdit(IDS.ownerApproved))
    const { show } = open(IDS.ownerApproved)
    expect(await screen.findByRole("button", { name: "Save Changes" })).toBeInTheDocument()
    expect(screen.getByText(/This listing is live/i)).toBeInTheDocument()
    await changeDescription(user, "Plumbing repairs and bathroom fittings across B-17, same-day call-outs.")
    await user.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() => expect(show).toHaveBeenCalledWith("Changes submitted for review"))
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ revision: 3, area: "B-17", category: "plumbing" })
    expect(screen.getByTestId("location")).toHaveTextContent("/provider/listings")
  })

  it("a REJECTED listing: 'Resubmit for Review', and the message says it was resubmitted", async () => {
    const user = userEvent.setup()
    backend(() => pendingAfterEdit(IDS.ownerRejected))
    const { show } = open(IDS.ownerRejected)
    expect(await screen.findByRole("button", { name: "Resubmit for Review" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument()
    await changeDescription(user, "A 10 marla residential plot in B-17 Block C with all utilities, available for sale.")
    await user.click(screen.getByRole("button", { name: "Resubmit for Review" }))
    await waitFor(() => expect(show).toHaveBeenCalledWith("Listing resubmitted for review"))
  })

  it("a PENDING listing: 'Save Changes', and the message is a plain 'Listing updated'", async () => {
    const user = userEvent.setup()
    backend(() => ok({ ...owned(IDS.ownerPending), revision: owned(IDS.ownerPending).revision + 1 }))
    const { show } = open(IDS.ownerPending)
    expect(await screen.findByRole("button", { name: "Save Changes" })).toBeInTheDocument()
    await changeDescription(user, "A stationery shop with books, copies and office supplies for B-17.")
    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(show).toHaveBeenCalledWith("Listing updated"))
  })

  it("no button on the page is ever called a preview", async () => {
    backend(() => pendingAfterEdit(IDS.ownerApproved))
    open(IDS.ownerApproved)
    await screen.findByRole("button", { name: "Save Changes" })
    for (const button of screen.getAllByRole("button")) expect(button).not.toHaveAccessibleName(/preview/i)
  })
})

describe("EditListingPage: what the PATCH carries", () => {
  it("keeps the stored image: it is sent back unchanged, never as null, unless the person removed it", async () => {
    const user = userEvent.setup()
    const withImage = { ...owned(IDS.ownerApproved), image: "https://cdn.example.com/plumbing.jpg" }
    const patches = backend(
      () => pendingAfterEdit(IDS.ownerApproved),
      (path) => (path === `/users/me/listings/${IDS.ownerApproved}` ? ok(withImage) : undefined)
    )
    open(IDS.ownerApproved)
    expect(await screen.findByAltText(/Current listing image/i)).toBeInTheDocument()
    await changeDescription(user, "Plumbing repairs and bathroom fittings across B-17, with a warranty.")
    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].image).toBe("https://cdn.example.com/plumbing.jpg")
  })

  it("Remove is the only thing that clears it (image: null), and the page says so first", async () => {
    const user = userEvent.setup()
    const withImage = { ...owned(IDS.ownerApproved), image: "https://cdn.example.com/plumbing.jpg" }
    const patches = backend(
      () => pendingAfterEdit(IDS.ownerApproved),
      (path) => (path === `/users/me/listings/${IDS.ownerApproved}` ? ok(withImage) : undefined)
    )
    open(IDS.ownerApproved)
    await screen.findByAltText(/Current listing image/i)
    await user.click(screen.getByRole("button", { name: /^Remove/ }))
    expect(screen.queryByAltText(/Current listing image/i)).not.toBeInTheDocument()
    expect(screen.getByText(/submitted without an image/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].image).toBeNull()
  })

  it("an invalid block stops the PATCH and is shown beside the field", async () => {
    const user = userEvent.setup()
    const patches = backend(() => pendingAfterEdit(IDS.ownerApproved))
    open(IDS.ownerApproved)
    const block = await screen.findByLabelText("Block (optional)")
    await user.clear(block)
    await user.click(block)
    await user.paste("C <b>")
    await changeDescription(user, "Plumbing repairs and bathroom fittings across B-17, with a warranty.")
    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/letters, numbers, spaces/i)
    expect(patches).toHaveLength(0)
  })
})

describe("EditListingPage: refusals are explained in plain words and nothing is claimed as saved", () => {
  it("no_changes on a rejected listing: a clear sentence, no success", async () => {
    const user = userEvent.setup()
    backend(() => fail(422, "validation_error", [{ field: "request", code: "no_changes" }]))
    const { show } = open(IDS.ownerRejected)
    await user.click(await screen.findByRole("button", { name: "Resubmit for Review" }))
    await waitFor(() => expect(show).toHaveBeenCalledWith("Please change at least one field before resubmitting.", { tone: "error" }))
    expect(show.mock.calls.map((call) => String(call[0])).join(" | ")).not.toMatch(/submitted|updated/i) // no false success
  })

  it("a stale revision (409) says the listing changed, and does not navigate away", async () => {
    const user = userEvent.setup()
    backend(() => fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision" }]))
    const { show } = open(IDS.ownerApproved)
    await changeDescription(user, "Plumbing repairs and bathroom fittings across B-17, with a warranty.")
    await user.click(await screen.findByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.stringContaining("has changed since you opened it"), { tone: "error" }))
    expect(screen.getByTestId("location")).toHaveTextContent("/edit")
  })

  it("an unknown_locality answer (a legacy area) is shown as words on the Area field, never as the raw code", async () => {
    const user = userEvent.setup()
    backend(() => fail(422, "validation_error", [{ field: "area", code: "unknown_locality", message: "raw backend text" }]))
    open(IDS.ownerApproved)
    await changeDescription(user, "Plumbing repairs and bathroom fittings across B-17, with a warranty.")
    await user.click(await screen.findByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(document.body.textContent).toMatch(/B-17/))
    expect(document.body.textContent).not.toMatch(/unknown_locality|raw backend text/)
  })
})

describe("EditListingPage: not found", () => {
  it("the API's own not_found is 'Listing not found' with a way back", async () => {
    installFetchMock((call) => (call.path.startsWith("/users/me/listings/") ? fail(404, "not_found") : signedIn()(call)))
    open("00000000-0000-4000-8000-0000000000ff")
    expect(await screen.findByRole("heading", { level: 1, name: "Listing not found" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back to My Listings" })).toBeInTheDocument()
  })

  it("a 404 from anywhere else is an unexpected answer with a retry, not 'Listing not found'", async () => {
    installFetchMock((call) => (call.path.startsWith("/users/me/listings/") ? { status: 404, body: "<html>nope</html>" } : signedIn()(call)))
    open(IDS.ownerApproved)
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Listing not found" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument()
  })
})
