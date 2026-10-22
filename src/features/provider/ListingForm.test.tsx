import { render, screen } from "@testing-library/react"
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
  await fill(user, screen.getByLabelText("Area"), "B-17, Block B")
  await fill(user, screen.getByLabelText(/Tags/), "cakes, bread")
}

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
    await user.click(screen.getByRole("button", { name: "Preview Listing" }))
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
    await user.click(screen.getByRole("button", { name: "Preview Listing" }))

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
    await user.click(screen.getByRole("button", { name: "Preview Listing" }))
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
    await user.click(screen.getByRole("button", { name: "Preview Listing" }))
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
          area: "B-17, Block A",
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
