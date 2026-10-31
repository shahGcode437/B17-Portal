import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PropertyListingForm } from "@/features/provider/PropertyListingForm"
import { resetCategoryCache } from "@/hooks/useCategories"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import type { PropertyFormValues } from "@/features/provider/listingSchema"

beforeEach(() => {
  resetCategoryCache()
  installFetchMock(fakeBackend())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field)
  await user.paste(text)
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await fill(user, screen.getByLabelText("Title"), "Corner house near the park")
  await user.selectOptions(screen.getByLabelText("Listing Type"), "rent")
  await user.selectOptions(await screen.findByLabelText("Property Type"), "house")
  await fill(user, screen.getByLabelText("Price"), "PKR 65,000 / month")
  await fill(user, screen.getByLabelText("Description"), "A bright, well-kept home in a quiet B-17 block.")
}

describe("PropertyListingForm (S4)", () => {
  it("the submit button says what it does, and nothing is labelled as a preview", () => {
    const { rerender } = render(<PropertyListingForm onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeInTheDocument()
    for (const button of screen.getAllByRole("button")) expect(button).not.toHaveAccessibleName(/preview/i)
    rerender(<PropertyListingForm submitLabel="Save Changes" onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument()
  })

  it("Area is B-17 from a list of one, never free text", () => {
    render(<PropertyListingForm onSubmit={vi.fn()} onBack={vi.fn()} />)
    const area = screen.getByRole("combobox", { name: "Area" })
    expect(area).toHaveValue("B-17")
    expect(within(area).getAllByRole("option").map((option) => option.textContent)).toEqual(["B-17"])
    expect(screen.queryByRole("textbox", { name: "Area" })).not.toBeInTheDocument()
  })

  it("submits area 'B-17' with the other fields, tags optional", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: PropertyFormValues) => void>()
    render(<PropertyListingForm onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ area: "B-17", listingType: "rent", propertyType: "house" })
  })

  it("an old free-text area is shown as B-17 with a note, and is saved as B-17", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<(values: PropertyFormValues) => void>()
    render(
      <PropertyListingForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        defaultValues={{
          title: "Old plot",
          listingType: "sale",
          propertyType: "plot",
          price: "PKR 1 Cr",
          area: "B-17, Block D (Demo Area)",
          description: "An old listing with a free-text area on file.",
        }}
      />
    )
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveValue("B-17")
    expect(screen.getByText(/will be saved as B-17/)).toBeInTheDocument()
    await screen.findByRole("option", { name: "Plot" })
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].area).toBe("B-17")
  })

  it("flags more than 20 tags before submit and blocks the submit, without raw backend wording", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<PropertyListingForm onSubmit={onSubmit} onBack={vi.fn()} />)
    await fillValid(user)
    await fill(user, screen.getByLabelText("Tags (optional)"), Array.from({ length: 22 }, (_, i) => `t${i}`).join(","))
    expect(await screen.findByText("You can add up to 20 tags. Remove 2 to continue.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(/List should have at most/)
  })

  it("explains the image honestly here too", () => {
    render(<PropertyListingForm onSubmit={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Choose Image" })).toBeDisabled()
    expect(screen.getByText(/Image upload isn't available yet/)).toBeInTheDocument()
  })
})

describe("PropertyListingForm: a one-character title says it is too short (S5A / B-04)", () => {
  it("names the minimum for a single character, and the limit for a long one", async () => {
    const user = userEvent.setup()
    render(<PropertyListingForm onSubmit={vi.fn()} onBack={vi.fn()} />)
    await fill(user, screen.getByLabelText("Title"), "x")
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText("Title must be at least 2 characters.")).toBeInTheDocument()

    await user.clear(screen.getByLabelText("Title"))
    await fill(user, screen.getByLabelText("Title"), "t".repeat(101))
    await user.click(screen.getByRole("button", { name: "Submit for Review" }))
    expect(await screen.findByText("Title must be at most 100 characters.")).toBeInTheDocument()
  })
})
