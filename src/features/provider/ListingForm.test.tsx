import type { ReactElement } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ListingForm } from "@/features/provider/ListingForm"
import { resetCategoryCache } from "@/hooks/useCategories"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import type { ListingFormValues } from "@/features/provider/listingSchema"

// The category choices are the SERVER's active categories (GET /categories?module=...); the form submits the SLUG.
beforeEach(() => {
  resetCategoryCache()
  installFetchMock(fakeBackend())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const SWITCH_WARNING = "Switching to General Business will remove Food-specific details when saved."

/** Fills a text field by pasting — one event instead of one per keystroke, so the suite stays fast on slow disks. */
async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field)
  await user.paste(text)
}

async function fillBase(user: ReturnType<typeof userEvent.setup>, name = "Sweet Crumbs Bakery") {
  await fill(user, screen.getByLabelText("Business Name"), name)
  await fill(user, screen.getByLabelText("Description"), "Fresh cakes and bread baked every morning.")
  await fill(user, screen.getByLabelText(/Tags/), "cakes, bread")
}

describe("ListingForm — submitting state", () => {
  it("disables the submit button and marks it busy while the page's write is in flight", () => {
    const { rerender } = render(<ListingForm kind="provider" onSubmit={vi.fn()} onBack={vi.fn()} />)
    const submit = screen.getByRole("button", { name: "Submit for Review" })
    expect(submit).toBeEnabled()
    expect(submit).toHaveAttribute("aria-busy", "false")
    rerender(<ListingForm kind="provider" submitting onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Submit for Review" })).toHaveAttribute("aria-busy", "true")
  })
})

describe("ListingForm — the submit button says what it does (S4)", () => {
  it("is 'Submit for Review' by default: creating a listing submits it to moderation", () => {
    render(<ListingForm kind="provider" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeInTheDocument()
  })

  it("takes the label the page gives it (an edit says 'Save Changes' or 'Resubmit for Review')", () => {
    const { rerender } = render(<ListingForm kind="provider" submitLabel="Save Changes" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument()
    rerender(<ListingForm kind="provider" submitLabel="Resubmit for Review" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Resubmit for Review" })).toBeInTheDocument()
  })

  it("no button of the form is ever labelled as a preview: nothing here previews anything", () => {
    for (const kind of ["provider", "business"] as const) {
      const { unmount } = render(<ListingForm kind={kind} onSubmit={vi.fn()} onBack={vi.fn()} />)
      for (const button of screen.getAllByRole("button")) expect(button).not.toHaveAccessibleName(/preview/i)
      unmount()
    }
  })
})

describe("ListingForm — Area (S4)", () => {
  it("is a choice from the configured localities (only B-17), not free text", () => {
    render(<ListingForm kind="provider" onSubmit={vi.fn()} onBack={vi.fn()} />)
    const area = screen.getByRole("combobox", { name: "Area" })
    expect(area).toHaveValue("B-17")
    expect(screen.queryByRole("textbox", { name: "Area" })).not.toBeInTheDocument()
    expect(within(area).getAllByRole("option").map((option) => option.textContent)).toEqual(["B-17"])
  })

  it("always submits area 'B-17'; the block lives in its own field", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(<ListingForm kind="provider" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fill(user, screen.getByLabelText("Name"), "Sunrise Solar")
    await fill(user, screen.getByLabelText("Description"), "Solar installation and maintenance across B-17.")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Service Category" }), "solar")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].area).toBe("B-17")
  })

  it("an old listing whose area was free text is shown as B-17, and the form says it will be saved that way", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(
      <ListingForm
        kind="provider"
        onSubmit={onSubmit}
        onBack={vi.fn()}
        defaultValues={{ name: "Old Listing", category: "solar", description: "A description that is long enough.", area: "B-17, Block C (Demo Area)", tagsInput: "" }}
      />
    )
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveValue("B-17")
    expect(screen.getByText(/The area on file .*Block C \(Demo Area\).* will be saved as B-17/)).toBeInTheDocument()
    await screen.findByRole("option", { name: "Solar" })
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].area).toBe("B-17")
  })
})

describe("ListingForm — Tags (S4)", () => {
  const tagsOf = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`).join(", ")

  it("say what they are for on each kind of listing, and are optional on all of them", async () => {
    const labels: [() => ReactElement, string][] = [
      [() => <ListingForm kind="provider" onSubmit={vi.fn()} onBack={vi.fn()} />, "Services offered (optional)"],
      [() => <ListingForm kind="provider" categoryModule="education" categoryLabelText="Subject" onSubmit={vi.fn()} onBack={vi.fn()} />, "Topics you teach (optional)"],
      [() => <ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />, "Tags (optional)"],
    ]
    for (const [ui, label] of labels) {
      const { unmount } = render(ui())
      expect(screen.getByLabelText(label)).toBeInTheDocument()
      unmount()
    }
    const user = userEvent.setup()
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    expect(screen.getByLabelText("Dishes / Search Tags (optional)")).toBeInTheDocument()
  })

  it("submit without any tags: the API does not require them", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fill(user, screen.getByLabelText("Business Name"), "Capital Stationers")
    await fill(user, screen.getByLabelText("Description"), "Office and school stationery, printing and photocopying.")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Category" }), "pharmacy")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].tagsInput ?? "").toBe("")
  })

  it("show a live count, and flag the 21st tag BEFORE any submit, in plain words", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    const tags = screen.getByLabelText("Tags (optional)")
    await fill(user, tags, tagsOf(3))
    expect(screen.getByText(/3 of 20 so far/)).toBeInTheDocument()

    await user.clear(tags)
    await fill(user, tags, tagsOf(21))
    const alert = await screen.findByText("You can add up to 20 tags. Remove 1 to continue.")
    expect(alert).toHaveAttribute("role", "alert")
    expect(tags).toHaveAttribute("aria-invalid", "true")
    expect(tags).toHaveAttribute("aria-describedby", alert.id)
    expect(document.body.textContent).not.toMatch(/List should have at most|after validation/i)
  })

  it("block submit while there are more than 20 tags", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fill(user, screen.getByLabelText("Business Name"), "Capital Stationers")
    await fill(user, screen.getByLabelText("Description"), "Office and school stationery, printing and photocopying.")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Category" }), "pharmacy")
    await fill(user, screen.getByLabelText("Tags (optional)"), tagsOf(21))
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe("ListingForm — Business type", () => {
  it("offers General Business and Food & Dining as a radio group, General selected by default", () => {
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    const group = screen.getByRole("group", { name: "Business type" })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /General Business/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /Food & Dining/ })).not.toBeChecked()
    expect(screen.getByLabelText("Category")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: /Food & Dining details/ })).not.toBeInTheDocument()
  })

  it("does not show the business-type choice for a Service listing", () => {
    render(<ListingForm kind="provider" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.queryByRole("group", { name: "Business type" })).not.toBeInTheDocument()
  })

  it("choosing Food & Dining reveals the Food fields and replaces the typed Category field", async () => {
    const user = userEvent.setup()
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    expect(screen.getByRole("heading", { name: /Food & Dining details/ })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Food categories" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument()
  })

  it("keeps what was typed when toggling, and warns (accessibly) that switching a filled Food form to General drops the Food data", async () => {
    const user = userEvent.setup()
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    await fillBase(user)
    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    expect(screen.queryByText(SWITCH_WARNING)).not.toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Bakeries" }))

    await user.click(screen.getByRole("radio", { name: /General Business/ }))
    expect(screen.getByRole("status")).toHaveTextContent(SWITCH_WARNING)
    expect(screen.getByLabelText("Business Name")).toHaveValue("Sweet Crumbs Bakery")

    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    expect(screen.queryByText(SWITCH_WARNING)).not.toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Bakeries" })).toBeChecked() // Food values survive the toggle
  })

  it("shows no warning when General is selected and no Food data exists", async () => {
    const user = userEvent.setup()
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    await user.click(screen.getByRole("radio", { name: /General Business/ }))
    expect(screen.queryByText(SWITCH_WARNING)).not.toBeInTheDocument()
  })
})

describe("ListingForm — submit", () => {
  it("blocks an empty Food submission and shows linked errors for the general and Food fields", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText("Please enter a name.")).toBeInTheDocument()
    expect(screen.getByText("Choose at least one category.")).toBeInTheDocument()
    expect(screen.getByText("Choose at least one service option.")).toBeInTheDocument()
    expect(screen.getByLabelText("Business Name")).toHaveAttribute("aria-invalid", "true")
    // No "choose a category" error: Food derives its category.
    expect(screen.queryByText("Please choose a category.")).not.toBeInTheDocument()
  })

  it("submits a valid Food listing with vertical 'food' and the whole Food block", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBase(user)
    await user.click(screen.getByRole("radio", { name: /Food & Dining/ }))
    await user.click(screen.getByRole("checkbox", { name: "Bakeries" }))
    await user.click(screen.getByRole("checkbox", { name: "Cafes" }))
    await user.click(screen.getByRole("checkbox", { name: "Takeaway" }))
    await fill(user, screen.getByLabelText("Opening hours (optional)"), "Daily, 8 AM–10 PM")
    await user.click(screen.getByRole("button", { name: "Add menu item" }))
    await fill(user, screen.getByLabelText("Item name"), "Fudge Cake")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const values = onSubmit.mock.calls[0][0]
    expect(values.vertical).toBe("food")
    expect(values.food).toMatchObject({
      categories: ["bakeries", "cafes"],
      serviceOptions: ["takeaway"],
      hoursNote: "Daily, 8 AM–10 PM",
      menuHighlights: [{ name: "Fudge Cake", section: "", description: "", price: "" }],
    })
  })

  it("submits a General listing without any Food data", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: ListingFormValues) => void>()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBase(user, "Capital Stationers")
    await user.selectOptions(await screen.findByRole("combobox", { name: "Category" }), "pharmacy")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const values = onSubmit.mock.calls[0][0]
    // The slug, never the label or free text: the backend refuses anything else (unknown_category).
    expect(values).toMatchObject({ vertical: "general", category: "pharmacy" })
    expect(values.food).toBeUndefined()
  })

  it("offers only the server's ACTIVE categories as the category choices (never a typed value)", async () => {
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(await screen.findByRole("option", { name: "Pharmacy" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Hairdressing" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Retired Category" })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Category" })).not.toBeInTheDocument()
  })

  it("a tutor chooses a Subject from the EDUCATION categories; a provider from the SERVICES categories", async () => {
    const { unmount } = render(<ListingForm kind="provider" categoryModule="education" categoryLabelText="Subject" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(await screen.findByRole("option", { name: "Physics" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Solar" })).not.toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Subject" })).toBeInTheDocument()
    unmount()
    render(<ListingForm kind="provider" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(await screen.findByRole("option", { name: "Solar" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Physics" })).not.toBeInTheDocument()
  })

  it("an edit prefill selects the listing's current category once the options have loaded", async () => {
    render(<ListingForm kind="business" onSubmit={vi.fn()} onBack={vi.fn()} defaultValues={{ name: "Pharma", category: "hairdressing", description: "A description that is long enough.", area: "B-17", tagsInput: "x" }} />)
    await screen.findByRole("option", { name: "Hairdressing" })
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("hairdressing")
  })

  it("requires a category for a General business", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ListingForm kind="business" onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillBase(user)
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText("Please choose a category.")).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("prefills an existing Food listing for editing (type, categories, services, menu)", () => {
    render(
      <ListingForm
        kind="business"
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        defaultValues={{
          name: "Karahi Junction",
          category: "Desi Food",
          description: "Wok-cooked karahi with fresh naan.",
          area: "B-17",
          tagsInput: "karahi, naan",
          vertical: "food",
          food: { categories: ["desi-food", "restaurants"], serviceOptions: ["dine-in", "delivery"], hoursNote: "Daily", menuHighlights: [{ name: "Chicken Karahi", section: "Mains", description: "", price: "PKR 1,400" }], menuImage: undefined },
        }}
      />
    )
    expect(screen.getByRole("radio", { name: /Food & Dining/ })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Desi Food" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Restaurants" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Delivery by the business" })).toBeChecked()
    expect(screen.getByLabelText("Item name")).toHaveValue("Chicken Karahi")
    expect(screen.getByLabelText("Opening hours (optional)")).toHaveValue("Daily")
  })
})
