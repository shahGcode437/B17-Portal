import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ListingForm } from "@/features/provider/ListingForm"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import { resetCategoryCache } from "@/hooks/useCategories"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import type { ListingFormValues, PropertyFormValues } from "@/features/provider/listingSchema"

/**
 * The listing CONTACT fields on the owner forms (Listing Contact v1).
 *
 * What is proven here: both fields exist on every owner form with clear labels and a Pakistan-format
 * example, the contact number is required and the WhatsApp number is not, what a person typed
 * survives a refused submit, an edit prefills what is saved, and the form hands the values on
 * unchanged for the adapters to send (the API does the normalising, so the form never rewrites what
 * someone typed under them).
 */

// The category choices are the SERVER's active categories (GET /categories?module=...).
beforeEach(() => {
  resetCategoryCache()
  installFetchMock(fakeBackend())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const fill = async (user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) => {
  await user.click(field)
  await user.paste(text)
}

/** A valid Business form apart from whatever the test is about. */
async function fillBusiness(user: ReturnType<typeof userEvent.setup>, contact = "03001234567", whatsapp?: string) {
  await fill(user, screen.getByLabelText("Business Name"), "Capital Stationers")
  await fill(user, screen.getByLabelText("Description"), "Books, copies and office supplies for B-17.")
  await user.selectOptions(await screen.findByRole("combobox", { name: "Category" }), "pharmacy")
  if (contact) await fill(user, screen.getByLabelText("Contact Number"), contact)
  if (whatsapp) await fill(user, screen.getByLabelText("WhatsApp Number (optional)"), whatsapp)
}

describe("ContactFields: the fields themselves", () => {
  it("asks for this listing number with a tel keypad and a Pakistan-format example", () => {
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)

    const contact = screen.getByLabelText("Contact Number")
    const whatsapp = screen.getByLabelText("WhatsApp Number (optional)")
    for (const field of [contact, whatsapp]) {
      expect(field).toHaveAttribute("type", "tel")
      expect(field).toHaveAttribute("inputMode", "tel")
      expect(field).toHaveAttribute("placeholder", "e.g. 03001234567")
      // The browser's saved personal number is exactly what this is not asking for.
      expect(field).toHaveAttribute("autoComplete", "off")
    }
    // It says whose number it wants, so nobody types their account number by habit, and clarifies detail visibility.
    expect(screen.getByText(/number for THIS listing, not your personal account/i)).toBeInTheDocument()
    expect(screen.getByText(/publicly visible on the detail page/i)).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp button is shown only when you add one/i)).toBeInTheDocument()
  })

  it("is on the Property form too, with the same labels", () => {
    render(<PropertyListingForm onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByLabelText("Contact Number")).toHaveAttribute("type", "tel")
    expect(screen.getByLabelText("WhatsApp Number (optional)")).toHaveAttribute("type", "tel")
  })
})

describe("ContactFields: validation before anything is sent", () => {
  it("will not submit without a contact number, and says so next to the field", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBusiness(user, "")

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    expect(await screen.findByText("Please enter a contact number.")).toBeInTheDocument()
    expect(screen.getByLabelText("Contact Number")).toHaveAttribute("aria-invalid", "true")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("explains an unreadable number in plain words, with an example, and sends nothing", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBusiness(user, "0300123")

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    expect(await screen.findByText(/Enter a valid phone number, for example 03001234567/)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("keeps what was typed when a submit is refused", async () => {
    const user = userEvent.setup()
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    await fillBusiness(user, "0300123", "0321 7654321")

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    expect(await screen.findByText(/Enter a valid phone number/)).toBeInTheDocument()
    expect(screen.getByLabelText("Contact Number")).toHaveValue("0300123")
    expect(screen.getByLabelText("WhatsApp Number (optional)")).toHaveValue("0321 7654321")
    expect(screen.getByLabelText("Business Name")).toHaveValue("Capital Stationers")
  })

  it("accepts a listing with no WhatsApp number at all", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBusiness(user)

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].contactPhone).toBe("03001234567")
    expect(onSubmit.mock.calls[0][0].whatsappPhone ?? "").toBe("")
  })

  it("refuses an unreadable WhatsApp number even though the field is optional", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBusiness(user, "03001234567", "nope")

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    expect(await screen.findByText(/Enter a valid phone number/)).toBeInTheDocument()
    expect(screen.getByLabelText("WhatsApp Number (optional)")).toHaveAttribute("aria-invalid", "true")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("passes both numbers on exactly as typed (the API canonicalises them, not the form)", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBusiness(user, "+92 300 1234567", "0321-765-4321")

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      contactPhone: "+92 300 1234567",
      whatsappPhone: "0321-765-4321",
    })
  })

  it("the Property form enforces the same rule", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: PropertyFormValues) => void>()
    render(<PropertyListingForm onSubmit={onSubmit} onBack={vi.fn()} />)
    await fill(user, screen.getByLabelText("Title"), "Corner house near the park")
    await user.selectOptions(screen.getByLabelText("Listing Type"), "rent")
    await user.selectOptions(await screen.findByLabelText("Property Type"), "house")
    await fill(user, screen.getByLabelText("Price"), "PKR 65,000 / month")
    await fill(user, screen.getByLabelText("Description"), "A bright, well-kept home in a quiet B-17 block.")

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    expect(await screen.findByText("Please enter a contact number.")).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe("ContactFields: an edit starts from what is saved", () => {
  it("prefills both numbers as stored", () => {
    render(
      <ListingForm
        kind="business"
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        defaultValues={{
          name: "Capital Stationers",
          category: "pharmacy",
          description: "Books, copies and office supplies for B-17.",
          area: "B-17",
          contactPhone: "+923001234567",
          whatsappPhone: "+923217654321",
        }}
      />
    )

    expect(screen.getByLabelText("Contact Number")).toHaveValue("+923001234567")
    expect(screen.getByLabelText("WhatsApp Number (optional)")).toHaveValue("+923217654321")
  })

  it("leaves the fields empty for a listing created before the field, so the owner is asked for one", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ListingForm
        kind="business"
        onSubmit={onSubmit}
        onBack={vi.fn()}
        defaultValues={{
          name: "Older Shop",
          category: "pharmacy",
          description: "A listing from before contact numbers existed here.",
          area: "B-17",
          contactPhone: "",
        }}
      />
    )

    expect(screen.getByLabelText("Contact Number")).toHaveValue("")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText("Please enter a contact number.")).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("an unchanged prefilled number submits unchanged (so an untouched field is not an edit)", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(
      <ListingForm
        kind="business"
        onSubmit={onSubmit}
        onBack={vi.fn()}
        defaultValues={{
          name: "Capital Stationers",
          category: "pharmacy",
          description: "Books, copies and office supplies for B-17.",
          area: "B-17",
          contactPhone: "+923001234567",
        }}
      />
    )

    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].contactPhone).toBe("+923001234567")
  })
})
