import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RequestServiceDialog } from "@/features/services/RequestServiceDialog"
import { fail, installFetchMock, meBody, ok, type MockCall } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"
import type { Provider } from "@/types/provider"

/**
 * The Request Service dialog (S5A). B-13: it offers no contact-method choice that does nothing (WhatsApp / phone were
 * "hints" no one acted on), and still sends the one value the API needs. Gate order: an account that is known to be
 * unverified is told to verify BEFORE it fills the form in; a verified one never sees that.
 */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const PROVIDER: Provider = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "Imran Electrical Works",
  category: "electrical",
  categoryLabel: "Electrical",
  description: "Wiring, repairs and fittings across B-17.",
  area: "B-17",
  tags: ["wiring", "repairs"],
}

function open(user = testUser()) {
  const calls: MockCall[] = []
  const base = fakeBackend({
    me: meBody({ emailVerified: user.emailVerified }),
    overrides: {
      "POST /requests": (call) => {
        calls.push(call)
        return ok({ id: "00000000-0000-4000-8000-000000000999", status: "submitted" }, 201)
      },
    },
  })
  installFetchMock(base)
  const onOpenChange = vi.fn()
  const view = renderPage(
    <RequestServiceDialog provider={PROVIDER} requesterName="Rida Resident" open onOpenChange={onOpenChange} />,
    { url: "/services/providers/p", user }
  )
  return { calls, onOpenChange, ...view }
}

describe("B-13: no contact choice that does nothing", () => {
  it("offers no 'Preferred contact method', no WhatsApp and no phone option", async () => {
    open()
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByLabelText("Preferred contact method")).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("combobox", { name: /contact/i })).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/whatsapp \(if|phone \(if|hint to the provider/i)
    expect(within(dialog).queryByRole("option", { name: /whatsapp|phone/i })).not.toBeInTheDocument()
  })

  it("says honestly where the request goes, without promising a phone or WhatsApp route", async () => {
    open()
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(/follow its progress in My Requests/i)
    expect(dialog).toHaveTextContent(/does not pass on your phone or WhatsApp number/i)
  })

  it("still sends the in-app preference the API expects, and shows the success view", async () => {
    const user = userEvent.setup()
    const { calls } = open()
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("What do you need?"), "A tap is leaking in the kitchen sink.")
    await user.type(within(dialog).getByLabelText("Area / Location"), "B-17, Block C")
    const date = within(dialog).getByLabelText("Preferred Date") as HTMLInputElement
    const min = date.min
    await user.type(date, min)
    await user.click(within(dialog).getByRole("button", { name: "Submit Request" }))

    await waitFor(() => expect(calls).toHaveLength(1))
    const body = (typeof calls[0].body === "string" ? JSON.parse(calls[0].body) : calls[0].body) as Record<string, unknown>
    expect(body).toMatchObject({ providerListingId: PROVIDER.id, preferredContactChannel: "in_app" })
    expect(await screen.findByText("Request sent")).toBeInTheDocument()
  })
})

describe("gate order: an unverified account is told to verify first", () => {
  it("shows 'Verify your email first' and no form for an unverified account", async () => {
    open(testUser({ emailVerified: false, email: "new@example.org" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Verify your email first" })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/required before you can send a service request to Imran Electrical Works/i)
    expect(within(dialog).queryByRole("button", { name: "Submit Request" })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText("What do you need?")).not.toBeInTheDocument()
    // The notice (with the resend button) is right there, so the person can act without leaving.
    expect(within(dialog).getByRole("button", { name: "Resend verification email" })).toBeInTheDocument()
  })

  it("a verified account gets the form and never sees the verification step", async () => {
    open(testUser({ emailVerified: true }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Submit Request" })).toBeInTheDocument()
    expect(within(dialog).queryByText("Verify your email first")).not.toBeInTheDocument()
  })

  it("production wording never claims an e-mail was sent (and shows no development text)", async () => {
    vi.stubEnv("DEV", false)
    open(testUser({ emailVerified: false, email: "new@example.org" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("new@example.org is not verified yet.")
    expect(dialog).not.toHaveTextContent(/we sent|on its way|inbox|dev_verify|in development/i)
  })

  it('"Not now" closes the verification step', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = open(testUser({ emailVerified: false }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Not now" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe("a refused request still reads as one clean sentence", () => {
  it("an unmapped validation code shows the generic line, never the server's text", async () => {
    const user = userEvent.setup()
    installFetchMock(
      fakeBackend({
        me: meBody(),
        overrides: {
          "POST /requests": fail(422, "validation_error", [{ field: "x", code: "brand_new_rule", message: "String should have at least 2 characters" }]),
        },
      })
    )
    renderPage(<RequestServiceDialog provider={PROVIDER} requesterName="Rida Resident" open onOpenChange={vi.fn()} />, {
      url: "/services/providers/p",
      user: testUser(),
    })
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("What do you need?"), "A tap is leaking in the kitchen sink.")
    await user.type(within(dialog).getByLabelText("Area / Location"), "B-17, Block C")
    const date = within(dialog).getByLabelText("Preferred Date") as HTMLInputElement
    await user.type(date, date.min)
    await user.click(within(dialog).getByRole("button", { name: "Submit Request" }))

    const alert = await within(dialog).findByRole("alert")
    expect(alert).toHaveTextContent("Some details need a change. Check them and try again.")
    expect(dialog).not.toHaveTextContent(/String should have/)
  })
})
